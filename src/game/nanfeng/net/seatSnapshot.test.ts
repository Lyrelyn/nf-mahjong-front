// 脱敏与协议：联机里最容易出事的就是"把别人的牌发出去"，这里逐条锁住。
import { describe, expect, it } from 'vitest'
import { seatSnapshot, type SeatSnapshotSource } from './seatSnapshot'
import {
  NANFENG_PROTOCOL_VERSION,
  decodeNanfengMessage,
  encodeNanfengMessage,
  type NanfengGuestMessage,
  type NanfengHostMessage,
} from './protocol'
import { startRound, type GameState } from '../state/gameState'
import { DEFAULT_RULE_CONFIG } from '../ruleConfig'
import { settleRound } from '../score/settle'
import { startBase } from '../testSupport/fixtures'

const source = (over: Partial<SeatSnapshotSource> & { state: GameState }): SeatSnapshotSource => ({
  status: 'playing',
  round: 1,
  dealer: over.state.dealer,
  buyerId: null,
  ...over,
})

const maCfg = { ...DEFAULT_RULE_CONFIG, buyCode: { count: 2 as const } }

describe('按座位脱敏：别人的暗牌一张都不出去', () => {
  it('每个座位只拿到自己的手牌，其余只给张数', () => {
    const state = startRound(startBase())
    const seat0 = seatSnapshot(source({ state }), { seat: 0 })
    const seat1 = seatSnapshot(source({ state }), { seat: 1 })

    // 座位 0 是庄家：13 张暗牌 + 摸到的那张
    expect(seat0.own.tiles).toHaveLength(13)
    expect(seat0.own.drawn).not.toBeNull()
    // 座位 1 只是普通手牌
    expect(seat1.own.tiles).toHaveLength(13)
    expect(seat1.own.drawn).toBeNull()
    // 两家的手牌不是同一副
    expect(seat1.own.tiles).not.toEqual(seat0.own.tiles)
    // 张数是公开信息
    expect(seat0.seats[0]?.count).toBe(14)
    expect(seat0.seats[1]?.count).toBe(13)
    // 视角与"谁在做决定"跟着目标座位走
    expect(seat0.viewSeat).toBe(0)
    expect(seat0.humanSeat).toBe(0)
    expect(seat1.viewSeat).toBe(1)
    expect(seat1.humanSeat).toBe(1)
  })

  it('轮空买码的观战者：一手牌都不给，也没有待决动作', () => {
    const state = startRound(startBase())
    const pending = {
      kind: 'turn' as const,
      seat: 0,
      options: [],
      tile: null,
      from: null,
      view: {} as never,
    }
    const spectator = seatSnapshot(source({ state, buyerId: 'AI 四' }), {
      seat: null,
      spectatorSeat: 2,
      pending,
    })
    expect(spectator.own).toEqual({ tiles: [], drawn: null, melds: [] })
    expect(spectator.humanSeat).toBe(-1)
    expect(spectator.viewSeat).toBe(2) // 只能借一把椅子当镜头
    expect(spectator.pending).toBeNull()
    expect(spectator.ma.isHumanBuyer).toBe(true)
    expect(spectator.ma.buyerName).toBe('AI 四')
  })

  it('待决动作只发给轮到的那个人，并且剥掉 AI 视野', () => {
    const state = startRound(startBase())
    const pending = {
      kind: 'claim' as const,
      seat: 0,
      options: [],
      tile: 21 as const,
      from: 1,
      view: { secret: '别人的手牌估计' } as never,
    }
    const mine = seatSnapshot(source({ state }), { seat: 0, pending })
    const other = seatSnapshot(source({ state }), { seat: 1, pending })
    expect(mine.pending?.seat).toBe(0)
    // view 里是房主 AI 的推断（含别人的牌），不能下发
    expect(mine.pending?.view).toEqual({})
    expect(other.pending).toBeNull()
  })
})

describe('买码：局中不公开，结算后才翻开', () => {
  it('局中 ma.tiles 恒为 null（即使房主手里已经留出了码牌）', () => {
    const state = startRound(startBase({ cfg: maCfg }))
    expect(state.maTiles).toHaveLength(2)
    const snapshot = seatSnapshot(source({ state, buyerId: 'AI 四' }), { seat: 0 })
    expect(snapshot.ma.count).toBe(2)
    expect(snapshot.ma.tiles).toBeNull()
    expect(snapshot.ma.detail).toEqual([])
    expect(snapshot.ma.delta).toBe(0)
    expect(snapshot.settle).toBeNull()
  })

  it('结算之后：码牌、每张的指向与收付、四家 deltas 一起下发', () => {
    const base = startRound(startBase({ cfg: maCfg }))
    const settled = settleRound(
      base,
      { kind: 'HU', winners: [{ seat: base.dealer, zimo: true, tags: ['PING_HU'] }], loserSeat: null },
      base.cfg,
    )
    const after: GameState = {
      ...base,
      scores: base.scores.map((value, seat) => value + settled.deltas[seat]),
      maScore: base.maScore + settled.maDelta,
      lastSettle: settled,
      lastOutcome: { kind: 'HU', winners: [{ seat: base.dealer, zimo: true, tags: ['PING_HU'] }], loserSeat: null },
    }
    const snapshot = seatSnapshot(
      source({ state: after, status: 'round-over', buyerId: 'AI 四' }),
      { seat: 0 },
    )
    expect(snapshot.settle?.deltas).toEqual(settled.deltas)
    expect(snapshot.ma.tiles).toHaveLength(2)
    expect(snapshot.ma.detail).toHaveLength(2)
    expect(snapshot.ma.delta).toBe(settled.maDelta)
    expect(snapshot.outcome?.kind).toBe('HU')
    // 五家零和仍然成立（客机也用这条做自检）
    const total = (snapshot.settle?.deltas ?? []).reduce((sum, delta) => sum + delta, 0)
      + (snapshot.ma.delta ?? 0)
    expect(total).toBe(0)
  })
})

describe('快照里不夹带事件流与房主演出', () => {
  it('events 恒为空、没有发牌演出字段、牌墙按"码牌不算摸走"换算', () => {
    const state = startRound(startBase({ cfg: maCfg }))
    const snapshot = seatSnapshot(source({ state }), { seat: 1 })
    expect(snapshot.events).toEqual([])
    expect(snapshot.opening).toBeNull()
    expect(snapshot.dealtCount).toBeNull()
    expect(snapshot.dealAnimation.playerIndex).toBe(-1)
    // 136 - 预留 2 张码牌 - 剩余 81 张 = 已经发出去 53 张
    expect(state.wall.length).toBe(81)
    expect(snapshot.wallHeadDrawn).toBe(53)
  })
})

describe('协议编解码：畸形包一律丢弃，不炸房', () => {
  it('快照消息能原样往返', () => {
    const state = startRound(startBase())
    const snapshot = seatSnapshot(source({ state }), { seat: 2, dice: [3, 5], wallBreakIndex: 42 })
    const message: NanfengHostMessage = { t: 'snapshot', v: NANFENG_PROTOCOL_VERSION, seq: 7, seat: 2, snapshot }
    const decoded = decodeNanfengMessage(encodeNanfengMessage(message))
    expect(decoded).not.toBeNull()
    expect(decoded?.t).toBe('snapshot')
    if (decoded?.t !== 'snapshot') throw new Error('应该是快照消息')
    expect(decoded.seat).toBe(2)
    expect(decoded.seq).toBe(7)
    expect(decoded.snapshot.seatNames).toEqual(snapshot.seatNames)
    expect(decoded.snapshot.own.tiles).toEqual(snapshot.own.tiles)
  })

  it('客机动作消息能原样往返', () => {
    const message: NanfengGuestMessage = {
      t: 'action',
      v: NANFENG_PROTOCOL_VERSION,
      reqId: 12,
      action: { type: 'DISCARD', seat: 1, tile: 21, reqId: 12 },
    }
    const decoded = decodeNanfengMessage(encodeNanfengMessage(message))
    expect(decoded).toMatchObject({ t: 'action', reqId: 12 })
  })

  it('版本不符 / 坏 JSON / 类型未知 / 缺字段 → 返回 null', () => {
    expect(decodeNanfengMessage('{not json')).toBeNull()
    expect(decodeNanfengMessage(JSON.stringify({ t: 'snapshot', v: NANFENG_PROTOCOL_VERSION + 1 }))).toBeNull()
    expect(decodeNanfengMessage(JSON.stringify({ t: 'whatever', v: NANFENG_PROTOCOL_VERSION }))).toBeNull()
    expect(decodeNanfengMessage(JSON.stringify({ t: 'snapshot', v: NANFENG_PROTOCOL_VERSION, seq: 1, seat: 0 }))).toBeNull()
    expect(decodeNanfengMessage(JSON.stringify({ t: 'action', v: NANFENG_PROTOCOL_VERSION, reqId: 1 }))).toBeNull()
    expect(decodeNanfengMessage(null)).toBeNull()
    expect(decodeNanfengMessage(42)).toBeNull()
  })
})
