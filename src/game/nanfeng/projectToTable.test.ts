// 投影层的契约测试：HUD/3D 约定 `players[0]` 是"屏幕下方那家"，其余座位下标全是**相对**的。
// 5 人换座之后 `viewSeat` 不再恒等于 0，所以这些转换必须逐个锁住 —— 漏一个就是"牌在别人那儿"。
import { describe, it, expect } from 'vitest'
import { projectToTable, projectionMeld } from './projectToTable'
import type { NanfengSnapshot } from './useNanfengMatch'

function snapshot(over: Partial<NanfengSnapshot> = {}): NanfengSnapshot {
  const emptySeat = { count: 13, melds: [] }
  return {
    round: 2,
    dealer: 3,
    wallCount: 40,
    phase: 'WAITING_PLAY',
    turn: 1,
    status: 'playing',
    scores: [10, -5, -3, -2],
    seats: [{ ...emptySeat }, { ...emptySeat }, { ...emptySeat }, { ...emptySeat }],
    own: { tiles: [12, 11], drawn: 13, melds: [] },
    discards: [[], [], [], []],
    lastDiscard: { seat: 1, tile: 21 },
    pending: null,
    outcome: null,
    settle: null,
    ma: { count: 0, tiles: null, detail: [], delta: 0, score: 0, buyerName: '', isHumanBuyer: false },
    seatNames: ['你', 'AI 一', 'AI 二', 'AI 三'],
    viewSeat: 2,
    opening: null,
    dealAnimation: { playerIndex: -1, count: 0, serial: 0 },
    dealtCount: null,
    tableActionEvent: null,
    dice: [1, 1],
    wallBreakIndex: 0,
    wallHeadDrawn: 53,
    events: [],
    lastError: null,
    humanSeat: -1,
    ...over,
  }
}

describe('projectToTable：一切座位下标都换成"本家视角"', () => {
  it('players[0] 是当前视角座位，其余按座位顺序排', () => {
    const view = projectToTable(snapshot({ viewSeat: 2 }))
    expect(view.players.map((player) => player.seat)).toEqual([2, 3, 0, 1])
    expect(view.user).toBe(view.players[0])
    expect(view.user.seat).toBe(2)
  })

  it('主力下标（currentPlayer / dealer / lastDiscard / 动作字）全部转了', () => {
    const view = projectToTable(snapshot({
      viewSeat: 2,
      turn: 1,
      dealer: 3,
      tableActionEvent: { id: 7, type: 'peng', actorIndex: 1, sourceIndex: 0, tile: 'm1', meldIndex: 0 },
      dealAnimation: { playerIndex: 0, count: 3, serial: 1 },
    }))
    expect(view.currentPlayer).toBe(3) // (1 - 2 + 4) % 4
    expect(view.dealer).toBe(1) // (3 - 2 + 4) % 4
    expect(view.lastDiscard?.from).toBe(3) // 座位 1 → 相对 3
    expect(view.tableActionEvent?.actorIndex).toBe(3)
    expect(view.tableActionEvent?.sourceIndex).toBe(2) // (0 - 2 + 4) % 4
    expect(view.dealAnimation.playerIndex).toBe(2) // (0 - 2 + 4) % 4
  })

  it('视角座位那份手牌走 DOM（有 hand、无 concealedTileCount），其余三家只给张数', () => {
    const view = projectToTable(snapshot({ viewSeat: 2 }))
    expect(view.user.hand).toEqual(['m1', 'm2', 'm3']) // 12/11 排序 + 摸到的 13 并进去
    expect(view.user.concealedTileCount).toBeUndefined()
    for (const opponent of view.players.slice(1)) {
      expect(opponent.hand).toEqual([])
      expect(opponent.concealedTileCount).toBe(13)
    }
  })

  it('轮空观战时不是"本家回合"：不许出牌、也不给胡按钮', () => {
    const view = projectToTable(snapshot({
      humanSeat: -1,
      viewSeat: 2,
      turn: 2,
      pending: {
        kind: 'turn',
        seat: 2,
        options: [],
        tile: null,
        from: null,
        view: {} as never,
      },
      phase: 'WAITING_PLAY',
    }))
    expect(view.isUserTurn).toBe(false)
    expect(view.userCanHu).toBe(false)
  })

  it('自己在桌上时视角必须锁在自己座位上（viewSeat === humanSeat）', () => {
    const turnPending = {
      kind: 'turn' as const,
      seat: 2,
      options: [],
      tile: null,
      from: null,
      view: {} as never,
    }
    const view = projectToTable(snapshot({
      humanSeat: 2,
      viewSeat: 2,
      turn: 2,
      pending: turnPending,
    }))
    expect(view.user.seat).toBe(2)
    expect(view.currentPlayer).toBe(0)
    expect(view.isUserTurn).toBe(true)
  })

  it('副露的 from 也转成相对座位（3D 用 (from - playerIndex + 4) % 4 判断来牌方向）', () => {
    const relative = (seat: number): number => (seat - 2 + 4) % 4
    expect(projectionMeld({ kind: 'PENG', tile: 11, fromSeat: 3 }, relative)).toMatchObject({
      type: 'peng',
      from: 1,
    })
    expect(projectionMeld({ kind: 'MING_GANG', tile: 11, fromSeat: 0 }, relative)).toMatchObject({
      type: 'gang',
      from: 2,
    })
    // 暗杠/补杠没有来源座位
    expect(projectionMeld({ kind: 'AN_GANG', tile: 11, fromSeat: null }, relative).from).toBeUndefined()
    expect(projectionMeld({ kind: 'BU_GANG', tile: 11, fromSeat: null }, relative).added).toBe(true)
  })
})
