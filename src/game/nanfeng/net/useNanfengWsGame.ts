// 南丰 × 自有 WS 后端（`nf-mahjong-backend`）的对局客户端。
//
// 与 `useNanfengGuest` 同形：**收快照 → 渲染，动作 → 发出去**，实现同一个 `NanfengMatchApi`，
// 所以 `NanfengTable` 不用区分单机 / VibeHub P2P / WS。
//
// 和 P2P 的差别（都来自后端实测，见 `docs/nanfeng-online-integration-plan.md` §10）：
//   1. 权威在服务端，本端**不做任何规则判断**，非法动作由服务端回 `{kind:'error'}`；
//   2. 快照带 `seq`，`seq <= lastAppliedSeq` 直接丢（重连补发/重放）；
//   3. 事件帧（`discard_bc` / `meld_bc` / `settle` / `draw` …）**全部忽略** ——
//      每次状态变化服务端都会跟一份新快照，只吃快照不会掉状态；
//   4. 开局、换局、掉线代打都由服务端驱动，本端 `start()` / `nextRound()` 是空操作。
//
// 传输不在这里：调用方把 WS 收到的消息喂给 `receive(raw)`，把 `send(message)`
// 接到 `roomSocket.send`。这样这层可以在 node 里直接单测。
import { shallowRef } from 'vue'
import {
  createEmptyNanfengSnapshot,
  type NanfengMatchApi,
  type NanfengSnapshot,
} from '../useNanfengMatch'
import { wsSnapshotToNanfeng, type WsSnapshotPayload } from './wsSnapshot'

export interface NanfengWsOptions {
  /** 本局座位名（首帧之前顶着用；收到快照后会被后端数据覆盖）。 */
  seatNames?: readonly string[]
  /** 发一条消息给服务端（调用方接 `roomSocket.send`）。 */
  send: (message: Record<string, unknown>) => void
}

export interface NanfengWsGame {
  api: NanfengMatchApi
  /** 把服务端发来的一帧喂进来（非 `state_snapshot` 会被忽略）。 */
  receive: (raw: unknown) => void
  /** 已应用到第几帧：调试/测试用。 */
  lastAppliedSeq: () => number
  /** 最近一次服务端返回的错误（`{kind:'error'}`）；没有则为 null。 */
  lastError: () => string | null
}

function isSnapshotFrame(raw: unknown): raw is WsSnapshotPayload & { kind: string } {
  return typeof raw === 'object' && raw !== null
    && (raw as { kind?: unknown }).kind === 'state_snapshot'
    && typeof (raw as { seq?: unknown }).seq === 'number'
}

export function useNanfengWsGame(options: NanfengWsOptions): NanfengWsGame {
  const snapshot = shallowRef<NanfengSnapshot>(
    createEmptyNanfengSnapshot(options.seatNames ?? ['本家', '下家', '对家', '上家']),
  )
  let appliedSeq = -1
  let reqId = 0
  let lastError: string | null = null
  /** 轮空观战时点头像选的镜头座位：纯本地表现，不会被快照覆盖。 */
  let spectatorView: number | null = null

  function send(message: Record<string, unknown>): void {
    options.send(message)
  }

  function receive(raw: unknown): void {
    if (typeof raw === 'string') {
      try {
        receive(JSON.parse(raw) as unknown)
      } catch {
        // 坏包直接丢
      }
      return
    }
    if (typeof raw !== 'object' || raw === null) return

    const kind = (raw as { kind?: unknown }).kind
    if (kind === 'error') {
      const code = (raw as { code?: unknown }).code
      lastError = typeof code === 'string' ? code : 'ERROR'
      snapshot.value = { ...snapshot.value, lastError }
      return
    }
    if (kind === 'rejoin_err') {
      const code = (raw as { code?: unknown }).code
      lastError = typeof code === 'string' ? code : 'REJOIN_FAILED'
      snapshot.value = { ...snapshot.value, lastError }
      return
    }
    if (!isSnapshotFrame(raw)) return

    // 旧帧（重连补发 / 重放）直接丢
    if (raw.seq <= appliedSeq) return
    appliedSeq = raw.seq
    lastError = null

    // 观战时保留本地选的镜头；在桌上则永远从自己看出去。
    const viewerSeat = raw.viewer.kind === 'player' ? raw.viewer.seat : null
    const viewSeat = viewerSeat === null ? (spectatorView ?? undefined) : null
    snapshot.value = wsSnapshotToNanfeng(raw, { viewSeat, lastError: null })
  }

  const api: NanfengMatchApi = {
    snapshot,
    /** 服务端开局由 REST `/start` 触发，这里不用做事。 */
    start() {},
    /** 换局同样由服务端自动推进。 */
    nextRound() {},
    discard(tile) {
      const snap = snapshot.value
      if (snap.humanSeat < 0) return
      if (snap.pending === null || snap.pending.kind !== 'turn' || snap.pending.seat !== snap.humanSeat) return
      send({ kind: 'action', type: 'DISCARD', tile, reqId: ++reqId })
    },
    submit(type) {
      const snap = snapshot.value
      if (snap.humanSeat < 0 || snap.pending === null || snap.pending.seat !== snap.humanSeat) return
      const option = snap.pending.options.find((item) => item.type === type)
      if (option === undefined) return
      send({ kind: 'action', type, tile: option.tile ?? null, reqId: ++reqId })
    },
    canAct() {
      const snap = snapshot.value
      return snap.humanSeat >= 0
        && snap.pending !== null
        && snap.pending.kind === 'turn'
        && snap.pending.seat === snap.humanSeat
    },
    setViewSeat(seat: number) {
      const snap = snapshot.value
      // 在桌上时锁死自己座位；轮空时只切镜头（服务端本来就没给暗牌）。
      if (snap.humanSeat >= 0) return
      if (!Number.isInteger(seat) || seat < 0 || seat >= 4) return
      spectatorView = seat
      snapshot.value = { ...snap, viewSeat: seat }
    },
    applyRemote() {
      return { ok: false, error: 'WS 模式由服务端权威，客户端不能替别人落子' }
    },
  }

  return {
    api,
    receive,
    lastAppliedSeq: () => appliedSeq,
    lastError: () => lastError,
  }
}
