// 放炮风险估计：只用公开信息（对手牌河 / 副露 / 可见张数 / 剩余牌墙）。
//
// 南丰有两条与防守有关的事实：
//   1. **有点炮**（广麻没有），所以弃牌要看过别人；
//   2. **没有"现物安全"**（R-06：漏碰/漏胡都没有限制）—— 对手打过的牌，他**照样能胡**。
//      所以这里不把"现物"当安全牌，只按"这门牌他还剩多少可能"来估。
//
// 一期刻意做得**粗**：只在残局微微收紧，不做听牌推断、不做危险牌精确率。
// 目的是"不无脑点炮"，不是"滴水不漏"。
import { isNumberTile, type Tile } from '../tiles'
import type { AiView } from './view'

function suitBase(tile: Tile): number {
  return isNumberTile(tile) ? Math.floor(tile / 10) * 10 : 0
}

/**
 * 打出 `tile` 的风险分（0 起，越高越危险）。
 *
 * 信号：
 *   - 对手副露越多，他越可能已经成牌/在做大牌；
 *   - 某门牌对手**几乎不打**，说明他可能在留这门（南丰的假胡/一色就是"留一门"）；
 *   - 该牌可见张数越少，别人手里越可能有；
 *   - 残局权重上调。
 */
export function discardRisk(view: AiView, tile: Tile): number {
  const base = suitBase(tile)
  let risk = 0

  for (const opponent of view.opponents) {
    const meldCount = opponent.melds.length
    const suitedDiscards = opponent.discards.filter(isNumberTile)

    if (base === 0) {
      // 字牌：主要怕对子/刻子/字一色，副露多时更危险。
      risk += meldCount * 0.5
    } else {
      const sameSuitThrown = suitedDiscards.filter((d) => suitBase(d) === base).length
      const otherSuitThrown = suitedDiscards.length - sameSuitThrown
      // 对手在这门上"一张都不打"，同时别的数牌打了不少 → 明显在留这门。
      if (sameSuitThrown === 0 && otherSuitThrown >= 6) risk += 3
      else if (sameSuitThrown === 0) risk += 1
      risk += meldCount * 0.5
    }
  }

  // 可见张数多 → 别人手里少 → 相对安全（不按"现物"，只按剩余可能）。
  risk -= Math.max(0, view.visible[tile] - 1) * 0.5

  if (view.wallCount <= 30) risk *= 1.5
  if (view.wallCount <= 12) risk *= 1.5
  return Math.max(0, risk)
}
