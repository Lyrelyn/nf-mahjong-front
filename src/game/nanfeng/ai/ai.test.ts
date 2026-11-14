// 南丰 AI 的单元测试：只断言"选择对不对"，不断言内部打分数值。
//
// 每个用例都在检验一条**策略意图**（见 ai/policy.ts 文件头）：先听牌、保归一、走近一色、
// 打孤张、残局避炮、杠的取舍。改权重时这些用例应该仍然是绿的。
import { describe, expect, it } from 'vitest'
import { countsOf } from '../counts'
import { DEFAULT_RULE_CONFIG } from '../ruleConfig'
import type { Meld } from '../melds'
import type { Tile } from '../tiles'
import { chooseClaim, chooseDiscard, chooseTurn, scoreDiscard } from './policy'
import { guiYiTiles, jiaHuDistance, waitsFor, withoutTile } from './handValue'
import { discardRisk } from './defense'
import type { AiView } from './view'

const cfg = DEFAULT_RULE_CONFIG

function makeView(hand: readonly Tile[], over: Partial<AiView> = {}): AiView {
  const concealed = countsOf(hand)
  const visible = countsOf(hand)
  const view: AiView = {
    seat: 0,
    hand: { concealed, melds: [], drawnTile: null, justPeng: false },
    melds: [],
    opponents: [
      { seat: 1, discards: [], melds: [] },
      { seat: 2, discards: [], melds: [] },
      { seat: 3, discards: [], melds: [] },
    ],
    visible,
    wallCount: 40,
    dealer: 0,
    scores: [0, 0, 0, 0],
    round: 1,
  }
  return { ...view, ...over }
}

/** 让某个对手的弃牌显得"只打这两门"。 */
function opponentsThrowing(suits: readonly number[], count = 8): AiView['opponents'] {
  const discards: Tile[] = []
  for (let index = 0; index < count; index++) {
    discards.push((suits[index % suits.length]! + (index % 9) + 1) as Tile)
  }
  return [
    { seat: 1, discards, melds: [] },
    { seat: 2, discards: [], melds: [] },
    { seat: 3, discards: [], melds: [] },
  ]
}

describe('南丰 AI：手牌价值', () => {
  it('13 张听牌时算出听口与剩余张数', () => {
    // 11-12-13 / 21-22-23 / 31×3 / 41×3 / 51 单张 → 听 51
    const hand: Tile[] = [11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 41, 51]
    const view = makeView(hand)
    const waits = waitsFor(countsOf(hand), [], cfg, view.visible)
    expect(waits.tiles).toContain(51)
    expect(waits.remaining).toBeGreaterThan(0)
  })

  it('假胡距离：一色手为 0，混色手按异色张数计', () => {
    expect(jiaHuDistance(countsOf([11, 12, 13, 14, 15]), [])).toBe(0)
    expect(jiaHuDistance(countsOf([11, 12, 21, 22]), [])).toBe(2)
    expect(jiaHuDistance(countsOf([41, 42, 51]), [])).toBe(0) // 字一色
  })

  it('归一：暗持四张算一个，碰 + 手里一张也算', () => {
    expect(guiYiTiles(countsOf([11, 11, 11, 11]), [])).toBe(1)
    const peng: Meld = { kind: 'PENG', tile: 21, fromSeat: 1 }
    expect(guiYiTiles(countsOf([21]), [peng])).toBe(1)
  })
})

describe('南丰 AI：弃牌', () => {
  it('先打孤张字牌', () => {
    const hand: Tile[] = [11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 41, 51, 43]
    // 43（西风）是孤张字牌，51（中）是孤张但 43 更该先走？两者的区别在于……
    // 这里只断言"打的是一张孤张字牌"，不断言具体哪张（两个都合理）。
    const chosen = chooseDiscard(makeView(hand), cfg)
    expect([51, 43]).toContain(chosen)
  })

  it('宁拆别的组合也不拆归一', () => {
    // 12 有四张（归一），其余是成型顺子/刻子
    const hand: Tile[] = [12, 12, 12, 12, 13, 14, 15, 21, 22, 23, 31, 31, 31, 41]
    const chosen = chooseDiscard(makeView(hand), cfg)
    expect(chosen).not.toBe(12)
  })

  it('能听就听：打出的那张必须让手牌进入听牌态', () => {
    const hand: Tile[] = [11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 41, 51, 52]
    const view = makeView(hand)
    const chosen = chooseDiscard(view, cfg)
    const after = withoutTile(countsOf(hand), chosen)
    expect(waitsFor(after, [], cfg, view.visible).tiles.length).toBeGreaterThan(0)
  })

  it('走假胡路线时优先打异色牌', () => {
    // 13 张万子 + 1 张条子：那张条子是全手唯一的异色
    const hand: Tile[] = [11, 12, 13, 14, 15, 16, 17, 18, 19, 11, 11, 12, 12, 21]
    expect(chooseDiscard(makeView(hand), cfg)).toBe(21)
  })

  it('残局里"对手几乎不打的那门"更危险', () => {
    // 对手打了大量条/筒、一张万都没有 → 万张（19）比筒张（39）危险。
    // 这里直接断言风险函数，而不是断言最终选择——选择还受假胡/形状影响，断言会脆。
    const hand: Tile[] = [19, 39, 11, 11, 12, 12, 13, 13, 21, 21, 22, 22, 51, 51]
    const view = makeView(hand, { opponents: opponentsThrowing([20, 30]), wallCount: 10 })
    expect(discardRisk(view, 19)).toBeGreaterThan(discardRisk(view, 39))
  })

  it('打分函数对同一手牌是确定的（可复现）', () => {
    const hand: Tile[] = [11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37]
    const view = makeView(hand)
    const first = chooseDiscard(view, cfg)
    const second = chooseDiscard(view, cfg)
    expect(first).toBe(second)
    expect(Number.isFinite(scoreDiscard(view, first, cfg))).toBe(true)
  })
})

describe('南丰 AI：动作取舍', () => {
  const huOption = { type: 'HU' as const, priority: 40, distance: 0, tile: 11 as Tile, huPreview: null }
  const anGangOption = { type: 'AN_GANG' as const, priority: 0, distance: 0, tile: 11 as Tile, huPreview: null }
  const buGangOption = { type: 'BU_GANG' as const, priority: 0, distance: 0, tile: 11 as Tile, huPreview: null }

  it('能胡就胡', () => {
    const view = makeView([11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 41, 51, 51])
    expect(chooseTurn(view, [huOption], cfg)).toEqual({ kind: 'hu' })
  })

  it('没听牌时暗杠照做（暗杠不可被抢，6 分）', () => {
    const view = makeView([11, 11, 11, 11, 12, 13, 15, 17, 21, 23, 25, 41, 43, 51])
    expect(chooseTurn(view, [anGangOption], cfg)).toEqual({ kind: 'an-gang', tile: 11 })
  })

  it('已经听牌就不暗杠（杠会锁死牌型、坏听口）', () => {
    // 七对听牌态：11×4 算两对，配 12/13/21/22/31 → 打掉 51 就听 22。
    // 注意 11×4 同时满足 canAnGang，所以这个用例正好检验"听牌优先于杠"。
    const view = makeView([11, 11, 11, 11, 12, 12, 13, 13, 21, 21, 22, 31, 31, 51])
    expect(chooseTurn(view, [anGangOption], cfg).kind).toBe('discard')
  })

  it('残局不补杠（补杠能被抢杠胡，且被抢时杠分不计）', () => {
    const view = makeView([11, 11, 11, 12, 13, 15, 17, 21, 23, 25, 41, 43, 51, 52], { wallCount: 10 })
    expect(chooseTurn(view, [buGangOption], cfg).kind).toBe('discard')
  })

  it('抢杠窗口：有 HU 就抢', () => {
    expect(chooseClaim(makeView([11, 12, 13]), [huOption], cfg)).toEqual({ kind: 'hu' })
  })

  it('没有任何可行动作时过牌', () => {
    const pass = { type: 'PASS' as const, priority: 0, distance: 1, tile: null, huPreview: null }
    expect(chooseClaim(makeView([11, 12, 13]), [pass], cfg)).toEqual({ kind: 'pass' })
  })
})
