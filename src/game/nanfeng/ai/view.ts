// 南丰 AI 的只读视野：从引擎状态里**只取公开信息 + 自己的手牌**。
//
// 这是 AI 与引擎之间唯一的耦合面：AI 拿不到别人的暗手，也拿不到牌墙的未来顺序。
// 想让 AI 变强（或变弱）只能改这里的字段与 policy，不能往这里塞暗信息。
import type { HandState } from '../action/hand'
import { handCountsOf } from '../state/gameState'
import type { Meld } from '../melds'
import { meldTileCount } from '../melds'
import { COUNT_SIZE } from '../tiles'
import type { GameState } from '../state/gameState'
import type { Tile } from '../tiles'

export interface AiOpponent {
  seat: number
  discards: readonly Tile[]
  melds: readonly Meld[]
}

export interface AiView {
  seat: number
  hand: HandState
  /** 自己已亮出的副露（等同 `hand.melds`，留一份便于读）。 */
  melds: readonly Meld[]
  /** 其他三家（顺序为座位升序，不含自己）。 */
  opponents: readonly AiOpponent[]
  /** 自己手牌 + 全场弃牌 + 全场副露的并集（用于算"还剩几张"）。 */
  visible: Uint8Array
  /** 牌墙剩余张数（含还没摸的）。 */
  wallCount: number
  dealer: number
  scores: readonly number[]
  round: number
}

/** 34 种牌码（万 11..19 / 条 21..29 / 筒 31..39 / 风 41..44 / 箭 51..53）。 */
export { TILE_CODES } from './codes'

export function emptyCounts(): Uint8Array {
  return new Uint8Array(COUNT_SIZE)
}

/** 把一副副露折算进计数（明杠/暗杠/补杠都是 4 张，碰是 3 张）。 */
export function addMeldToCounts(counts: Uint8Array, meld: Meld): void {
  counts[meld.tile] += meldTileCount(meld)
}

/** 本局可见的牌：自己手牌（含刚摸的）+ 全部弃牌 + 全部副露。 */
export function buildVisible(state: GameState, seat: number): Uint8Array {
  const visible = emptyCounts()
  const own = handCountsOf(state.hands[seat])
  for (let tile = 0; tile < visible.length; tile++) visible[tile] += own[tile]
  for (const hand of state.hands) {
    for (const meld of hand.melds) addMeldToCounts(visible, meld)
  }
  for (const pile of state.discards) {
    for (const tile of pile) visible[tile] += 1
  }
  return visible
}

export function buildAiView(state: GameState, seat: number): AiView {
  const opponents: AiOpponent[] = []
  for (let index = 0; index < state.hands.length; index++) {
    if (index === seat) continue
    opponents.push({
      seat: index,
      discards: state.discards[index] ?? [],
      melds: state.hands[index]?.melds ?? [],
    })
  }
  const hand = state.hands[seat]!
  return {
    seat,
    hand,
    melds: hand.melds,
    opponents,
    visible: buildVisible(state, seat),
    wallCount: Math.max(0, state.wall.length - state.wallPos),
    dealer: state.dealer,
    scores: state.scores,
    round: state.round,
  }
}

/** 某张牌还剩几张（4 − 可见张数，负数按 0）。虚拟的"牌墙剩余"不参与，只按可见面算。 */
export function remainingOf(view: AiView, tile: Tile): number {
  return Math.max(0, 4 - view.visible[tile])
}
