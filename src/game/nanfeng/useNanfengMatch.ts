// 把 `NanfengMatch` 包成 Vue 组合式：负责**时序**（开局演出、AI 延迟、真人等待）与**快照**，
// 不负责规则 —— 规则永远在 `state/apply.ts` 里。
//
// 表现相关的东西（发牌动画、桌面动作字、音效）也在这里，因为它们都是"什么时候播"的时序问题；
// 但**播**由调用方注入（`playSound`），本目录不 import 任何音频/DOM 模块（纯净层约束）。
import { onScopeDispose, shallowRef, type ShallowRef } from 'vue'
import type { ActionOption, PlayerAction } from './action/options'
import type { FanDetail, MaDetail } from './score/settle'
import { handTileCount } from './action/hand'
import type { Meld } from './melds'
import { fromCode } from './tileCodec'
import { WALL_SIZE, type Tile } from './tiles'
import { tileAudioFile } from '../core/rules/tiles'
import type { OpeningStage } from '../core/contracts/gamePort'
import type { TableActionEvent, TableActionType } from '../core/contracts/types'
import { DEFAULT_RULE_CONFIG, type RuleConfig } from './ruleConfig'
import { isMaCount } from './score/ma'
import type { GameEvent } from './state/apply'
import { aiActionFor } from './runtime/aiAction'
import { NanfengMatch, type MatchStatus, type PendingDecision } from './runtime/match'
import type { RoundOutcome } from './state/gameState'
import type { Phase } from './state/phase'
import { createRng } from './prng'
import { wallBreakIndexForDealer } from '../core/rules/wallLayout'

/** AI 的"思考"停顿：纯观感，不影响正确性（`runtime/match.test.ts` 里是 0 延迟）。 */
const AI_THINK_MS = { turn: 600, claim: 500 } as const

/** 开局三段：入场 → 掷骰 → 发牌（对齐莲花的时间轴，纯表现）。 */
const STAGE_MS = { start: 1200, dice: 1150 } as const
/**
 * 发牌动画：13 轮 × 4 家，每张间隔。
 *
 * 26ms 太快（52 张只花 1.3 秒，像"唰"一下），调到 60ms 约 3.1 秒 —— 接近莲花手感的
 * "一张张发下来"。要更快/更慢只改这一个数（兜底时长跟着它算）。
 */
const DEAL_TICK_MS = 60
const DEAL_ROUNDS = 13
/** 桌面动作字停留时长。 */
const CUE_MS = 900

export interface SeatSnapshot {
  /** 手牌张数（含刚摸到的，不含副露）。 */
  count: number
  melds: readonly Meld[]
}

export interface OwnHandSnapshot {
  /** 暗牌（不含刚摸到的那张），升序。 */
  tiles: Tile[]
  /** 刚摸到的那张（没有则为 null）—— 界面通常把它单独摆开。 */
  drawn: Tile | null
  melds: readonly Meld[]
}

/** 开局演出状态：`start` → `dice` → `deal`。 */
export interface OpeningSnapshot {
  stage: Exclude<OpeningStage, 'flip'>
  dice: [number, number]
  /** 谁掷的骰（本家）。 */
  thrower: number
  /** 骰点定出的庄家座位。 */
  dealer: number
}

export interface DealAnimation {
  playerIndex: number
  count: number
  serial: number
}

export interface SettleSnapshot {
  deltas: number[]
  detail: FanDetail[]
  /** 买码位本局净额。 */
  maDelta: number
  /** 每张码牌的指向与收付。 */
  maDetail: MaDetail[]
}

/** 买码位（第 5 个参与者）的快照。 */
export interface MaSnapshot {
  /** 本局预留了几张码牌（0 = 没买码，界面上不显示买码席）。 */
  count: number
  /** **局中为 null**（码牌不公开，谁也不知道买的是谁）；本局结束后是翻开顺序的码牌。 */
  tiles: Tile[] | null
  /** 每张码牌的指向与收付（与 `tiles` 同一时机才有值）。 */
  detail: MaDetail[]
  /** 买码位本局净额。 */
  delta: number
  /** 买码位跨局累计净得分。 */
  score: number
  /** 本局轮空买码的人（4 人局没有第 5 人时为空串）。 */
  buyerName: string
  /** 本局的买码者是不是真人（= 真人这一局轮空、只在旁边看）。 */
  isHumanBuyer: boolean
}

export interface NanfengSnapshot {
  round: number
  dealer: number
  wallCount: number
  phase: Phase
  turn: number
  status: MatchStatus
  scores: number[]
  seats: SeatSnapshot[]
  /**
   * **屏幕下方那一家**（视角座位）的手牌。在桌上时就是你自己；
   * 轮空观战时是当前正在看的那个人的手牌（点头像切换）。
   */
  own: OwnHandSnapshot
  discards: Tile[][]
  /** 最近一次被打出的牌（谁打的、哪张）；开局或无出牌时为 null。 */
  lastDiscard: { seat: number; tile: Tile } | null
  pending: PendingDecision | null
  outcome: RoundOutcome | null
  settle: SettleSnapshot | null
  /** 买码位状态（没买码时 `count === 0`，界面不显示）。 */
  ma: MaSnapshot
  /** 每个绝对座位的显示名（5 人轮换时名字会随换座变化）。 */
  seatNames: string[]
  /** 视角座位（0..3）：3D 与手牌区都从这家看出去。轮空时可以点头像切换。 */
  viewSeat: number
  /** 开局演出（入场/掷骰/发牌）；没有演出时为 null。 */
  opening: OpeningSnapshot | null
  /** 发牌动画进度：`playerIndex=-1` 表示没有在发牌。 */
  dealAnimation: DealAnimation
  /**
   * 发牌演出期间"应该已经发到手上几张"：`null` 表示演出结束、按真实手牌显示。
   * 演出期间投影层会把每家手牌截断到这个张数——所以开局前手牌是空的，牌是一张张发下来的。
   */
  dealtCount: number | null
  /** 桌面动作字（碰/杠/胡）；播完置空。 */
  tableActionEvent: TableActionEvent | null
  /** 开局演出的骰点；开局之后仍然保留（3D 要用它算牌墙开口）。 */
  dice: [number, number]
  /** 牌山断点：由骰点 + 庄家算出的物理张位，3D 据此决定牌墙从哪开口。 */
  wallBreakIndex: number
  /** 已经从牌墙头摸走了几张（3D 用它在开口处"抽"牌）。 */
  wallHeadDrawn: number
  /** 最近一步的事件，给表现层用。 */
  events: readonly GameEvent[]
  /** 最近一次动作被拒/内部异常的原因（停止推进时用它说明原因）。 */
  lastError: string | null
  humanSeat: number
}

export interface NanfengMatchApi {
  snapshot: ShallowRef<NanfengSnapshot>
  /** 开局（含入场/掷骰/发牌演出）。 */
  start: () => void
  /** 本局结束后进入下一局（不掷骰：定庄按 R-02 轮庄）。 */
  nextRound: () => void
  /** 打出一张手牌（牌码）。 */
  discard: (tile: Tile) => void
  /** 提交一条显式动作（胡/碰/杠/过）。 */
  submit: (type: ActionOption['type']) => void
  /** 真人能否在此时出牌。 */
  canAct: () => boolean
  /**
   * 切换视角到某个绝对座位（轮空观战时用；在桌上时忽略，避免看到别人的手牌）。
   *
   * 切过去之后，3D 牌桌、牌墙开口、手牌区都换成"从这家看出去"，
   * 也就是那个人的视角（他的手牌会显示在下方）。
   */
  setViewSeat: (seat: number) => void
}

export interface UseNanfengOptions {
  humanSeat?: number
  seed?: number
  dealer?: number
  seats?: readonly string[]
  /**
   * 5 人轮换的花名册（正好 5 个显示名，**第一个是真人你**）。
   *
   * 给了就启用 5 人换座（R-02）：每局结束后按"点炮者下场 / 自摸对家下场 / 流局庄家下场"
   * 换一个人轮空买码，上一局的买码者回来接管那把椅子。真人也会轮空 —— 那一局你只能观战。
   */
  roster?: readonly string[]
  /** 全部座位交给 AI（演示/自测用）。 */
  autoPlay?: boolean
  /**
   * 买码张数（0 = 不买码，默认）。1/2/4 = 给第 5 个参与者「买码位」预留几张码牌（R-09）。
   * 非法值退回 0 —— 引擎层还会再校验一次（`validateRuleConfig`）。
   */
  maCount?: number
  /** 音效播放入口（由 UI 层注入；本目录不碰音频）。 */
  playSound?: (name: string, volume?: number) => void
}

export function useNanfengMatch(options: UseNanfengOptions = {}): NanfengMatchApi {
  // 5 人轮换：名册 5 个人 → 4 个座位 + 1 个轮空买码位。真人是名册第一个。
  const roster = options.roster !== undefined && options.roster.length === 5 ? options.roster : null
  const seats: string[] = roster !== null
    ? roster.slice(0, 4)
    : [...(options.seats ?? ['本家', '下家', '对家', '上家'])]
  const autoPlayAll = options.autoPlay === true
  /** 固定视角的座位（4 人局/不轮换时用）；-1 = 全部交给 AI。 */
  const fixedHumanSeat = autoPlayAll ? -1 : (options.humanSeat ?? 0)
  /** 真人的显示名：轮换时靠它在座位表里定位自己（座位会变）。名册第一个永远是真人。 */
  const humanName = roster !== null
    ? (roster[0] ?? '你')
    : (seats[Math.max(0, fixedHumanSeat)] ?? seats[0] ?? '本家')
  const maCount = options.maCount !== undefined && isMaCount(options.maCount) ? options.maCount : 0
  const cfg: RuleConfig = maCount === 0
    ? DEFAULT_RULE_CONFIG
    : { ...DEFAULT_RULE_CONFIG, buyCode: { count: maCount } }
  const sound = options.playSound ?? (() => {})

  // 默认种子是**确定值**：本目录属于"引擎纯净层"，不许直接取时钟或随机数（`boundary.test.ts` 会拦）。
  // 要让每局不同，由调用方（UI 层）自己取时间戳之类的熵，作为 seed 传进来。
  const seedValue = options.seed ?? 1
  const match = new NanfengMatch({
    seats,
    buyerId: roster?.[4],
    seed: seedValue,
    dealer: options.dealer ?? 0,
    cfg,
  })

  let seq = 0
  let cueSeq = 0
  let dealSerial = 0
  let aiTimer: ReturnType<typeof setTimeout> | null = null
  let cueTimer: ReturnType<typeof setTimeout> | null = null
  let stageTimers: Array<ReturnType<typeof setTimeout>> = []
  let disposed = false
  let openingValue: OpeningSnapshot | null = null
  let dealAnimationValue: DealAnimation = { playerIndex: -1, count: 0, serial: 0 }
  let tableActionValue: TableActionEvent | null = null
  /** 本局的骰点与牌山断点：开局算一次，整局给 3D 用。 */
  let diceValue: [number, number] = [1, 1]
  let wallBreakValue = 0
  /** 最近一次动作被拒/异常的原因；正常时为 null。UI 会把它显示出来。 */
  let lastErrorValue: string | null = null
  /** 真人当前的绝对座位；-1 = 这一局轮空（买码位、只能观战）。 */
  let humanSeatValue = fixedHumanSeat
  /** 视角座位：在桌上时跟着自己的座位，轮空时可以点头像切到任意一家。 */
  let viewSeatValue = Math.max(0, fixedHumanSeat)

  /** 真人在这一局的座位：轮换时按名字在座位表里找，找不到就是轮空了。 */
  function humanSeatOf(): number {
    if (autoPlayAll) return -1
    if (roster === null || !match.started) return fixedHumanSeat
    return match.state.seats.indexOf(humanName)
  }

  const snapshot = shallowRef<NanfengSnapshot>(emptySnapshot(humanSeatValue, seats.length, seats))

  function emptySnapshot(human: number, seatCount: number, names: readonly string[]): NanfengSnapshot {
    return {
      round: 1,
      dealer: 0,
      wallCount: 0,
      phase: 'LOBBY',
      turn: 0,
      status: 'playing',
      scores: new Array(seatCount).fill(0),
      seats: Array.from({ length: seatCount }, () => ({ count: 0, melds: [] })),
      own: { tiles: [], drawn: null, melds: [] },
      discards: Array.from({ length: seatCount }, () => []),
      lastDiscard: null,
      pending: null,
      outcome: null,
      settle: null,
      ma: {
        count: 0,
        tiles: null,
        detail: [],
        delta: 0,
        score: 0,
        buyerName: roster?.[4] ?? '',
        isHumanBuyer: false,
      },
      seatNames: [...names],
      viewSeat: Math.max(0, human),
      opening: null,
      dealAnimation: { playerIndex: -1, count: 0, serial: 0 },
      dealtCount: 0,
      dice: [1, 1],
      wallBreakIndex: 0,
      wallHeadDrawn: 0,
      tableActionEvent: null,
      events: [],
      lastError: null,
      humanSeat: human,
    }
  }

  function dealtCountOf(): number | null {
    if (openingValue === null) return null
    return openingValue.stage === 'deal' ? dealAnimationValue.count : 0
  }

  function refresh(): void {
    // 还没开局时只更新演出相关字段（引擎状态此时没有值）。
    if (!match.started) {
      snapshot.value = {
        ...snapshot.value,
        opening: openingValue === null ? null : { ...openingValue },
        dealAnimation: { ...dealAnimationValue },
        dealtCount: dealtCountOf(),
        dice: [...diceValue] as [number, number],
        wallBreakIndex: wallBreakValue,
        wallHeadDrawn: 0,
        tableActionEvent: tableActionValue,
        lastError: lastErrorValue,
      }
      return
    }
    const state = match.state
    humanSeatValue = humanSeatOf()
    // 在桌上 → 视角只能在你自己这把椅子上；轮空 → 保留上次的视角（默认就是刚离开的椅子），可点头像切换。
    if (humanSeatValue >= 0) viewSeatValue = humanSeatValue
    const viewSeat = ((viewSeatValue % 4) + 4) % 4
    const own = state.hands[viewSeat]
    const lastSettle = match.status === 'round-over' ? state.lastSettle : null
    snapshot.value = {
      round: match.round,
      dealer: match.dealer,
      wallCount: Math.max(0, state.wall.length - state.wallPos),
      phase: state.phase,
      turn: state.turn,
      status: match.status,
      scores: [...state.scores],
      seats: state.hands.map((hand) => ({ count: handTileCount(hand), melds: hand.melds })),
      own: own === undefined
        ? { tiles: [], drawn: null, melds: [] }
        : {
            tiles: tilesOf(own.concealed),
            drawn: own.drawnTile,
            melds: own.melds,
          },
      discards: state.discards.map((pile) => [...pile]),
      lastDiscard: state.lastDiscard === null ? null : { seat: state.lastDiscard.seat, tile: state.lastDiscard.tile },
      pending: match.pending,
      outcome: match.outcome,
      settle: settleOf(match.events),
      ma: {
        count: state.maTiles.length,
        // 码牌局中不公开：只有在结算之后才把牌面与每张的收付交给界面
        tiles: lastSettle === null ? null : [...state.maTiles],
        detail: lastSettle === null ? [] : lastSettle.maDetail.map((item) => ({ ...item })),
        delta: lastSettle === null ? 0 : lastSettle.maDelta,
        score: state.maScore,
        buyerName: match.buyerId ?? '',
        isHumanBuyer: !autoPlayAll && match.buyerId !== null && match.buyerId === humanName,
      },
      seatNames: [...state.seats],
      viewSeat,
      opening: openingValue === null ? null : { ...openingValue },
      dealAnimation: { ...dealAnimationValue },
      dealtCount: dealtCountOf(),
      dice: [...diceValue] as [number, number],
      wallBreakIndex: wallBreakValue,
      // 3D 的 `wallHeadDrawn` 是"从满墙 136 张里累计摸走了几张"，
      // 而引擎的 `wall` 只留还没摸走的牌、`wallPos` 从 0 起 —— 两者必须换算，不能直接传 wallPos。
      // **买码预留的码牌不算"被摸走"**：它们在牌墙末尾被留出来，若计进来，3D 会从牌头多抽 N 张，
      // 表现就是"摸这边、少那边"的错位。
      wallHeadDrawn: Math.max(0, WALL_SIZE - state.maTiles.length - (state.wall.length - state.wallPos)),
      tableActionEvent: tableActionValue,
      lastError: lastErrorValue,
      events: match.events,
      humanSeat: humanSeatValue,
    }
  }

  function clearTimer(): void {
    if (aiTimer !== null) {
      clearTimeout(aiTimer)
      aiTimer = null
    }
  }

  function clearCueTimer(): void {
    if (cueTimer !== null) {
      clearTimeout(cueTimer)
      cueTimer = null
    }
  }

  function clearStageTimers(): void {
    for (const timer of stageTimers) clearTimeout(timer)
    stageTimers = []
  }

  function later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      stageTimers = stageTimers.filter((item) => item !== timer)
      if (!disposed) fn()
    }, ms)
    stageTimers.push(timer)
  }

  /** 若下一个待决点是 AI，就延迟后自动落子；是真人或本局结束就停下等 UI。 */
  function scheduleAi(): void {
    clearTimer()
    if (disposed) return
    const pending = match.pending
    if (match.status !== 'playing' || pending === null) return
    if (pending.seat === humanSeatValue) return
    if (openingValue !== null) return // 开局演出期间不推进
    const delay = pending.kind === 'turn' ? AI_THINK_MS.turn : AI_THINK_MS.claim
    aiTimer = setTimeout(() => {
      aiTimer = null
      if (disposed) return
      const current = match.pending
      if (match.status !== 'playing' || current === null || current.seat === humanSeatValue) return
      applySafe(aiActionFor(current, cfg, ++seq))
    }, delay)
  }

  function applySafe(action: PlayerAction): void {
    try {
      const events = match.act(action)
      lastErrorValue = null
      publishPresentation(events)
      refresh()
      scheduleAi()
    } catch (error) {
      // 动作被引擎拒绝/内部异常：**不要**静默吞掉，也不要无限重试同一步。
      // 之前异常在 setTimeout 里被吃掉，表现是"打到一半突然没有任何反应（也没有音效）"。
      lastErrorValue = error instanceof Error ? `${error.message}` : String(error)
      clearTimer()
      refresh()
    }
  }

  /** 事件 → 桌面动作字 + 音效。 */
  function publishPresentation(events: readonly GameEvent[]): void {
    const cue = cueOf(events)
    if (cue !== null) {
      tableActionValue = cue
      clearCueTimer()
      cueTimer = setTimeout(() => {
        cueTimer = null
        if (disposed) return
        tableActionValue = null
        refresh()
      }, CUE_MS)
    }
    for (const event of events) {
      if (event.type === 'DISCARD') {
        const name = tileAudioFile(fromCode(event.tile))
        if (name !== null) sound(name)
      } else if (event.type === 'PENG') {
        sound('peng.mp3')
      } else if (event.type === 'GANG') {
        sound('gang.mp3')
      } else if (event.type === 'HU') {
        sound(event.winners.every((winner) => winner.zimo) ? 'zimo.mp3' : 'hu.mp3')
      } else if (event.type === 'QIANG_GANG_HU') {
        sound('hu.mp3')
      }
    }
  }

  function cueOf(events: readonly GameEvent[]): TableActionEvent | null {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event === undefined) continue
      if (event.type === 'PENG') {
        return { id: ++cueSeq, type: 'peng', actorIndex: event.seat, sourceIndex: null, tile: fromCode(event.tile), meldIndex: 0 }
      }
      if (event.type === 'GANG') {
        const type: TableActionType = event.gangKind === 'AN_GANG'
          ? 'concealed-gang'
          : event.gangKind === 'BU_GANG'
            ? 'added-gang'
            : 'discard-gang'
        return { id: ++cueSeq, type, actorIndex: event.seat, sourceIndex: null, tile: fromCode(event.tile), meldIndex: 0 }
      }
      if (event.type === 'HU') {
        const winner = event.winners[0]
        if (winner === undefined) continue
        return {
          id: ++cueSeq,
          type: winner.zimo ? 'self-draw' : 'discard-win',
          actorIndex: winner.seat,
          sourceIndex: event.loserSeat,
          tile: winTileOf(),
          meldIndex: 0,
        }
      }
      if (event.type === 'QIANG_GANG_HU') {
        const winner = event.winners[0]
        if (winner === undefined) continue
        return {
          id: ++cueSeq,
          type: 'robbed-kong-win',
          actorIndex: winner.seat,
          sourceIndex: event.gangSeat,
          tile: winTileOf(),
          meldIndex: 0,
        }
      }
    }
    return null
  }

  /** 桌面动作字要用一张牌做"牌面"，胡牌没有事件级牌码，退回最后一张弃牌。 */
  function winTileOf(): ReturnType<typeof fromCode> {
    const last = match.state.lastDiscard
    return fromCode(last?.tile ?? 11)
  }

  /**
   * 掷骰定庄（**这是对规则文档 Q-06「第一局房主坐庄」的产品决定变更**，见 RULES-COVERAGE.md）。
   * 两颗骰子由对局种子推导 → 同一存档点数与庄家固定。
   */
  function rollOpening(): OpeningSnapshot {
    const rng = createRng(seedValue + 97)
    const first = 1 + Math.floor(rng.next() * 6)
    const second = 1 + Math.floor(rng.next() * 6)
    const dealer = ((first + second - 1) % seats.length + seats.length) % seats.length
    return {
      stage: 'start',
      dice: [first, second],
      thrower: humanSeatValue >= 0 ? humanSeatValue : 0,
      dealer,
    }
  }

  /** 入场 → 掷骰 → 发牌。发牌只是演出：牌早就在引擎里发好了，这里把它们"一张张摆出来"。 */
  function playOpening(opening: OpeningSnapshot): void {
    openingValue = { ...opening, stage: 'start' }
    refresh()
    sound('game_start.mp3')
    later(() => {
      if (openingValue === null) return
      openingValue = { ...openingValue, stage: 'dice' }
      refresh()
      sound('dice.mp3')
      later(() => {
        if (openingValue === null) return
        openingValue = { ...openingValue, stage: 'deal' }
        refresh()
        sound('deal.mp3')
        playDealAnimation()
      }, STAGE_MS.dice)
    }, STAGE_MS.start)
  }

  function playDealAnimation(): void {
    const seatCount = seats.length
    const finish = () => {
      if (openingValue === null) return
      dealAnimationValue = { playerIndex: -1, count: 0, serial: ++dealSerial }
      openingValue = null
      refresh()
      scheduleAi()
    }
    for (let round = 1; round <= DEAL_ROUNDS; round += 1) {
      for (let seat = 0; seat < seatCount; seat += 1) {
        later(() => {
          if (openingValue === null) return
          dealAnimationValue = { playerIndex: seat, count: round, serial: ++dealSerial }
          refresh()
          if (round === DEAL_ROUNDS && seat === seatCount - 1) finish()
        }, (round - 1) * seatCount * DEAL_TICK_MS + seat * DEAL_TICK_MS)
      }
    }
    // 兜底：万一某个 tick 被丢掉（切标签页/节流），演出也要按时收尾，否则整局卡在"没牌"。
    later(finish, DEAL_ROUNDS * seatCount * DEAL_TICK_MS + 400)
  }

  const api: NanfengMatchApi = {
    snapshot,
    start() {
      clearTimer()
      clearCueTimer()
      clearStageTimers()
      tableActionValue = null
      const opening = rollOpening()
      diceValue = opening.dice
      wallBreakValue = wallBreakIndexForDealer(opening.dice, opening.dealer)
      match.begin(opening.dealer)
      refresh()
      playOpening(opening)
    },
    nextRound() {
      clearTimer()
      clearCueTimer()
      clearStageTimers()
      tableActionValue = null
      match.nextRound()
      // 换庄之后牌山开口跟着变；骰点沿用本场的（南丰只在起庄时掷骰）。
      wallBreakValue = wallBreakIndexForDealer(diceValue, match.dealer)
      refresh()
      // 后续局不掷骰（按 R-02 轮庄），但保底播一次发牌演出。
      sound('deal.mp3')
      playDealAnimation()
      openingValue = { stage: 'deal', dice: [1, 1], thrower: humanSeatValue >= 0 ? humanSeatValue : 0, dealer: match.dealer }
    },
    discard(tile: Tile) {
      if (openingValue !== null) return
      const pending = match.pending
      if (pending === null || humanSeatValue < 0 || pending.seat !== humanSeatValue || pending.kind !== 'turn') return
      applySafe({ type: 'DISCARD', seat: humanSeatValue, tile, reqId: ++seq })
    },
    submit(type: ActionOption['type']) {
      if (openingValue !== null) return
      const pending = match.pending
      if (pending === null || humanSeatValue < 0 || pending.seat !== humanSeatValue) return
      if (!pending.options.some((option) => option.type === type)) return
      const tile = pending.options.find((option) => option.type === type)?.tile ?? null
      applySafe({ type, seat: humanSeatValue, tile, reqId: ++seq })
    },
    canAct() {
      if (openingValue !== null) return false
      if (humanSeatValue < 0) return false
      const pending = match.pending
      return pending !== null && pending.seat === humanSeatValue && pending.kind === 'turn'
    },
    setViewSeat(seat: number) {
      // 只在轮空时允许切视角：在桌上切到别人那儿等于看别人的手牌，而且会把自己的牌桌弄乱。
      if (!match.started) return
      if (humanSeatOf() >= 0) return
      if (!Number.isInteger(seat) || seat < 0 || seat >= seats.length) return
      viewSeatValue = seat
      refresh()
    },
  }

  refresh()
  onScopeDispose(() => {
    disposed = true
    clearTimer()
    clearCueTimer()
    clearStageTimers()
  })

  return api
}

function tilesOf(counts: Uint8Array): Tile[] {
  const tiles: Tile[] = []
  for (let tile = 0; tile < counts.length; tile++) {
    for (let k = 0; k < counts[tile]; k++) tiles.push(tile)
  }
  return tiles
}

function settleOf(events: readonly GameEvent[]): SettleSnapshot | null {
  for (const event of events) {
    if (event.type === 'SETTLE') {
      return {
        deltas: [...event.deltas],
        detail: event.detail,
        maDelta: event.maDelta,
        maDetail: event.maDetail.map((item) => ({ ...item })),
      }
    }
  }
  return null
}
