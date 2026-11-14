// 运行时集成测试：让四个 AI 座位把整局打完。
//
// 这是**唯一**同时覆盖"引擎 + AI + 运行时"的用例：摸打、碰杠、胡、荒庄、结算零和
// 全部走真实代码路径。它比单测慢，所以只跑少数几个种子。
import { describe, expect, it } from 'vitest'
import { DEFAULT_RULE_CONFIG } from '../ruleConfig'
import { nextRoundSeating } from '../state/gameState'
import { aiActionFor } from './aiAction'
import { NanfengMatch, type MatchOptions } from './match'

const SEATS = ['p0', 'p1', 'p2', 'p3'] as const
const MAX_STEPS = 4000

/** 把一局打完（四家都交给 AI）。 */
function playRound(seed: number, dealer = 0, extra: Partial<MatchOptions> = {}) {
  const cfg = extra.cfg ?? DEFAULT_RULE_CONFIG
  const match = new NanfengMatch({ seats: SEATS, seed, dealer, ...extra })
  match.begin()
  let steps = 0
  while (match.status === 'playing') {
    if (++steps > MAX_STEPS) throw new Error(`超过 ${MAX_STEPS} 步仍未结束，疑似死循环`)
    const pending = match.pending
    if (pending === null) throw new Error('还在进行中却没有待决动作')
    match.act(aiActionFor(pending, cfg, steps))
  }
  return { match, steps }
}

describe('南丰单机运行时', () => {
  it('四个 AI 能打完一整局（含胡或荒庄）', () => {
    const { match } = playRound(20261006)
    expect(match.status).toBe('round-over')
    expect(match.outcome).not.toBeNull()
  })

  it('一局结算后四家分数零和', () => {
    const { match } = playRound(20261006)
    const total = match.state.scores.reduce((sum, score) => sum + score, 0)
    expect(total).toBe(0)
  })

  it('同一个种子完全复现（分数与步数都一致）', () => {
    const first = playRound(4242)
    const second = playRound(4242)
    expect(second.match.state.scores).toEqual(first.match.state.scores)
    expect(second.steps).toBe(first.steps)
  })

  it('不同种子会走出不同的对局（不是退化成一个固定剧本）', () => {
    const a = playRound(1)
    const b = playRound(2)
    const sameScores = JSON.stringify(a.match.state.scores) === JSON.stringify(b.match.state.scores)
    const sameSteps = a.steps === b.steps
    expect(sameScores && sameSteps).toBe(false)
  })

  it('能接着开下一局，且局号递增', () => {
    const { match } = playRound(7)
    match.nextRound()
    expect(match.round).toBe(2)
    expect(match.status).toBe('playing')
    expect(match.state.round).toBe(2)
  })

  it('5 人局（买码 2 张）：整局打完，五家零和', () => {
    const cfg = { ...DEFAULT_RULE_CONFIG, buyCode: { count: 2 as const } }
    const match = new NanfengMatch({ seats: SEATS, seed: 20261006, dealer: 0, cfg })
    match.begin()
    let steps = 0
    while (match.status === 'playing') {
      if (++steps > MAX_STEPS) throw new Error(`超过 ${MAX_STEPS} 步仍未结束，疑似死循环`)
      match.act(aiActionFor(match.pending!, cfg, steps))
    }
    expect(match.state.maTiles).toHaveLength(2)
    const total =
      match.state.scores.reduce((sum, score) => sum + score, 0) + match.state.maScore
    expect(total).toBe(0)
    expect(match.state.lastSettle?.maDelta).toBe(match.state.maScore)
  })

  it('4 人局不开轮换：下一局的座位表原样不动', () => {
    const { match } = playRound(7)
    const before = [...match.state.seats]
    match.nextRound()
    expect(match.buyerId).toBeNull()
    expect(match.state.seats).toEqual(before)
  })

  it('5 人换座：按 R-02 换一个人下场，上局的买码者接管那把椅子', () => {
    const { match } = playRound(20261006, 0, { buyerId: 'e' })
    const before = [...match.state.seats]
    const seating = nextRoundSeating(match.state, match.outcome!)
    const outgoing = before[seating.sittingOut]

    match.nextRound()

    // 只有"下场那把椅子"换了人：买码者进来，原来的人去当买码者
    expect(match.state.seats[seating.sittingOut]).toBe('e')
    expect(match.buyerId).toBe(outgoing)
    for (let seat = 0; seat < before.length; seat += 1) {
      if (seat !== seating.sittingOut) expect(match.state.seats[seat]).toBe(before[seat])
    }
    // 庄家仍按同一套 R-02 结论（座位位置没变，所以下标继续有效）
    expect(match.dealer).toBe(seating.dealer)
    expect(match.round).toBe(2)
  })

  it('5 人换座能连着换：三局之后仍是"4 人在桌 + 1 人买码"，没有重复的人', () => {
    const cfg = DEFAULT_RULE_CONFIG
    const match = new NanfengMatch({ seats: SEATS, seed: 7, dealer: 0, buyerId: 'e' })
    const playCurrentRound = (): void => {
      let steps = 0
      while (match.status === 'playing') {
        if (++steps > MAX_STEPS) throw new Error(`超过 ${MAX_STEPS} 步仍未结束，疑似死循环`)
        match.act(aiActionFor(match.pending!, cfg, steps))
      }
    }

    match.begin()
    playCurrentRound()
    for (let round = 0; round < 2; round += 1) {
      match.nextRound()
      // 桌上是 4 个不同的人，买码的那位不在桌上
      expect(new Set(match.state.seats).size).toBe(4)
      expect(match.state.seats).not.toContain(match.buyerId)
      playCurrentRound()
    }
    expect(new Set([...match.state.seats, match.buyerId!]).size).toBe(5)
  })

  it('提交不属于待决座位的动作会立即报错', () => {
    const match = new NanfengMatch({ seats: SEATS, seed: 1 })
    match.begin()
    const pending = match.pending!
    const wrongSeat = (pending.seat + 1) % SEATS.length
    expect(() => match.act({ type: 'PASS', seat: wrongSeat, tile: null, reqId: 1 })).toThrow()
  })

  it('提交待决座位没有的动作也会立即报错', () => {
    const match = new NanfengMatch({ seats: SEATS, seed: 1 })
    match.begin()
    const pending = match.pending!
    expect(() => match.act({ type: 'PENG', seat: pending.seat, tile: null, reqId: 1 })).toThrow()
  })
})
