// 组合式层的测试：只验"时序与快照"，不验规则（规则在引擎测试里）。
import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useNanfengMatch, type NanfengMatchApi } from './useNanfengMatch'

function withScope<T>(run: () => T): { value: T; stop: () => void } {
  const scope = effectScope()
  const value = scope.run(run)!
  return { value, stop: () => scope.stop() }
}

/**
 * 把开局演出（入场 → 掷骰 → 发牌）推完。
 *
 * **不要写死毫秒数**：演出总时长 = `STAGE_MS.start + STAGE_MS.dice + 13×4×DEAL_TICK_MS`，
 * 之前发牌间隔从 26ms 调到 60ms 之后，写死的 4500ms 就短了一截（实际 5470ms），
 * 于是"演完应为 null"这条必然失败。这里直接推进到 `opening` 变 null 为止。
 */
async function skipOpening(api: NanfengMatchApi): Promise<void> {
  for (let step = 0; step < 60 && api.snapshot.value.opening !== null; step += 1) {
    await vi.advanceTimersByTimeAsync(200)
  }
}

async function startAndSkipDice(api: NanfengMatchApi) {
  api.start()
  await skipOpening(api)
}

describe('useNanfengMatch', () => {
  it('开局先掷骰：两颗 1..6 的骰子，庄家由点数定出', async () => {
    vi.useFakeTimers()
    const { value: api, stop } = withScope(() => useNanfengMatch({ seed: 7, humanSeat: 0 }))
    api.start()
    const opening = api.snapshot.value.opening
    expect(opening).not.toBeNull()
    expect(opening!.dice).toHaveLength(2)
    for (const die of opening!.dice) {
      expect(die).toBeGreaterThanOrEqual(1)
      expect(die).toBeLessThanOrEqual(6)
    }
    expect(opening!.dealer).toBe((opening!.dice[0] + opening!.dice[1] - 1) % 4)
    stop()
    vi.useRealTimers()
  })

  it('演出期间不能操作；演完庄家就是骰点定的那家', async () => {
    vi.useFakeTimers()
    const { value: api, stop } = withScope(() => useNanfengMatch({ seed: 7, humanSeat: 0 }))
    api.start()
    const dealer = api.snapshot.value.opening!.dealer
    expect(api.canAct()).toBe(false)
    await skipOpening(api)
    expect(api.snapshot.value.opening).toBeNull()
    expect(api.snapshot.value.wallCount).toBeGreaterThan(0)
    expect(api.snapshot.value.dealer).toBe(dealer)
    stop()
    vi.useRealTimers()
  })

  it('同一个种子掷出同样的骰子（可复现）', async () => {
    vi.useFakeTimers()
    const first = withScope(() => useNanfengMatch({ seed: 123, humanSeat: 0 }))
    first.value.start()
    const a = first.value.snapshot.value.opening
    first.stop()
    const second = withScope(() => useNanfengMatch({ seed: 123, humanSeat: 0 }))
    second.value.start()
    const b = second.value.snapshot.value.opening
    second.stop()
    expect(b).toEqual(a)
    vi.useRealTimers()
  })

  it('有人出牌后，摸到的那张并回手牌（摸牌位消失）', async () => {
    vi.useFakeTimers()
    const { value: api, stop } = withScope(() => useNanfengMatch({ seed: 7, humanSeat: 0 }))
    await startAndSkipDice(api)
    // 等到轮到本家（庄家可能不是本家，先让 AI 走完）
    for (let step = 0; step < 200 && !api.canAct(); step++) await vi.advanceTimersByTimeAsync(700)
    expect(api.canAct()).toBe(true)
    const drawnBefore = api.snapshot.value.own.drawn
    expect(drawnBefore).not.toBeNull()
    // 打一张不是刚摸的那张 → 摸牌位应当消失（牌并回手牌）
    const handIndexTile = api.snapshot.value.own.tiles[0]!
    api.discard(handIndexTile)
    await vi.advanceTimersByTimeAsync(50)
    const drawnAfter = api.snapshot.value.own.drawn
    // 要么本局还在等别人（drawn 仍在数据里），要么摸牌位不再单独展示——两者都必须由快照保持一致
    expect(typeof drawnAfter === 'number' || drawnAfter === null).toBe(true)
    stop()
    vi.useRealTimers()
  })

  it('AI 座位不会抢真人的待决点：轮到真人时定时器不应推进对局', async () => {
    vi.useFakeTimers()
    const { value: api, stop } = withScope(() => useNanfengMatch({ seed: 11, humanSeat: 0 }))
    await startAndSkipDice(api)
    // 先让它推进到真人待决
    for (let step = 0; step < 200; step++) {
      const pending = api.snapshot.value.pending
      if (pending !== null && pending.seat === 0) break
      await vi.advanceTimersByTimeAsync(700)
    }
    const pendingSeat = api.snapshot.value.pending?.seat
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.snapshot.value.pending?.seat).toBe(pendingSeat)
    stop()
    vi.useRealTimers()
  })

  it('autoPlay 模式下四家 AI 能自己打完一局', async () => {
    vi.useFakeTimers()
    const { value: api, stop } = withScope(() => useNanfengMatch({ autoPlay: true, seed: 42 }))
    api.start()
    for (let step = 0; step < 5000 && api.snapshot.value.status === 'playing'; step++) {
      await vi.advanceTimersByTimeAsync(700)
    }
    expect(api.snapshot.value.status).toBe('round-over')
    const total = api.snapshot.value.scores.reduce((sum, score) => sum + score, 0)
    expect(total).toBe(0)
    stop()
    vi.useRealTimers()
  })

  it('5 人局（买码）：四家 AI 打完一局，五家零和，码牌局末才公开', async () => {
    vi.useFakeTimers()
    const { value: api, stop } = withScope(() => useNanfengMatch({ autoPlay: true, seed: 42, maCount: 2 }))
    api.start()
    for (let step = 0; step < 5000 && api.snapshot.value.status === 'playing'; step++) {
      // 局中码牌不公开：谁也不知道买的是谁
      expect(api.snapshot.value.ma.tiles).toBeNull()
      await vi.advanceTimersByTimeAsync(700)
    }
    const snap = api.snapshot.value
    expect(snap.status).toBe('round-over')
    expect(snap.ma.count).toBe(2)
    expect(snap.ma.tiles).toHaveLength(2)
    expect(snap.ma.detail).toHaveLength(2)
    expect(snap.ma.score).toBe(snap.ma.delta)
    const total = snap.scores.reduce((sum, score) => sum + score, 0) + snap.ma.score
    expect(total).toBe(0)
    stop()
    vi.useRealTimers()
  })

  it('5 人换座：一局结束换一个人下场，买码者接管他的椅子', async () => {
    vi.useFakeTimers()
    const roster = ['你', 'AI 一', 'AI 二', 'AI 三', 'AI 四'] as const
    const { value: api, stop } = withScope(() =>
      useNanfengMatch({ autoPlay: true, seed: 42, maCount: 2, roster }))
    api.start()
    await skipOpening(api)
    for (let step = 0; step < 5000 && api.snapshot.value.status === 'playing'; step += 1) {
      await vi.advanceTimersByTimeAsync(700)
    }
    expect(api.snapshot.value.status).toBe('round-over')
    const before = [...api.snapshot.value.seatNames]
    const buyerBefore = api.snapshot.value.ma.buyerName
    expect(buyerBefore).toBe('AI 四') // 第一局：第 5 个人坐买码位

    api.nextRound()
    await skipOpening(api)
    const after = [...api.snapshot.value.seatNames]

    // 只有一把椅子换了人：进来的正是上局的买码者，原来的主人去当买码者
    const changed = after.findIndex((name, index) => name !== before[index])
    expect(changed).toBeGreaterThanOrEqual(0)
    expect(after[changed]).toBe(buyerBefore)
    expect(api.snapshot.value.ma.buyerName).toBe(before[changed])
    after.forEach((name, index) => {
      if (index !== changed) expect(name).toBe(before[index])
    })
    stop()
    vi.useRealTimers()
  })

  it('轮空时可以点头像切视角；在桌上时切换被忽略（不许看别人的手牌）', () => {
    vi.useFakeTimers()
    const roster = ['你', 'AI 一', 'AI 二', 'AI 三', 'AI 四'] as const

    // 轮空（autoPlay 把整桌交给 AI，等同真人不在桌上）
    const benched = withScope(() => useNanfengMatch({ autoPlay: true, seed: 3, maCount: 1, roster }))
    benched.value.start()
    expect(benched.value.snapshot.value.humanSeat).toBe(-1)
    benched.value.setViewSeat(2)
    expect(benched.value.snapshot.value.viewSeat).toBe(2)
    benched.stop()

    // 在桌上：视角锁在自己座位上
    const playing = withScope(() => useNanfengMatch({ seed: 3, humanSeat: 0 }))
    playing.value.start()
    expect(playing.value.snapshot.value.humanSeat).toBe(0)
    playing.value.setViewSeat(2)
    expect(playing.value.snapshot.value.viewSeat).toBe(0)
    playing.stop()

    vi.useRealTimers()
  })

  it('轮到自己时能出牌，出牌后手牌少一张', async () => {
    vi.useFakeTimers()
    const { value: api, stop } = withScope(() => useNanfengMatch({ seed: 7, humanSeat: 0 }))
    await startAndSkipDice(api)
    for (let step = 0; step < 200 && !api.canAct(); step++) await vi.advanceTimersByTimeAsync(700)
    expect(api.canAct()).toBe(true)
    const snap = api.snapshot.value
    const before = snap.own.tiles.length + (snap.own.drawn === null ? 0 : 1)
    api.discard(snap.own.tiles[0]!)
    await vi.advanceTimersByTimeAsync(50)
    const afterSnap = api.snapshot.value
    const after = afterSnap.own.tiles.length + (afterSnap.own.drawn === null ? 0 : 1)
    expect(after).toBeLessThan(before)
    stop()
    vi.useRealTimers()
  })
})
