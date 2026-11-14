// 移植自 nf-mahjong/assets/scripts/core/hu/guiYi.ts（逻辑未改动）
/**
 * 归一系列判定（南丰"归一"= 某牌码凑齐 4 张）。
 *
 * R-07 确认的口径：该牌码的 **4 张只要全归你**就算 —— 暗牌、碰、明杠、暗杠、补杠一律计入，
 * 每副露按它占的张数折算（碰 3、三种杠 4，见 melds.ts 的 meldTileCount）。
 *
 * 这同时关掉了 S-03/R-04 的副作用：碰 3 张 + 暗 1 张 = 四归一，补杠或暗杠之后这 4 张变成杠，
 * 原先会归零（"做了个合法动作反而掉分"）；现在归一仍在。反面是明杠的 4 张现在**开始**计入归一。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { meldTileCount, type Meld } from '../melds';
import type { Counts } from '../counts';
import type { FanTag } from '../fanTags';

/** 归一牌码的个数（0..3）。 */
export function countGuiYi(counts: Counts, melds: readonly Meld[]): number {
  let quads = 0;
  for (let t = 11; t < counts.length; t++) {
    let n = counts[t];
    for (const meld of melds) {
      if (meld.tile === t) n += meldTileCount(meld);
    }
    if (n === 4) quads += 1;
  }
  return quads;
}

/** 一个个数对应一个标签；0 个与 4 个（不可能）都不给标签。 */
export function guiYiTag(quadCount: number): FanTag | null {
  if (quadCount === 1) return 'SI_GUI_YI';
  if (quadCount === 2) return 'BA_GUI_YI';
  if (quadCount === 3) return 'SHI_ER_GUI_YI';
  return null;
}
