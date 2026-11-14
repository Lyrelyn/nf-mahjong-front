// 手牌价值：南丰 AI 的"看牌"层，全是纯函数。
//
// 这里**不做搜索**（没有 MCTS、没有对手手牌推断）——一期目标是"合格对局"，不是"打得很强"。
// 三件南丰特有的事必须在这里表达出来，否则 AI 会明显犯傻：
//   1. 假胡：凑一色/字一色即可胡（不需要结构）→ 用"异色张数"度量离假胡还有多远；
//   2. 归一：同一张牌四张全归你有分（3/5/9 炮）→ 第四张不能随便拆；
//   3. 十三烂：门清 + 字牌 ≥5 + 同花色点数不重复 + 相邻差 ≥3 → 用"违规数"做粗略距离。
import { judgeHu } from '../hu/huJudge'
import { meldTileCount, type Meld } from '../melds'
import type { RuleConfig } from '../ruleConfig'
import { isDragon, isNumberTile, isWind, type Tile } from '../tiles'
import { TILE_CODES } from './codes'

/** 一次听牌：听哪些牌、合计还剩几张（按可见面算）。 */
export interface WaitInfo {
  tiles: Tile[]
  remaining: number
}

const EMPTY_WAITS: WaitInfo = { tiles: [], remaining: 0 }

export function totalOf(counts: Uint8Array): number {
  let total = 0
  for (let tile = 0; tile < counts.length; tile++) total += counts[tile]
  return total
}

export function meldTilesOf(melds: readonly Meld[]): number {
  let total = 0
  for (const meld of melds) total += meldTileCount(meld)
  return total
}

export function withTile(counts: Uint8Array, tile: Tile): Uint8Array {
  const next = counts.slice()
  next[tile] += 1
  return next
}

export function withoutTile(counts: Uint8Array, tile: Tile): Uint8Array {
  const next = counts.slice()
  next[tile] = Math.max(0, next[tile] - 1)
  return next
}

/**
 * 这手牌（暗牌 counts + 副露 melds）打出之后的听口。
 *
 * 判定完全交给引擎的 `judgeHu` —— AI 不自己实现胡牌，避免两套规则漂移。
 * 只对局面上真正存在听牌形态的张数做扫描（`counts + t + 副露 === 14`），否则直接空。
 *
 * 带缓存：一次弃牌评估会对十几张候选各查一遍 34 张，而同一手牌在一次决策里会被反复查
 * （`isReadyAfterDiscard` + `scoreDiscard`）。缓存键包含牌型与影响判胡的规则开关，键不同就不会串。
 */
const waitsCache = new Map<string, Tile[]>()
const WAITS_CACHE_LIMIT = 20_000

function rulesKey(cfg: RuleConfig): string {
  const hu = cfg.hu
  return `${hu.jiaHu.enabled ? 1 : 0}${hu.qiDui.enabled ? 1 : 0}${hu.shiSanLan.enabled ? 1 : 0}${hu.wordStraight.enabled ? 1 : 0}`
}

function waitsTiles(counts: Uint8Array, melds: readonly Meld[], cfg: RuleConfig): Tile[] {
  const meldKey = melds.map((meld) => `${meld.kind}:${meld.tile}`).join(',')
  let key = `${rulesKey(cfg)}|${meldKey}|`
  for (let tile = 11; tile < counts.length; tile++) {
    if (counts[tile] !== 0) key += `${tile}x${counts[tile]};`
  }
  const cached = waitsCache.get(key)
  if (cached !== undefined) return cached
  const tiles: Tile[] = []
  for (const tile of TILE_CODES) {
    if (judgeHu(withTile(counts, tile), melds, cfg).tags.size > 0) tiles.push(tile)
  }
  if (waitsCache.size >= WAITS_CACHE_LIMIT) waitsCache.clear()
  waitsCache.set(key, tiles)
  return tiles
}

export function waitsFor(counts: Uint8Array, melds: readonly Meld[], cfg: RuleConfig, visible: Uint8Array): WaitInfo {
  const total = totalOf(counts) + meldTilesOf(melds)
  if (total !== 13) return EMPTY_WAITS
  const tiles = waitsTiles(counts, melds, cfg)
  if (tiles.length === 0) return EMPTY_WAITS
  let remaining = 0
  for (const tile of tiles) remaining += Math.max(0, 4 - visible[tile])
  return { tiles, remaining }
}

/** 距离"假胡"还差几张异色牌（含副露）。数值越小越接近一色/字一色。 */
export function jiaHuDistance(counts: Uint8Array, melds: readonly Meld[]): number {
  const suits = [10, 20, 30] as const
  let best = Number.POSITIVE_INFINITY
  for (const base of suits) {
    let off = 0
    for (let tile = 0; tile < counts.length; tile++) {
      if (tile < base + 1 || tile > base + 9) off += counts[tile]
    }
    for (const meld of melds) {
      if (meld.tile < base + 1 || meld.tile > base + 9) off += meldTileCount(meld)
    }
    best = Math.min(best, off)
  }
  // 字一色路线
  let wordOff = 0
  for (let tile = 0; tile < counts.length; tile++) {
    if (counts[tile] > 0 && !isWind(tile) && !isDragon(tile)) wordOff += counts[tile]
  }
  for (const meld of melds) {
    if (isNumberTile(meld.tile)) wordOff += meldTileCount(meld)
  }
  return Math.min(best, wordOff)
}

/** 归一计数：某种牌在自己手里的总张数恰好是 4（暗牌 + 副露折算）。 */
export function guiYiTiles(counts: Uint8Array, melds: readonly Meld[]): number {
  const totals = new Uint8Array(counts.length)
  for (let tile = 0; tile < counts.length; tile++) totals[tile] += counts[tile]
  for (const meld of melds) totals[meld.tile] += meldTileCount(meld)
  let n = 0
  for (const tile of TILE_CODES) if (totals[tile] === 4) n += 1
  return n
}

/** 七对进度（必须门清）：还差几对。 */
export function sevenPairsShortfall(counts: Uint8Array, melds: readonly Meld[]): number {
  if (melds.length > 0) return Number.POSITIVE_INFINITY
  let pairs = 0
  for (const tile of TILE_CODES) if (counts[tile] >= 2) pairs += 1
  return Math.max(0, 6 - pairs)
}

/**
 * 十三烂进度（门清）：粗略的"还要换几张牌"。
 *
 * 违规项按 R-05 的口径数：数牌同花色重复、同花色相邻差 < 3、字牌不足 5 张。
 * 只用来给弃牌排序，不做合法性判定（那由引擎 `isShiSanLan` 负责）。
 */
export function shiSanLanDistance(counts: Uint8Array, melds: readonly Meld[], total: number): number {
  if (melds.length > 0 || total !== 14) return Number.POSITIVE_INFINITY
  let violations = 0
  for (const base of [10, 20, 30]) {
    let prev = 0
    for (let rank = 1; rank <= 9; rank++) {
      const n = counts[base + rank]
      if (n === 0) continue
      if (n > 1) violations += n - 1
      if (prev !== 0 && rank - prev < 3) violations += 1
      prev = rank
    }
  }
  let words = 0
  for (const tile of [41, 42, 43, 44, 51, 52, 53]) {
    words += counts[tile]
    if (counts[tile] > 1) violations += counts[tile] - 1
  }
  violations += Math.max(0, 5 - words)
  return violations
}

/**
 * 单张牌的"结构价值"：同牌多、有相邻靠张、数牌优于孤张字牌。
 * 弃牌时选这个值**最低**的（最孤立的那张）。
 */
export function shapeValue(counts: Uint8Array, tile: Tile): number {
  const same = counts[tile] - 1
  let neighbors = 0
  if (isNumberTile(tile)) {
    const rank = tile % 10
    if (rank > 1) neighbors += counts[tile - 1]
    if (rank < 9) neighbors += counts[tile + 1]
    if (rank > 2) neighbors += counts[tile - 2] * 0.5
    if (rank < 8) neighbors += counts[tile + 2] * 0.5
  }
  const honorPenalty = !isNumberTile(tile) && same === 0 ? -3 : 0
  return same * 4 + neighbors * 2 + honorPenalty
}
