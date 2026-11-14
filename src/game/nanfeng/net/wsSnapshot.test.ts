// `wsSnapshotToNanfeng` 的契约测试：钉住三条实测约束 ——
// 观战者没有任何手牌、换座后 humanSeat 要重算、码牌局中不公开。
import { describe, expect, it } from 'vitest'
import { wsSnapshotToNanfeng, type WsSnapshotPayload } from './wsSnapshot'

/** 一份"对局中、我的回合"的后端快照（形状照抄 §10.5）。 */
function payloadOf(overrides: Partial<WsSnapshotPayload> = {}): WsSnapshotPayload {
  return {
    seq: 42,
    roomId: 'ABC123',
    matchLength: 4,
    matchFinished: false,
    maCount: 2,
    seating: { table: [0, 1, 2, 3], sittingOut: 4 },
    slots: [
      { slot: 0, nickname: '甲', avatar: '', ready: true, connected: true },
      { slot: 1, nickname: '乙', avatar: '', ready: true, connected: true },
      { slot: 2, nickname: '丙', avatar: '', ready: true, connected: true },
      { slot: 3, nickname: '丁', avatar: '', ready: true, connected: true },
      { slot: 4, nickname: '戊', avatar: '', ready: true, connected: true },
    ],
    totalScores: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
    round: 2,
    phase: 'WAITING_PLAY',
    dealer: 1,
    turn: 0,
    wallLeft: 83 - 2 - 13,
    scores: [0, 0, 0, 0],
    roundGangScore: [0, 0, 0, 0],
    discards: [[], [], [], []],
    melds: [[], [], [], []],
    handSizes: [14, 13, 13, 13],
    lastDiscard: null,
    claim: null,
    maScore: 0,
    lastSettle: null,
    viewer: { kind: 'player', seat: 0 },
    hand: { concealed: [11, 12, 13], drawnTile: 19, melds: [] },
    options: [{ type: 'HU', tile: null }],
    ...overrides,
  }
}

describe('wsSnapshotToNanfeng', () => {
  it('在桌上：手牌/座位张数/自己的可选项都对，状态是 playing', () => {
    const snap = wsSnapshotToNanfeng(payloadOf())
    expect(snap.humanSeat).toBe(0)
    expect(snap.viewSeat).toBe(0)
    expect(snap.status).toBe('playing')
    expect(snap.own.tiles).toEqual([11, 12, 13])
    expect(snap.own.drawn).toBe(19)
    expect(snap.seats.map((seat) => seat.count)).toEqual([14, 13, 13, 13])
    expect(snap.seatNames).toEqual(['甲', '乙', '丙', '丁'])
    expect(snap.pending?.kind).toBe('turn')
    expect(snap.pending?.seat).toBe(0)
    // 码牌局中不公开
    expect(snap.ma.count).toBe(2)
    expect(snap.ma.tiles).toBeNull()
    expect(snap.ma.buyerName).toBe('戊')
    // 牌墙：136 - 2 张码牌 - 剩余
    expect(snap.wallHeadDrawn).toBe(136 - 2 - snap.wallCount)
  })

  it('轮空买码：观战者一手暗牌都没有，humanSeat = -1，视角可被外部指定', () => {
    const snap = wsSnapshotToNanfeng(
      payloadOf({ viewer: { kind: 'spectator', seat: null }, hand: null, options: [] }),
      { viewSeat: 2 },
    )
    expect(snap.humanSeat).toBe(-1)
    expect(snap.viewSeat).toBe(2)
    expect(snap.own.tiles).toEqual([])
    expect(snap.own.drawn).toBeNull()
    expect(snap.pending).toBeNull()
    // 公开信息照常给
    expect(snap.seats.map((seat) => seat.count)).toEqual([14, 13, 13, 13])
    expect(snap.ma.buyerName).toBe('戊')
  })

  it('换座后 humanSeat 跟着 viewer.seat 变（不能缓存）', () => {
    const first = wsSnapshotToNanfeng(payloadOf())
    const rotated = wsSnapshotToNanfeng(payloadOf({
      seating: { table: [4, 1, 2, 3], sittingOut: 0 },
      viewer: { kind: 'player', seat: 0 },
      slots: [
        { slot: 0, nickname: '甲', avatar: '', ready: true, connected: false },
        { slot: 1, nickname: '乙', avatar: '', ready: true, connected: true },
        { slot: 2, nickname: '丙', avatar: '', ready: true, connected: true },
        { slot: 3, nickname: '丁', avatar: '', ready: true, connected: true },
        { slot: 4, nickname: '戊', avatar: '', ready: true, connected: true },
      ],
    }))
    expect(first.seatNames[0]).toBe('甲')
    // 上一局的买码者「戊」接管 0 号椅子
    expect(rotated.seatNames[0]).toBe('戊')
    expect(rotated.ma.buyerName).toBe('甲')
    expect(rotated.humanSeat).toBe(0)
  })

  it('结算后：状态变 round-over，码牌翻面，结算面板数据透传', () => {
    const snap = wsSnapshotToNanfeng(payloadOf({
      lastSettle: {
        deltas: [3, -1, -1, -1],
        detail: [],
        maDelta: 3,
        maDetail: [{ tile: 21, seat: 0, delta: 3 }],
      },
      maScore: 3,
    }))
    expect(snap.status).toBe('round-over')
    expect(snap.settle?.deltas).toEqual([3, -1, -1, -1])
    expect(snap.ma.tiles).toEqual([21])
    expect(snap.ma.delta).toBe(3)
    expect(snap.ma.score).toBe(3)
  })
})
