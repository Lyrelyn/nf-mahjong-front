// 按座位脱敏：把房主手里的权威状态压成"这个客机该看到的那一份" `NanfengSnapshot`。
//
// 两条铁律：
//   1. **别人的暗牌一张都不出去**——`own` 只放目标座位自己的手牌，其余只给张数；
//   2. **轮空买码者（观战）一手牌都不给**——`seat === null` 时 `own` 恒为空，
//      即使他在界面上点头像切视角，切到的也只是牌河/副露这些公开信息。
//
// 结算之后码牌才公开（与单机一致）：`ma.tiles` 在 `round-over` 之前恒为 null。
import type { GameEvent } from '../state/apply'
import type { GameState } from '../state/gameState'
import type { Phase } from '../state/phase'
import type { MatchStatus, PendingDecision } from '../runtime/match'
import { handTileCount } from '../action/hand'
import { WALL_SIZE, type Tile } from '../tiles'
import type { NanfengSnapshot, SettleSnapshot } from '../useNanfengMatch'

/** 房主侧的一份"权威来源"：状态机 + 少量不在状态机里的场次信息。 */
export interface SeatSnapshotSource {
  state: GameState
  status: MatchStatus
  round: number
  dealer: number
  /** 本局轮空买码的人；`null` = 没有第 5 个人（4 人局）。 */
  buyerId: string | null
}

export interface SeatSnapshotOptions {
  /** 这份快照给谁：引擎座位 0..3；`null` = 观战者（轮空买码，不公开任何暗牌）。 */
  seat: number | null
  /** 观战时的镜头座位：只影响 3D 朝向/牌墙开口，不影响暗牌。 */
  spectatorSeat?: number
  /** 开局骰点（发牌演出的朝向用）。 */
  dice?: [number, number]
  /** 牌山断点（绝对物理张位）。 */
  wallBreakIndex?: number
  /** 房主侧当前的待决动作；只有轮到 `seat` 时才会下发。 */
  pending?: PendingDecision | null
}

function tilesOf(counts: Uint8Array): Tile[] {
  const tiles: Tile[] = []
  for (let tile = 0; tile < counts.length; tile += 1) {
    for (let copy = 0; copy < counts[tile]; copy += 1) tiles.push(tile)
  }
  return tiles
}

/** 结算明细 → 快照结构（只拷值，别把权威状态里的数组递出去）。 */
function settleOf(state: GameState, status: MatchStatus): SettleSnapshot | null {
  if (status !== 'round-over' || state.lastSettle === null) return null
  const settled = state.lastSettle
  return {
    deltas: [...settled.deltas],
    detail: settled.detail,
    maDelta: settled.maDelta,
    maDetail: settled.maDetail.map((item) => ({ ...item })),
  }
}

/**
 * 打出"这个座位能看的那份快照"。
 *
 * 与单机 `useNanfengMatch` 的快照**同形**：客机拿到的就是一张可以直接喂给 `projectToTable`
 * 的快照，所以牌桌组件不用为联机再写一套。
 */
export function seatSnapshot(
  source: SeatSnapshotSource,
  options: SeatSnapshotOptions,
): NanfengSnapshot {
  const { state, status, round, dealer, buyerId } = source
  const { seat, spectatorSeat = 0, dice = [1, 1], wallBreakIndex = 0, pending = null } = options
  const settled = settleOf(state, status)
  const own = seat === null ? undefined : state.hands[seat]
  // 视角座位：自己就坐自己那把椅子；观战者只能借用一把椅子当镜头（暗牌仍然为空）。
  const viewSeat = seat === null ? ((spectatorSeat % 4) + 4) % 4 : seat
  // 只把"轮到他自己"的待决动作发出去，并且**剥掉 AI 视野**（`view` 里有别人手牌的估计值）。
  const ownPending: PendingDecision | null = pending !== null && seat !== null && pending.seat === seat
    ? { ...pending, view: {} as never }
    : null

  return {
    round,
    dealer,
    wallCount: Math.max(0, state.wall.length - state.wallPos),
    phase: state.phase as Phase,
    turn: state.turn,
    status,
    scores: [...state.scores],
    seats: state.hands.map((hand) => ({ count: handTileCount(hand), melds: hand.melds })),
    own: own === undefined
      ? { tiles: [], drawn: null, melds: [] }
      : { tiles: tilesOf(own.concealed), drawn: own.drawnTile, melds: own.melds },
    discards: state.discards.map((pile) => [...pile]),
    lastDiscard: state.lastDiscard === null
      ? null
      : { seat: state.lastDiscard.seat, tile: state.lastDiscard.tile },
    pending: ownPending,
    outcome: status === 'round-over' ? source.state.lastOutcome : null,
    settle: settled,
    ma: {
      count: state.maTiles.length,
      // 局中不公开；结算后才有牌面
      tiles: settled === null ? null : [...state.maTiles],
      detail: settled === null ? [] : settled.maDetail.map((item) => ({ ...item })),
      delta: settled === null ? 0 : settled.maDelta,
      score: state.maScore,
      buyerName: buyerId ?? '',
      // 观战者就是买码者本人；在桌上的人不是
      isHumanBuyer: seat === null && buyerId !== null,
    },
    seatNames: [...state.seats],
    viewSeat,
    // 发牌演出由客机按本地时间线自己播（房主的演出进度不占带宽）
    opening: null,
    dealAnimation: { playerIndex: -1, count: 0, serial: 0 },
    dealtCount: null,
    tableActionEvent: null,
    dice: [dice[0], dice[1]],
    wallBreakIndex,
    // 码牌不留"已摸走"的错觉：见 useNanfengMatch 里同一段注释
    wallHeadDrawn: Math.max(0, WALL_SIZE - state.maTiles.length - (state.wall.length - state.wallPos)),
    // 事件流可能带摸牌牌面，对客机一律不发
    events: [] as readonly GameEvent[],
    lastError: null,
    humanSeat: seat === null ? -1 : seat,
  }
}
