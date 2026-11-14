// 南丰联机协议：房主权威 + 按座位脱敏快照。
//
// 与旧莲花 P2P 的区别：旧协议传的是 `ServerSnapshot`（旧引擎的 GamePort 形状），
// 南丰多了「5 人换座」和「买码」，所以对局同步这一段用南丰自己的快照（`NanfengSnapshot`）——
// 客机因此可以直接复用现成的 `NanfengTable` / `projectToTable`，不用再写一套投影。
//
// 本文件只做类型与编解码，不碰房间/定时器（那些在 `useNanfengOnline.ts` 与旧房间层里）。
// 属于纯净层：不得使用 Math.random / Date.now / fetch（`boundary.test.ts` 会拦）。
import type { PlayerAction } from '../action/options'
import type { NanfengSnapshot } from '../useNanfengMatch'

/** 协议版本：房主与客机不一致时直接拒绝，别用半套字段跑起来。 */
export const NANFENG_PROTOCOL_VERSION = 1

/** 房主 → 所有人：一局开始时给客机发骰点与庄家（发牌演出由客机自己按本地时间线播）。 */
export interface NanfengRoundStartMessage {
  t: 'round_start'
  v: number
  seq: number
  round: number
  dealer: number
  dice: [number, number]
  wallBreakIndex: number
}

/**
 * 房主 → 某个客机：**只给他该看的那份**快照。
 *
 * `seat` 为 `null` 表示观战者（本局轮空买码）：一手暗牌都不给。
 * 脱敏在 `seatSnapshot.ts` 里做，这里只负责信封。
 */
export interface NanfengSeatSnapshotMessage {
  t: 'snapshot'
  v: number
  seq: number
  seat: number | null
  snapshot: NanfengSnapshot
}

/** 房主 → 所有人：本场结束 / 房间关闭。 */
export interface NanfengMatchEndMessage {
  t: 'match_end'
  v: number
  seq: number
  reason: 'closed' | 'left' | 'error'
  message?: string
}

export type NanfengHostMessage =
  | NanfengRoundStartMessage
  | NanfengSeatSnapshotMessage
  | NanfengMatchEndMessage

/** 客机 → 房主：报到（房间层已经分配了座位，这里只带昵称/头像用于显示）。 */
export interface NanfengHelloMessage {
  t: 'hello'
  v: number
  nickname: string
  avatar?: string
}

/** 客机 → 房主：一个动作。房主侧用 `NanfengMatch.act` 校验，非法就丢弃并回一条 `reject`。 */
export interface NanfengActionMessage {
  t: 'action'
  v: number
  reqId: number
  action: PlayerAction
}

/** 客机 → 房主：请求开下一局（房主决定，其它人收到快照自然会看到新的一局）。 */
export interface NanfengNextRoundMessage {
  t: 'next_round'
  v: number
  reqId: number
}

/** 客机 → 房主：主动离开。 */
export interface NanfengLeaveMessage {
  t: 'leave'
  v: number
}

export type NanfengGuestMessage =
  | NanfengHelloMessage
  | NanfengActionMessage
  | NanfengNextRoundMessage
  | NanfengLeaveMessage

export type NanfengMessage = NanfengHostMessage | NanfengGuestMessage

/** 编成一行 JSON：传输层（`vibeRoomTransport`）会按字节分片，这里不自己切。 */
export function encodeNanfengMessage(message: NanfengMessage): string {
  return JSON.stringify(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isVersion(value: unknown): value is number {
  return value === NANFENG_PROTOCOL_VERSION
}

function isRoundStart(value: Record<string, unknown>): value is Record<string, unknown> & NanfengRoundStartMessage {
  const dice = value.dice
  return value.t === 'round_start'
    && typeof value.seq === 'number'
    && typeof value.round === 'number'
    && typeof value.dealer === 'number'
    && typeof value.wallBreakIndex === 'number'
    && Array.isArray(dice) && dice.length === 2
    && dice.every((die) => typeof die === 'number')
}

function isSnapshotEnvelope(value: Record<string, unknown>): boolean {
  if (value.t !== 'snapshot' || typeof value.seq !== 'number') return false
  if (value.seat !== null && typeof value.seat !== 'number') return false
  const snapshot = value.snapshot
  if (!isRecord(snapshot)) return false
  // 只校验"够不够画一张桌子"，细节字段由南丰自己的类型保证（两边跑的是同一份代码）。
  return Array.isArray(snapshot.seatNames)
    && snapshot.seatNames.length === 4
    && Array.isArray(snapshot.scores)
    && isRecord(snapshot.own)
    && Array.isArray((snapshot.own as Record<string, unknown>).tiles)
    && Array.isArray(snapshot.discards)
    && isRecord(snapshot.ma)
}

/**
 * 解一条消息；不认识/版本不符/形状不对一律返回 `null`（丢弃，不抛错）。
 *
 * 网络里来的东西不可信：宁可这一帧不认，也不要让一个畸形包把整场拆掉。
 */
export function decodeNanfengMessage(raw: unknown): NanfengMessage | null {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!isRecord(value) || !isVersion(value.v)) return null

  if (isRoundStart(value)) return value
  if (value.t === 'snapshot') {
    if (!isSnapshotEnvelope(value)) return null
    return value as unknown as NanfengSeatSnapshotMessage
  }
  if (value.t === 'match_end') {
    const reason = value.reason
    if (reason !== 'closed' && reason !== 'left' && reason !== 'error') return null
    return {
      t: 'match_end',
      v: NANFENG_PROTOCOL_VERSION,
      seq: typeof value.seq === 'number' ? value.seq : 0,
      reason,
      message: typeof value.message === 'string' ? value.message : undefined,
    }
  }
  if (value.t === 'hello') {
    if (typeof value.nickname !== 'string') return null
    return {
      t: 'hello',
      v: NANFENG_PROTOCOL_VERSION,
      nickname: value.nickname,
      avatar: typeof value.avatar === 'string' ? value.avatar : undefined,
    }
  }
  if (value.t === 'action') {
    if (typeof value.reqId !== 'number' || !isRecord(value.action)) return null
    const action = value.action
    if (typeof action.type !== 'string' || typeof action.seat !== 'number') return null
    return {
      t: 'action',
      v: NANFENG_PROTOCOL_VERSION,
      reqId: value.reqId,
      action: action as unknown as PlayerAction,
    }
  }
  if (value.t === 'next_round') {
    if (typeof value.reqId !== 'number') return null
    return { t: 'next_round', v: NANFENG_PROTOCOL_VERSION, reqId: value.reqId }
  }
  if (value.t === 'leave') return { t: 'leave', v: NANFENG_PROTOCOL_VERSION }
  return null
}
