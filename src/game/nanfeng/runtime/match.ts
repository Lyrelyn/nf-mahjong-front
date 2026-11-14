// 南丰单机对局的最小运行时：**只管推进，不做决策**。
//
// 分工：
//   - `state/apply.ts`（引擎）负责一切规则与结算；
//   - 这里负责"当前轮到谁、他有哪些合法动作、动作之间怎么接"，并把状态推进到下一个待决点；
//   - 谁来做决定（真人 / AI）由调用方通过 `act()` 提供。
//
// 有意不做的事：定时器、动画、音效、网络。表现层以后订阅 `events` 自己播。
import type { ActionOption, PlayerAction } from '../action/options'
import { ownTurnOptions } from '../action/options'
import { applyAction, type GameEvent } from '../state/apply'
import { nextRoundSeating, startRound, type GameState, type RoundOutcome } from '../state/gameState'
import { createRng } from '../prng'
import type { RuleConfig } from '../ruleConfig'
import { DEFAULT_RULE_CONFIG } from '../ruleConfig'
import type { Tile } from '../tiles'
import { buildAiView, type AiView } from '../ai/view'

/** 一局之内：`playing`；本局结束（有人胡或荒庄）：`round-over`。 */
export type MatchStatus = 'playing' | 'round-over'

/** 当前需要谁做一个决定。 */
export interface PendingDecision {
  kind: 'turn' | 'claim'
  seat: number
  /**
   * 引擎给出的显式选项。
   *
   * 注意：`kind === 'turn'` 时这里**不含 `DISCARD`** —— 出牌是"隐含动作"（点哪张就打哪张，
   * 见 `action/options.ts` 的 `ownTurnOptions`）。运行时对 DISCARD 单独校验手牌，不靠这张列表。
   */
  options: readonly ActionOption[]
  /** 鸣牌/抢杠窗口里被触发的那张牌；自己回合为 null。 */
  tile: Tile | null
  /** 出牌者（抢杠窗口里是补杠的那家）；自己回合为 null。 */
  from: number | null
  view: AiView
}

export interface MatchOptions {
  /** 座位显示名（一期固定 4 个座位）。 */
  seats: readonly string[]
  /**
   * 第 5 个人（本局轮空买码者）。给了就启用 **5 人轮换**（R-02）：
   * 每局结束后按"点炮者下场 / 自摸对家下场 / 流局庄家下场"换一个座位的人，
   * 上局的买码者接管那把椅子。不给就是固定的 4 人局。
   */
  buyerId?: string
  /** 第一局庄家（Q-06：房主坐庄）。 */
  dealer?: number
  cfg?: RuleConfig
  /** 洗牌种子：同一个种子必须跑出完全一样的对局。 */
  seed?: number
  hostId?: string
  /** 从第几局开始（只影响显示的局号）。 */
  round?: number
  /** 仿真时钟起点：引擎只用它算鸣牌窗口截止时间。 */
  now?: number
}

const STEP_MS = 100

export class NanfengMatch {
  private stateValue!: GameState
  private readonly cfgValue: RuleConfig
  /** 本局的四个座位（轮换会换人，但椅子的位置与顺序不变）。 */
  private seatsValue: string[]
  /** 当前轮空买码的人；`null` 表示没有第 5 个人（固定 4 人局）。 */
  private buyerValue: string | null
  private readonly seedValue: number
  private readonly hostIdValue: string
  private roundValue: number
  private statusValue: MatchStatus = 'playing'
  private pendingValue: PendingDecision | null = null
  private outcomeValue: RoundOutcome | null = null
  private eventsValue: readonly GameEvent[] = []
  private nowValue: number
  private dealerValue: number

  constructor(options: MatchOptions) {
    this.cfgValue = options.cfg ?? DEFAULT_RULE_CONFIG
    this.seatsValue = [...options.seats]
    // 第 5 个人如果同时也在座位表里，就不是轮换关系了 —— 当成 4 人局，别造出"一人两席"。
    const buyer = options.buyerId ?? null
    this.buyerValue = buyer !== null && !this.seatsValue.includes(buyer) ? buyer : null
    this.seedValue = options.seed ?? 1
    this.hostIdValue = options.hostId ?? options.seats[0] ?? 'host'
    this.roundValue = options.round ?? 1
    this.nowValue = options.now ?? 1_000
    this.dealerValue = options.dealer ?? 0
  }

  get cfg(): RuleConfig { return this.cfgValue }
  /** 是否已经开过局（`begin()` 之前 `state` 还没有值）。 */
  get started(): boolean { return this.stateValue !== undefined }
  get state(): GameState { return this.stateValue }
  get status(): MatchStatus { return this.statusValue }
  get pending(): PendingDecision | null { return this.pendingValue }
  get outcome(): RoundOutcome | null { return this.outcomeValue }
  get events(): readonly GameEvent[] { return this.eventsValue }
  get round(): number { return this.roundValue }
  get dealer(): number { return this.dealerValue }
  /** 本局的座位表（4 个显示名，轮换时其中的名字会换）。 */
  get seats(): readonly string[] { return this.seatsValue }
  /** 本局轮空买码的人；`null` = 没有第 5 个人。 */
  get buyerId(): string | null { return this.buyerValue }
  /** 是否启用了 5 人轮换。 */
  get rotating(): boolean { return this.buyerValue !== null }

  /**
   * 开一局（洗牌、发牌、庄家摸牌），并推进到第一个待决点。
   *
   * `dealerOverride` 只用于**第一局起庄**：调用方可以先用掷骰等方式定庄再开局
   * （见 `useNanfengMatch`，这是对规则文档 Q-06「房主坐庄」的产品决定变更）。
   * 后续局仍由 `nextRoundSeating` 按 R-02 决定，传了也会被忽略。
   */
  begin(dealerOverride?: number): void {
    if (dealerOverride !== undefined && this.roundValue === 1) {
      this.dealerValue = dealerOverride
    }
    // `hostId` 必须始终在座位表里，否则 `startRound` 直接抛错。5 人换座会把原来坐 0 号位的人
    // 换下去（本轮买码），所以这里要跟着当前座位表走，而不是沿用开局时那个名字。
    const hostId = this.seatsValue.includes(this.hostIdValue)
      ? this.hostIdValue
      : (this.seatsValue[0] ?? this.hostIdValue)
    this.stateValue = startRound({
      seats: this.seatsValue,
      dealer: this.dealerValue,
      cfg: this.cfgValue,
      rng: createRng(this.seedValue + this.roundValue * 7919),
      round: this.roundValue,
      hostId,
      epoch: this.roundValue,
    })
    this.statusValue = 'playing'
    this.outcomeValue = null
    this.eventsValue = []
    this.advance()
  }

  /**
   * 提交一个动作，返回这一步产生的事件（表现层据此播动画/音效）。
   *
   * 会校验：动作的座位必须是当前待决座位，且动作类型必须在该座位的合法选项里 ——
   * 这样"UI 点错按钮"会在运行时就被拦住，而不是悄悄改坏状态。
   */
  act(action: PlayerAction): readonly GameEvent[] {
    const pending = this.pendingValue
    if (pending === null) throw new Error('当前没有待决动作，不该再提交')
    if (action.seat !== pending.seat) {
      throw new Error(`不是座位 ${pending.seat} 的回合，收到座位 ${action.seat}`)
    }
    const legal = action.type === 'DISCARD'
      ? this.canDiscard(pending.seat, action.tile)
      : pending.options.some((option) => option.type === action.type)
    if (!legal) {
      throw new Error(`座位 ${pending.seat} 在 ${pending.kind} 窗口里不能执行 ${action.type}`)
    }

    const result = applyAction(this.stateValue, action, this.cfgValue, this.nowValue)
    this.stateValue = result.state
    this.eventsValue = result.events
    this.nowValue += STEP_MS
    this.advance()
    return result.events
  }

  /**
   * 本局结束后进入下一局：按 R-02 定庄；启用 5 人轮换时再换一个人下场买码。
   *
   * 轮换口径（R-02 / C-9）：点炮胡 → 放炮者下场；别人自摸 → 自摸者的对家下场；
   * 荒庄 → 庄家下场。**上场的人永远是上一局的买码者**，他直接接管那把椅子 ——
   * 所以座位的位置与顺序不变，只有人换，`dealer` 这类座位下标继续有效。
   */
  nextRound(): void {
    if (this.statusValue !== 'round-over' || this.outcomeValue === null) {
      throw new Error('本局还没结束，不能开下一局')
    }
    const seating = nextRoundSeating(this.stateValue, this.outcomeValue)
    const seats = [...this.seatsValue]
    if (this.buyerValue !== null) {
      const outgoing = seats[seating.sittingOut] ?? ''
      seats[seating.sittingOut] = this.buyerValue
      this.buyerValue = outgoing
    }
    this.seatsValue = seats
    this.dealerValue = seating.dealer
    this.roundValue += 1
    this.begin()
  }

  /**
   * 出牌校验：只有轮到自己、且手里确实有这张牌才合法。
   *
   * 为什么不查 `options`：`ownTurnOptions` 有意不列出牌（"点一张牌就是出牌"），
   * 把它塞进选项列表反而会让 UI 以为有个 DISCARD 按钮。
   */
  private canDiscard(seat: number, tile: Tile | null): boolean {
    if (this.pendingValue === null || this.pendingValue.kind !== 'turn') return false
    if (tile === null || !Number.isInteger(tile)) return false
    const hand = this.stateValue.hands[seat]
    if (hand === undefined) return false
    return hand.concealed[tile] > 0 || hand.drawnTile === tile
  }

  private advance(): void {
    if (this.hasRoundEnded()) {
      this.statusValue = 'round-over'
      this.pendingValue = null
      this.outcomeValue = outcomeOf(this.eventsValue, this.stateValue)
      return
    }

    const state = this.stateValue
    if (state.phase === 'WAITING_PLAY') {
      const seat = state.turn
      this.pendingValue = {
        kind: 'turn',
        seat,
        options: ownTurnOptions(state.hands[seat]!, this.cfgValue),
        tile: null,
        from: null,
        view: buildAiView(state, seat),
      }
      return
    }

    if (state.phase === 'CLAIM_WINDOW' && state.claim !== null) {
      const claim = state.claim
      for (const seat of claim.pending) {
        const options = claim.options.get(seat)
        if (options === undefined || options.length === 0) continue
        this.pendingValue = {
          kind: 'claim',
          seat,
          options,
          // 抢杠窗口里 "被杠的那张" 才是触发器；普通鸣牌窗口就是刚打出的牌。
          tile: claim.triggerTile,
          from: claim.gangSeat ?? claim.triggerSeat,
          view: buildAiView(state, seat),
        }
        return
      }
      // 窗口里没有人能做事：引擎会在下一次动作时推进，这里直接报错比卡死更好查。
      throw new Error('鸣牌窗口里没有任何可行动作，状态可能已经坏了')
    }

    throw new Error(`无法在这个阶段推进：${state.phase}`)
  }

  private hasRoundEnded(): boolean {
    if (this.stateValue.phase === 'ENDED') return true
    return this.eventsValue.some(
      (event) => event.type === 'HU' || event.type === 'QIANG_GANG_HU' || event.type === 'HUANG_ZHUANG',
    )
  }
}

/** 从事件里取出本局结局（用于下一局定庄；没有结局时返回 null）。 */
export function outcomeOf(events: readonly GameEvent[], state: GameState): RoundOutcome | null {
  for (const event of events) {
    if (event.type === 'HUANG_ZHUANG') return { kind: 'HUANG_ZHUANG' }
    if (event.type === 'HU') return { kind: 'HU', winners: event.winners, loserSeat: event.loserSeat }
    if (event.type === 'QIANG_GANG_HU') {
      return { kind: 'HU', winners: event.winners, loserSeat: event.gangSeat }
    }
  }
  return state.lastOutcome
}
