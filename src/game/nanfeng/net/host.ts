// 联机房主：本地跑权威对局，把"每个人只该看到的那份"广播出去，并接客机的动作。
//
// 复用旧的房间/传输层（`vibeRoom` + `vibeRoomTransport`）：这一层只管
// 「谁该收到什么」与「客机的动作能不能落」，不碰 SDK、不碰 DOM。
//
// 属于纯净层：不得使用 Math.random / Date.now / fetch（`boundary.test.ts` 会拦）。
import { useNanfengMatch, type NanfengMatchApi, type RoundStateForNet } from '../useNanfengMatch'
import { seatSnapshot } from './seatSnapshot'
import {
  NANFENG_PROTOCOL_VERSION,
  decodeNanfengMessage,
  type NanfengHostMessage,
} from './protocol'

export interface NanfengHostOptions {
  /** 4 个座位名（开局时的椅子顺序）。 */
  seats: readonly string[]
  /** 第 5 个人（轮空买码者）；不给就是 4 人局。 */
  buyerId?: string
  maCount?: number
  seed: number
  /** 发给某个客机（房间层负责编码/分片：`sendChunked(room, message, peerId)`）。 */
  sendTo: (peerId: string, message: NanfengHostMessage) => void
  /** 当前房间里的客机 peerId。 */
  peers: () => readonly string[]
  /** peerId → 人名。按**人名**而不是座位号对齐：5 人换座每局椅子都会换人。 */
  personOf: (peerId: string) => string | undefined
  /** 房主自己也交给 AI（自测用）。 */
  autoPlay?: boolean
}

export interface NanfengHost {
  /** 房主自己的对局 API（喂给 `NanfengTable`）。 */
  api: NanfengMatchApi
  /** 收到客机消息（原始字符串或已解码对象都行；解不出来就丢弃）。 */
  receive: (peerId: string, raw: unknown) => void
}

export function useNanfengHost(options: NanfengHostOptions): NanfengHost {
  let seq = 0
  let lastRound = -1

  /** 当前在房间里的真人名字（轮换后人会换椅子，所以按名字判断是不是远端真人）。 */
  function peerPersons(): Set<string> {
    const names = new Set<string>()
    for (const peerId of options.peers()) {
      const person = options.personOf(peerId)
      if (person !== undefined) names.add(person)
    }
    return names
  }

  // 5 人换座要传 5 个名字的名册：名册第一个是房主本人。
  const roster = options.buyerId === undefined ? undefined : [...options.seats, options.buyerId]
  const api = useNanfengMatch({
    seats: options.seats,
    roster,
    maCount: options.maCount,
    seed: options.seed,
    autoPlay: options.autoPlay,
    onRoundState: publish,
    // 远端真人坐的椅子必须等他自己的动作：房主的 AI 替他打出去就等于抢了他的牌。
    isRemoteSeat: (_seat, person) => peerPersons().has(person),
  })

  function send(peerId: string, message: NanfengHostMessage): void {
    options.sendTo(peerId, message)
  }

  /** 每次状态变化：先按需发 round_start，再给每个客机发他自己那份快照。 */
  function publish(source: RoundStateForNet): void {
    seq += 1
    const peers = options.peers()
    if (source.round !== lastRound) {
      lastRound = source.round
      for (const peerId of peers) {
        send(peerId, {
          t: 'round_start',
          v: NANFENG_PROTOCOL_VERSION,
          seq,
          round: source.round,
          dealer: source.dealer,
          dice: source.dice,
          wallBreakIndex: source.wallBreakIndex,
        })
      }
    }
    for (const peerId of peers) {
      const person = options.personOf(peerId)
      const seat = person === undefined ? -1 : source.state.seats.indexOf(person)
      const snapshot = seatSnapshot(
        {
          state: source.state,
          status: source.status,
          round: source.round,
          dealer: source.dealer,
          buyerId: source.buyerId,
        },
        {
          // 找不到人 = 本局轮空买码（观战）：一手暗牌都不给。
          seat: seat < 0 ? null : seat,
          spectatorSeat: source.dealer,
          dice: source.dice,
          wallBreakIndex: source.wallBreakIndex,
          pending: source.pending,
        },
      )
      send(peerId, {
        t: 'snapshot',
        v: NANFENG_PROTOCOL_VERSION,
        seq,
        seat: seat < 0 ? null : seat,
        snapshot,
      })
    }
  }

  function receive(peerId: string, raw: unknown): void {
    const message = decodeNanfengMessage(raw)
    if (message === null) return

    if (message.t === 'action') {
      const person = options.personOf(peerId)
      const seat = person === undefined ? -1 : api.snapshot.value.seatNames.indexOf(person)
      // 只能替**自己这把椅子**落子；轮空的人没有椅子，直接忽略。
      if (seat < 0) return
      if (message.action.seat !== seat) return
      api.applyRemote({ ...message.action, seat, reqId: message.reqId })
      return
    }

    if (message.t === 'next_round') {
      // 谁都可以请求开下一局，但只有本局真的结束了才生效。
      if (api.snapshot.value.status === 'round-over') api.nextRound()
    }
  }

  return { api, receive }
}
