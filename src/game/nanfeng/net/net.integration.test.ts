// 联机回环集成测试：房主 + 三个客机在**内存里**互相投递消息，不碰网络。
//
// 覆盖的是最容易出错的三件事：
//   1. 每个客机只收到自己那份快照（轮空买码的人一手牌都没有）；
//   2. 客机的动作只有"替自己那把椅子"时才被房主接受；
//   3. 房主的 AI **不碰**远端真人的椅子（否则客机还没点，牌就被房主打出去了）。
import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useNanfengHost } from './host'
import { useNanfengGuest } from './guest'
import { NANFENG_PROTOCOL_VERSION } from './protocol'

const PEERS = ['p2', 'p3', 'p5'] as const
const PERSON: Record<string, string> = { p2: '乙', p3: '丙', p5: '戊' }
const SEATS = ['甲', '乙', '丙', '丁'] as const
const BUYER = '戊'

interface Harness {
  host: ReturnType<typeof useNanfengHost>
  guests: Map<string, ReturnType<typeof useNanfengGuest>>
  inbox: Record<string, string[]>
}

function setup(): Harness {
  const guests = new Map<string, ReturnType<typeof useNanfengGuest>>()
  const inbox: Record<string, string[]> = {}
  const host = useNanfengHost({
    seats: SEATS,
    buyerId: BUYER,
    maCount: 2,
    seed: 42,
    peers: () => PEERS,
    personOf: (peerId) => PERSON[peerId],
    sendTo: (peerId, message) => {
      inbox[peerId]?.push(JSON.stringify(message))
      guests.get(peerId)?.receive(message)
    },
  })
  for (const peerId of PEERS) {
    inbox[peerId] = []
    guests.set(peerId, useNanfengGuest({ send: (message) => host.receive(peerId, message) }))
  }
  return { host, guests, inbox }
}

const peerOfPerson = (person: string): string | undefined => PEERS.find((id) => PERSON[id] === person)

async function finishOpening(): Promise<void> {
  // 开场演出 1200 + 1150 + 13×4×60 ≈ 5.5s，兜底再来一点
  await vi.advanceTimersByTimeAsync(6500)
}

/**
 * 推进到"某个**有真人**的座位轮到他出牌"。
 *
 * - 房主自己：替他一秒出牌（测试里没人点）；
 * - 没有真人的椅子（本测试里的「丁」）：让 AI 自己走；
 * - 鸣牌窗口：房主自己 PASS，真人的座位让客机 PASS（否则会卡在窗口里）。
 *
 * 返回 `{ seat, peerId }`；本局结束（或推进超限）返回 `null`。
 */
async function advanceToHumanSeat(harness: Harness): Promise<{ seat: number; peerId: string } | null> {
  const { host, guests } = harness
  for (let step = 0; step < 600; step += 1) {
    const snap = host.api.snapshot.value
    if (snap.status === 'round-over') return null
    const pending = snap.pending
    if (pending === null) {
      await vi.advanceTimersByTimeAsync(700)
      continue
    }

    const person = snap.seatNames[pending.seat]!
    const peerId = peerOfPerson(person)

    if (pending.kind === 'claim') {
      if (pending.seat === snap.humanSeat) {
        host.api.submit('PASS')
      } else if (peerId !== undefined) {
        guests.get(peerId)!.api.submit('PASS')
      }
      await vi.advanceTimersByTimeAsync(30)
      continue
    }

    if (pending.seat === snap.humanSeat) {
      const tile = snap.own.tiles[0] ?? snap.own.drawn
      if (tile === null || tile === undefined) return null
      host.api.discard(tile)
      await vi.advanceTimersByTimeAsync(30)
      continue
    }

    if (peerId !== undefined) return { seat: pending.seat, peerId }

    // 这把椅子是 AI：交给时间
    await vi.advanceTimersByTimeAsync(700)
  }
  return null
}

describe('南丰联机（内存回环）', () => {
  it('开局后每个客机都收到脱敏快照；轮空买码的人没有任何暗牌', async () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const harness = scope.run(setup)!
    const { host, guests, inbox } = harness
    host.api.start()
    await finishOpening()

    const snap = host.api.snapshot.value
    expect(snap.seatNames).toEqual([...SEATS])
    expect(snap.ma.buyerName).toBe(BUYER)

    for (const peerId of PEERS) expect(inbox[peerId]!.length).toBeGreaterThan(0)

    for (const peerId of PEERS) {
      const guestSnap = guests.get(peerId)!.api.snapshot.value
      expect(guestSnap.seatNames).toEqual([...SEATS])
      expect(guestSnap.ma.buyerName).toBe(BUYER)
      // 买码：局中不公开
      expect(guestSnap.ma.tiles).toBeNull()

      const person = PERSON[peerId]!
      const seat = guestSnap.seatNames.indexOf(person)
      if (seat < 0) {
        // 本局轮空买码：观战，一手牌都不给
        expect(person).toBe(BUYER)
        expect(guestSnap.humanSeat).toBe(-1)
        expect(guestSnap.own).toEqual({ tiles: [], drawn: null, melds: [] })
      } else {
        expect(guestSnap.humanSeat).toBe(seat)
        const hand = guestSnap.own.tiles.length + (guestSnap.own.drawn === null ? 0 : 1)
        expect(hand).toBeGreaterThanOrEqual(13)
        expect(hand).toBeLessThanOrEqual(14)
      }
    }

    scope.stop()
    vi.useRealTimers()
  })

  it('远端真人的椅子不会被房主 AI 抢走，且他的出牌会被房主接受', async () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const harness = scope.run(setup)!
    const { host, guests } = harness
    host.api.start()
    await finishOpening()

    const target = await advanceToHumanSeat(harness)
    expect(target).not.toBeNull()
    const { seat, peerId } = target!

    // 轮到他时，房主这边等一会儿也不会替他出牌
    const beforeCount = host.api.snapshot.value.seats[seat]!.count
    await vi.advanceTimersByTimeAsync(1200)
    expect(host.api.snapshot.value.pending?.seat).toBe(seat)
    expect(host.api.snapshot.value.seats[seat]!.count).toBe(beforeCount)

    // 客机出牌 → 房主接受 → 广播新快照
    const guest = guests.get(peerId)!
    const guestSnap = guest.api.snapshot.value
    expect(guestSnap.humanSeat).toBe(seat)
    const tile = guestSnap.own.tiles[0] ?? guestSnap.own.drawn
    expect(tile).not.toBeNull()

    guest.api.discard(tile!)
    await vi.advanceTimersByTimeAsync(30)

    const after = host.api.snapshot.value
    expect(after.seats[seat]!.count).toBeLessThan(beforeCount)
    expect(guest.api.snapshot.value.seats[seat]!.count).toBe(after.seats[seat]!.count)

    scope.stop()
    vi.useRealTimers()
  })

  it('替别人出牌（座位对不上）会被房主直接丢掉', async () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const harness = scope.run(setup)!
    const { host, guests } = harness
    host.api.start()
    await finishOpening()

    const target = await advanceToHumanSeat(harness)
    expect(target).not.toBeNull()
    const { seat, peerId } = target!
    const guest = guests.get(peerId)!
    const snapBefore = host.api.snapshot.value
    const tile = guest.api.snapshot.value.own.tiles[0] ?? guest.api.snapshot.value.own.drawn
    expect(tile).toBeTypeOf('number')

    // 冒用另一个座位号（人是对的，椅子是错的）
    host.receive(peerId, {
      t: 'action',
      v: NANFENG_PROTOCOL_VERSION,
      reqId: 999,
      action: { type: 'DISCARD', seat: (seat + 1) % 4, tile: tile!, reqId: 999 },
    })
    await vi.advanceTimersByTimeAsync(30)

    const after = host.api.snapshot.value
    expect(after.pending?.seat).toBe(seat)
    expect(after.seats[seat]!.count).toBe(snapBefore.seats[seat]!.count)

    scope.stop()
    vi.useRealTimers()
  })
})
