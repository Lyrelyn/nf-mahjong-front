// 后端 `state_snapshot` → 前端 `NanfengSnapshot` 的**纯函数映射**。
//
// 联系点：`nf-mahjong-backend` 的 `RoomSession.snapshot_for()` + `project_view()`
// （字段清单见 `docs/nanfeng-online-integration-plan.md` §10.5）。
//
// 三条契约（实测得出）：
//   1. `seq` 单调：调用方保存 `lastAppliedSeq`，`seq <= last` 的快照直接丢（本函数不做判断）；
//   2. 事件帧（`discard_bc` / `meld_bc` / `settle` …）**可以完全忽略** —— 每次状态变化服务端都会
//      跟一份新快照，只吃快照不会掉状态；
//   3. 轮空买码者是 `viewer.kind === 'spectator'` 且 `hand === null`；换座后 `viewer.seat` 会变，
//      所以 `humanSeat` 每次都要重算，不能在客户端缓存。
//
// 属于纯净层（不放 UI/时钟/随机），可单测。
import type { Meld } from '../melds'
import type { Phase } from '../state/phase'
import type { Tile } from '../tiles'
import type { ActionOption } from '../action/options'
import type {
  MaSnapshot,
  NanfengSnapshot,
  SettleSnapshot,
} from '../useNanfengMatch'

/** 一条可选动作（后端 `_option_payload` 的形状）。 */
export interface WsOption {
  type: ActionOption['type']
  priority?: number
  distance?: number
  tile: number | null
  huPreview?: unknown
}

/** 后端快照里我们真正读到的字段（其余字段忽略）。 */
export interface WsSnapshotPayload {
  seq: number
  roomId: string
  /** 本房间真实连接位数：4 = 没有轮空买码位；5 = 有。**别再假设 5**。 */
  capacity?: number
  matchLength?: number
  matchFinished?: boolean
  maCount: number
  seating: { table: (number | null)[]; sittingOut: number | null }
  slots: ({ slot: number; nickname: string; avatar: string; ready: boolean; connected: boolean } | null)[]
  totalScores?: Record<string, number>
  // ---- 引擎投影（`project_view`）----
  round: number
  phase: string
  dealer: number
  turn: number
  wallLeft: number
  scores: number[]
  roundGangScore?: number[]
  discards: number[][]
  melds: { kind: Meld['kind']; tile: number; fromSeat: number | null }[][]
  handSizes: number[]
  lastDiscard: { seat: number; tile: number } | null
  claim: {
    triggerSeat: number
    triggerTile: number
    gangSeat: number | null
    pending: number[]
    deadlineAt: number | null
    options: WsOption[]
  } | null
  maScore?: number
  lastSettle: {
    deltas: number[]
    detail: SettleSnapshot['detail']
    maDelta: number
    maDetail: { tile: number; seat: number; delta: number }[]
  } | null
  viewer: { kind: 'player' | 'spectator'; seat: number | null }
  hand: { concealed: number[]; drawnTile: number | null; melds: WsSnapshotPayload['melds'][number]; justPeng?: boolean } | null
  options: WsOption[]
}

/** 骰点只有房主权威的本地对局才有；服务端不发（只影响牌山开口的观感）。 */
const FALLBACK_DICE: [number, number] = [1, 1]
/** 一副牌 136 张。 */
const WALL_SIZE = 136

function seatName(payload: WsSnapshotPayload, tableSeat: number): string {
  const slot = payload.seating.table[tableSeat]
  if (slot === null || slot === undefined) return `座位${tableSeat + 1}`
  return payload.slots[slot]?.nickname ?? `座位${tableSeat + 1}`
}

/** 买码位：本局轮空的人。没轮空（4 人局）时 `count` 为 0。 */
function maOf(payload: WsSnapshotPayload, humanSeat: number): MaSnapshot {
  const sittingOut = payload.seating.sittingOut
  const buyerName = sittingOut === null ? '' : (payload.slots[sittingOut]?.nickname ?? '')
  const detail = payload.lastSettle?.maDetail ?? []
  // 我这一局轮空 → 买码的就是"你"
  const isHumanBuyer = humanSeat < 0 && payload.maCount > 0
  return {
    count: payload.maCount ?? 0,
    // 码牌局中不公开：只有结算帧/结算快照里才带牌面
    tiles: detail.length > 0 ? detail.map((item) => item.tile as Tile) : null,
    detail: detail as MaSnapshot['detail'],
    delta: payload.lastSettle?.maDelta ?? 0,
    score: payload.maScore ?? 0,
    buyerName,
    // "我是买码的人" = 我这一局轮空（观战）。以前写成 `buyerName !== ''`，
    // 结果 5 人房里**所有人都**看到买码席写着"你"。
    isHumanBuyer,
  }
}

/**
 * 把后端快照翻成牌桌要的形状。
 *
 * `humanSeat` = 这一局我坐哪把椅子（观战为 -1）；`viewSeat` 在观战时由调用方改
 * （点头像切视角），所以既接受 `viewSeat` 也接受 `null`。
 */
export function wsSnapshotToNanfeng(
  payload: WsSnapshotPayload,
  opts: { viewSeat?: number | null; lastError?: string | null } = {},
): NanfengSnapshot {
  const humanSeat = payload.viewer.kind === 'player' && payload.viewer.seat !== null
    ? payload.viewer.seat
    : -1
  const viewSeat = opts.viewSeat ?? (humanSeat >= 0 ? humanSeat : 0)
  const roundOver = payload.lastSettle !== null || payload.matchFinished === true
  const hand = payload.hand

  return {
    round: payload.round,
    dealer: payload.dealer,
    wallCount: payload.wallLeft,
    // 服务端与本仓库是同一套引擎的 1:1 移植，phase 字符串直接透传
    phase: payload.phase as Phase,
    turn: payload.turn,
    status: roundOver ? 'round-over' : 'playing',
    scores: payload.scores,
    seatNames: [0, 1, 2, 3].map((seat) => seatName(payload, seat)),
    seats: payload.handSizes.map((count, seat) => ({
      count,
      melds: (payload.melds[seat] ?? []) as Meld[],
    })),
    own: {
      tiles: (hand?.concealed ?? []) as Tile[],
      drawn: (hand?.drawnTile ?? null) as Tile | null,
      melds: (hand?.melds ?? []) as Meld[],
    },
    discards: payload.discards as Tile[][],
    lastDiscard: payload.lastDiscard === null
      ? null
      : { seat: payload.lastDiscard.seat, tile: payload.lastDiscard.tile as Tile },
    pending: pendingOf(payload, humanSeat),
    outcome: null,
    settle: payload.lastSettle === null ? null : (payload.lastSettle as SettleSnapshot),
    ma: maOf(payload, humanSeat),
    viewSeat,
    opening: null,
    dealAnimation: { playerIndex: -1, count: 0, serial: 0 },
    dealtCount: null,
    tableActionEvent: null,
    dice: FALLBACK_DICE,
    wallBreakIndex: 0,
    wallHeadDrawn: WALL_SIZE - (payload.maCount ?? 0) - payload.wallLeft,
    events: [],
    lastError: opts.lastError ?? null,
    humanSeat,
  }
}

/** 待决动作：鸣牌窗口来自 `claim`，自己的回合来自 `options`（后端不会同时给两者）。 */
function pendingOf(payload: WsSnapshotPayload, humanSeat: number): NanfengSnapshot['pending'] {
  const claim = payload.claim
  if (claim !== null && humanSeat >= 0 && claim.pending.includes(humanSeat)) {
    return {
      kind: 'claim',
      seat: humanSeat,
      options: claim.options as ActionOption[],
      tile: claim.triggerTile as Tile,
      from: claim.triggerSeat,
      // 服务端不发明细的 AI 视野；这里只给投影层用不到的空壳
      view: {} as never,
    }
  }
  if (claim === null && humanSeat >= 0 && payload.phase === 'WAITING_PLAY' && payload.turn === humanSeat) {
    return {
      kind: 'turn',
      seat: humanSeat,
      options: payload.options as ActionOption[],
      tile: null,
      from: null,
      view: {} as never,
    }
  }
  return null
}
