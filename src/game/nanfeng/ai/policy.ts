// 南丰 AI 的决策策略（纯函数，无 IO、无随机、无搜索）。
//
// 强度定位：**合格对局**。会听牌、会假胡、会保留归一、会算杠；防守只到"残局别明显点炮"。
// 刻意没有：向听深搜、进张精确算、对手手牌推断、MCTS。想变强/变弱改这里的权重即可。
import type { ActionOption } from '../action/options'
import type { RuleConfig } from '../ruleConfig'
import { handCountsOf } from '../state/gameState'
import type { Meld } from '../melds'
import type { Tile } from '../tiles'
import {
  guiYiTiles,
  jiaHuDistance,
  meldTilesOf,
  sevenPairsShortfall,
  shapeValue,
  shiSanLanDistance,
  totalOf,
  waitsFor,
  withoutTile,
} from './handValue'
import { discardRisk } from './defense'
import { TILE_CODES } from './codes'
import type { AiView } from './view'

export type AiTurnDecision =
  | { kind: 'hu' }
  | { kind: 'an-gang'; tile: Tile }
  | { kind: 'bu-gang'; tile: Tile }
  | { kind: 'discard'; tile: Tile }

export type AiClaimDecision =
  | { kind: 'hu' }
  | { kind: 'ming-gang' }
  | { kind: 'peng' }
  | { kind: 'pass' }

/** 手牌里出现过的牌（去重、按牌码升序）。 */
export function handTiles(counts: Uint8Array): Tile[] {
  const tiles: Tile[] = []
  for (const tile of TILE_CODES) if (counts[tile] > 0) tiles.push(tile)
  return tiles
}

/** 打出某张后是否听牌（用引擎判胡核对，不自己实现）。 */
function isReadyAfterDiscard(counts: Uint8Array, melds: readonly Meld[], cfg: RuleConfig, visible: Uint8Array) {
  for (const tile of handTiles(counts)) {
    if (waitsFor(withoutTile(counts, tile), melds, cfg, visible).tiles.length > 0) return true
  }
  return false
}

function optionOf(options: readonly ActionOption[], type: ActionOption['type']): ActionOption | undefined {
  return options.find((option) => option.type === type)
}

/**
 * 弃牌打分：分越高越该打。
 *
 * 权重顺序（有意如此）：
 *   听牌 ≫ 归一保留 > 假胡进度 > 结构孤立 > 防守
 * 也就是"先保证不拆已经成型的牌，再看牌效，最后才看危险"。
 */
export function scoreDiscard(view: AiView, tile: Tile, cfg: RuleConfig): number {
  const counts = handCountsOf(view.hand)
  const melds = view.melds
  const after = withoutTile(counts, tile)

  let score = 0

  // 1) 打出即听 → 压倒性优先；听口剩余张数越多越好。
  const waits = waitsFor(after, melds, cfg, view.visible)
  if (waits.tiles.length > 0) {
    score += 1_000_000 + waits.remaining * 100 + waits.tiles.length * 10
  }

  // 2) 归一：拆掉一个"已经四张"会直接丢 3~9 炮，重罚。
  const guiBefore = guiYiTiles(counts, melds)
  const guiAfter = guiYiTiles(after, melds)
  score -= (guiBefore - guiAfter) * 120

  // 3) 假胡进度：打掉异色牌（离一色更近）加分。
  const jiaBefore = jiaHuDistance(counts, melds)
  const jiaAfter = jiaHuDistance(after, melds)
  score += (jiaBefore - jiaAfter) * 80

  // 4) 形状：越孤立越该打（shapeValue 越低 → 减得越少 → 分越高）。
  score -= shapeValue(counts, tile) * 8

  // 5) 七对 / 十三烂：只在门清且张数对得上时参与，且权重很低（它们通常是"顺手的第二志愿"）。
  if (melds.length === 0) {
    const pairsBefore = sevenPairsShortfall(counts, melds)
    const pairsAfter = sevenPairsShortfall(after, melds)
    if (Number.isFinite(pairsBefore) && Number.isFinite(pairsAfter)) {
      score += (pairsBefore - pairsAfter) * 40
    }
    const lanBefore = shiSanLanDistance(counts, melds, totalOf(counts) + meldTilesOf(melds))
    const lanAfter = shiSanLanDistance(after, melds, totalOf(after) + meldTilesOf(melds))
    if (Number.isFinite(lanBefore) && Number.isFinite(lanAfter)) {
      score += (lanBefore - lanAfter) * 25
    }
  }

  // 6) 防守：前期很轻（0.4），残局加重（×1.5 在 risk 内部已做过一次）。
  const risk = discardRisk(view, tile)
  score -= risk * (view.wallCount <= 30 ? 40 : 12)

  return score
}

/** 选出要打的那张（分数最高；完全同分时取牌码小的，保证确定性）。 */
export function chooseDiscard(view: AiView, cfg: RuleConfig): Tile {
  const counts = handCountsOf(view.hand)
  let bestTile: Tile | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const tile of handTiles(counts)) {
    const score = scoreDiscard(view, tile, cfg)
    if (score > bestScore) {
      bestScore = score
      bestTile = tile
    }
  }
  return bestTile ?? handTiles(counts)[0] ?? 11
}

/**
 * 自己回合：胡 > 暗杠/补杠（有条件）> 弃牌。
 *
 * 杠的取舍（南丰杠分很高：直杠 2 / 补杠 3 / 暗杠 6，都是即时入账）：
 *   - **已经听牌就不杠**：杠会把牌型结构锁死，听口容易变差，赚的那点分不值；
 *   - **残局不补杠**：南丰补杠能被抢杠胡，而且被抢时本次杠分不计（Q-02），残局风险太大；
 *   - 暗杠不可被抢，所以只要没听牌就做。
 */
export function chooseTurn(view: AiView, options: readonly ActionOption[], cfg: RuleConfig): AiTurnDecision {
  if (optionOf(options, 'HU')) return { kind: 'hu' }

  const counts = handCountsOf(view.hand)
  const ready = isReadyAfterDiscard(counts, view.melds, cfg, view.visible)

  const anGang = optionOf(options, 'AN_GANG')
  if (anGang && anGang.tile !== null && !ready) return { kind: 'an-gang', tile: anGang.tile }

  const buGang = optionOf(options, 'BU_GANG')
  if (buGang && buGang.tile !== null && !ready && view.wallCount > 16) {
    return { kind: 'bu-gang', tile: buGang.tile }
  }

  return { kind: 'discard', tile: chooseDiscard(view, cfg) }
}

/**
 * 别人打出牌时的响应。
 *
 * - 能胡就胡（含假胡；十三烂 5/6 张的窗口里引擎根本不会给 HU 选项，所以不用在这里判断）；
 * - 能明杠且**没听牌**就杠（直杠由点杠者单付 2 分，还能摸一张）；
 * - 碰只在"碰完能听牌、而现在还没听"时做 —— 否则白拆一张手牌；
 * - 其余一律过。
 */
export function chooseClaim(
  view: AiView,
  options: readonly ActionOption[],
  cfg: RuleConfig,
): AiClaimDecision {
  if (optionOf(options, 'HU')) return { kind: 'hu' }

  const counts = handCountsOf(view.hand)
  const ready = isReadyAfterDiscard(counts, view.melds, cfg, view.visible)

  if (optionOf(options, 'MING_GANG') && !ready) return { kind: 'ming-gang' }

  if (optionOf(options, 'PENG') && !ready) {
    // 碰后手牌 = 去掉两张该牌、补一副露；碰完还要打一张，所以看"碰完能不能听"。
    const tile = optionOf(options, 'PENG')?.tile
    if (tile !== null && tile !== undefined) {
      const afterPeng = withMelded(counts, tile)
      if (isReadyAfterDiscard(afterPeng, [...view.melds, pengMeld(tile)], cfg, view.visible)) {
        return { kind: 'peng' }
      }
    }
  }

  return { kind: 'pass' }
}

/** 抢杠：能抢就抢（南丰抢杠胡由被抢者独付，见 Q-02）。 */
export function chooseRobKong(options: readonly ActionOption[]): 'hu' | 'pass' {
  return optionOf(options, 'HU') ? 'hu' : 'pass'
}

function withMelded(counts: Uint8Array, tile: Tile): Uint8Array {
  const next = counts.slice()
  next[tile] = Math.max(0, next[tile] - 2)
  return next
}

function pengMeld(tile: Tile): Meld {
  // fromSeat 只是"谁打的那张"，AI 评估听口时用不到来源，填 null 即可。
  return { kind: 'PENG', tile, fromSeat: null }
}
