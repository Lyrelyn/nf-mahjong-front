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
  /**
   * 音效出口（与 `useNanfengMatch` 同一个签名）。
   *
   * WS 模式下引擎在服务端，没有 `GameEvent` 可播，所以靠**快照差分**判断该响什么：
   * 新牌进牌河 = 出牌、副露变多 = 碰/杠、结算出现 = 胡、自己摸到新牌 = 摸牌。
   */
  playSound?: (name: string, volume?: number) => void
}

export interface NanfengWsGame {
  api: NanfengMatchApi
  /** 把服务端发来的一帧喂进来（非 `state_snapshot` 会被忽略）。 */
  receive: (raw: unknown) => void
  /** 已应用到第几帧：调试/测试用。 */
  lastAppliedSeq: () => number
  /** 最近一次服务端返回的错误（`{kind:'error'}`）；没有则为 null。 */
  lastError: () => string | null
  /**
   * 后补音效出口：牌桌挂载时把自己的播放器塞进来。
   *
   * 比"从页面根组件一路传下来"可靠——`NanfengTable` 本来就是音频的消费方，
   * 单机时它也是这么取的，两边行为一致。重复调用以最后一次为准。
   */
  setSoundSink: (sink: (name: string, volume?: number) => void) => void
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
  let sound = options.playSound ?? (() => {})
  let appliedSeq = -1
  let reqId = 0
  let lastError: string | null = null
  /** 开局音效只放一次（WS 模式没有本地开局演出，只能靠第一份真牌局快照触发）。 */
  let playedStart = false
  /** 本地假演：当前"已发到手上几张"；`null` = 演出结束（按真实手牌显示）。 */
  let revealed: number | null = null
  let revealTimer: ReturnType<typeof setInterval> | null = null

  /**
   * 本地补一段发牌动画：0 → 13 张，约 0.9 秒。
   *
   * 纯表现：不碰服务端状态，也不影响任何判定。演完 `revealed` 归 null，
   * 投影层就按真实手牌渲染（自摸那张仍然单独摆开）。
   */
  function startOpening(_dealer: number): void {
    if (revealTimer !== null) clearInterval(revealTimer)
    revealed = 0
    revealTimer = setInterval(() => {
      if (revealed === null) return
      revealed += 1
      const snap = snapshot.value
      snapshot.value = {
        ...snap,
        dealtCount: revealed,
        opening: { stage: 'deal', dice: snap.dice, thrower: snap.dealer, dealer: snap.dealer },
      }
      if (revealed >= 13) {
        if (revealTimer !== null) clearInterval(revealTimer)
        revealTimer = null
        revealed = null
        snapshot.value = { ...snapshot.value, dealtCount: null, opening: null }
      }
    }, 70)
  }
  /** 轮空观战时点头像选的镜头座位：纯本地表现，不会被快照覆盖。 */
  let spectatorView: number | null = null

  function send(message: Record<string, unknown>): void {
    options.send(message)
  }

  /**
   * 靠快照差分补音效。
   *
   * 服务端只推快照，不发明细事件，所以只能比"上一帧 vs 这一帧"：
   * 牌河变长 → 出牌；副露变多 → 碰/杠；结算出现 → 胡；自己多了一张摸牌 → 摸牌。
   */
  function playDiff(prev: NanfengSnapshot, next: NanfengSnapshot): void {
    const count = <T,>(list: readonly T[]): number => list.length
    const discards = (snap: NanfengSnapshot): number => snap.discards.reduce((sum, pile) => sum + count(pile), 0)
    const melds = (snap: NanfengSnapshot): number => snap.seats.reduce((sum, seat) => sum + count(seat.melds), 0)

    if (prev.status === 'playing' && next.status === 'round-over' && next.settle !== null) {
      sound('hu.mp3')
      return
    }
    if (melds(next) > melds(prev)) {
      const last = next.seats.flatMap((seat) => seat.melds).slice(-1)[0]
      sound(last !== undefined && last.kind !== 'PENG' ? 'gang.mp3' : 'peng.mp3')
      return
    }
    if (discards(next) > discards(prev)) {
      sound('discard.mp3')
      return
    }
    if (prev.own.drawn === null && next.own.drawn !== null) sound('draw.mp3')
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

    // 开局演出（**本地假演**）：服务端一次就把 13/14 张全给你，没有"发牌过程"这回事。
    // 这里自己补一段 0→13 张的揭示动画 + 一声开局音，让进桌不是一个瞬间跳变。
    if (!playedStart && raw.phase !== 'LOBBY') {
      playedStart = true
      sound('game_start.mp3')
      startOpening(raw.dealer)
    }
    const previous = snapshot.value
    const next = wsSnapshotToNanfeng(raw, { viewSeat, lastError: null })
    // 演出期间覆盖"已发到手上几张"，投影层会把每家手牌截断到这个张数。
    if (revealed !== null) {
      next.dealtCount = revealed
      next.opening = { stage: 'deal', dice: next.dice, thrower: next.dealer, dealer: next.dealer }
    }
    snapshot.value = next
    if (revealed === null) playDiff(previous, next)
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
    // 牌桌会通过 `api.setSoundSink` 把播放器塞进来（`NanfengTable` 的 onMounted）。
    // 注意必须挂在 `api` 上：牌桌拿到的是 api，不是这个 composable 的返回对象。
    setSoundSink(sink) {
      sound = sink
    },
  }

  return {
    api,
    receive,
    lastAppliedSeq: () => appliedSeq,
    lastError: () => lastError,
    setSoundSink: (sink) => { sound = sink },
  }
}
