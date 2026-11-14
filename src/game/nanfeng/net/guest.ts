// 联机客机：只负责"把房主发来的那份快照放到界面上 + 把自己的动作发出去"。
//
// 它实现的是与单机完全相同的 `NanfengMatchApi`，所以 `NanfengTable` 不用区分单机/联机。
// 客机**不做任何规则判断**：能不能出牌看的是房主快照里的 `pending`，
// 出了非法动作房主会直接丢掉，下一次快照自然把界面纠正回来。
//
// 属于纯净层：不得使用 Math.random / Date.now / fetch（`boundary.test.ts` 会拦）。
import { shallowRef } from 'vue'
import {
  createEmptyNanfengSnapshot,
  type NanfengMatchApi,
  type NanfengSnapshot,
} from '../useNanfengMatch'
import {
  NANFENG_PROTOCOL_VERSION,
  decodeNanfengMessage,
  type NanfengGuestMessage,
} from './protocol'

export interface NanfengGuestOptions {
  /** 发给房主（房间层负责编码/分片：`sendChunked(room, message)`）。 */
  send: (message: NanfengGuestMessage) => void
  /** 首帧之前先顶着的座位名（收到房主快照后会被覆盖）。 */
  seatNames?: readonly string[]
  nickname?: string
  avatar?: string
}

export interface NanfengGuest {
  /** 喂给 `NanfengTable` 的对局 API。 */
  api: NanfengMatchApi
  /** 收到房主消息（原始字符串或对象都行）。 */
  receive: (raw: unknown) => void
}

export function useNanfengGuest(options: NanfengGuestOptions): NanfengGuest {
  const snapshot = shallowRef(createEmptyNanfengSnapshot(options.seatNames ?? ['本家', '下家', '对家', '上家']))
  let reqId = 0
  /** 轮空观战时点头像选的镜头座位（房主只给公开信息，视角切换是纯本地表现）。 */
  let spectatorView: number | null = null

  function send(message: NanfengGuestMessage): void {
    options.send(message)
  }

  function receive(raw: unknown): void {
    const message = decodeNanfengMessage(raw)
    if (message === null) return

    if (message.t === 'round_start') {
      // 新一轮：先把上一局的结算清掉，别让客机还挂着旧面板等首帧。
      snapshot.value = {
        ...snapshot.value,
        round: message.round,
        dealer: message.dealer,
        dice: [message.dice[0], message.dice[1]],
        wallBreakIndex: message.wallBreakIndex,
        status: 'playing',
        outcome: null,
        settle: null,
        pending: null,
      }
      return
    }

    if (message.t === 'snapshot') {
      const incoming: NanfengSnapshot = message.snapshot
      snapshot.value = {
        ...incoming,
        viewSeat: incoming.humanSeat >= 0
          ? incoming.viewSeat
          : (spectatorView ?? incoming.viewSeat),
        ma: { ...incoming.ma },
      }
      return
    }

    if (message.t === 'match_end') {
      snapshot.value = {
        ...snapshot.value,
        lastError: message.message
          ?? (message.reason === 'closed' ? '房间已关闭' : '对局已结束'),
      }
    }
  }

  const api: NanfengMatchApi = {
    snapshot,
    /** 客机开局 = 向房主报到（房间层已经分配了座位）。 */
    start() {
      send({
        t: 'hello',
        v: NANFENG_PROTOCOL_VERSION,
        nickname: options.nickname ?? '玩家',
        avatar: options.avatar,
      })
    },
    nextRound() {
      send({ t: 'next_round', v: NANFENG_PROTOCOL_VERSION, reqId: ++reqId })
    },
    discard(tile) {
      const snap = snapshot.value
      if (snap.humanSeat < 0) return
      if (snap.pending === null || snap.pending.kind !== 'turn' || snap.pending.seat !== snap.humanSeat) return
      const id = ++reqId
      send({
        t: 'action',
        v: NANFENG_PROTOCOL_VERSION,
        reqId: id,
        action: { type: 'DISCARD', seat: snap.humanSeat, tile, reqId: id },
      })
    },
    submit(type) {
      const snap = snapshot.value
      if (snap.humanSeat < 0 || snap.pending === null || snap.pending.seat !== snap.humanSeat) return
      const option = snap.pending.options.find((item) => item.type === type)
      if (option === undefined) return
      const id = ++reqId
      send({
        t: 'action',
        v: NANFENG_PROTOCOL_VERSION,
        reqId: id,
        action: { type, seat: snap.humanSeat, tile: option.tile, reqId: id },
      })
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
      // 在桌上时锁死自己座位（和单机一致）；轮空时只能切镜头，看不到暗牌。
      if (snap.humanSeat >= 0) return
      if (!Number.isInteger(seat) || seat < 0 || seat >= 4) return
      spectatorView = seat
      snapshot.value = { ...snap, viewSeat: seat }
    },
    applyRemote() {
      return { ok: false, error: '客机不能替别人落子' }
    },
  }

  return { api, receive }
}
