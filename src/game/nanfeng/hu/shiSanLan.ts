// 移植自 nf-mahjong/assets/scripts/core/hu/shiSanLan.ts（逻辑未改动）
/**
 * 十三烂 / 七星十三烂判定。
 *
 * 口径（规则文档 §2.6，S-04 修正后；R-05 已与牌友确认）：
 *   - 必须门清（无副露），14 张 —— 门清由调用方 judgeHu 检查；
 *   - 数牌：同花色内点数不重复，且排序后**相邻差 ≥ 3**（"1 和 4 这样就行"）。
 *     注意不是"只能落在 1/4/7、2/5/8、3/6/9"——{1,5,9} 相邻差 4、4 也成立（S-04 的注释错误）；
 *   - 字牌：互不重复（风牌与箭牌合计不超过 7 种）；
 *   - **字牌至少 5 张** —— 这条不需要写成判断：每花色在 1..9 中相邻差 ≥3 最多取 3 张，
 *     数牌最多 3×3 = 9 张，14 张手牌里字牌必然 ≥ 5 张（见 shiSanLan.test.ts 的推论用例）；
 *   - 七星十三烂：十三烂 且 东南西北中发白 七种字牌各恰好一张。
 *
 * R-05 还定了一条**胡牌方式**限制（不只是计分）：字牌 5 张或 6 张的十三烂只能自摸，
 * 点炮不许胡；7 张（七星）可以点炮，但点数从 5 炮降到 3 炮（炮数在计分表里，见 Task 18）。
 * 谓词是 requiresSelfDraw。
 *
 * 命名不用 isThirteenOrphans —— 英文里那指的是国士无双（S-08）。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { totalCount, type Counts } from '../counts';
import type { Tile } from '../tiles';

const NUMBER_SUIT_BASES = [10, 20, 30] as const;
const WIND_TILES = [41, 42, 43, 44] as const;
const DRAGON_TILES = [51, 52, 53] as const;
/** 七星十三烂要求的七种字牌。 */
const SEVEN_WORD_TILES: readonly Tile[] = [...WIND_TILES, ...DRAGON_TILES];

export function isShiSanLan(counts: Counts): boolean {
  if (totalCount(counts) !== 14) return false;

  for (const base of NUMBER_SUIT_BASES) {
    let prevRank = 0;
    for (let rank = 1; rank <= 9; rank++) {
      const n = counts[base + rank];
      if (n === 0) continue;
      if (n > 1) return false; // 同花色点数重复
      if (prevRank !== 0 && rank - prevRank < 3) return false; // 相邻差 < 3
      prevRank = rank;
    }
  }

  for (const t of SEVEN_WORD_TILES) if (counts[t] > 1) return false;

  return true;
}

export function isQiXingShiSanLan(counts: Counts): boolean {
  if (!isShiSanLan(counts)) return false;
  for (const t of SEVEN_WORD_TILES) if (counts[t] !== 1) return false;
  return true;
}

/** 字牌张数（东南西北 + 中发白），十三烂的"几星"看的就是它。 */
export function countWordTiles(counts: Counts): number {
  let n = 0;
  for (const t of SEVEN_WORD_TILES) n += counts[t];
  return n;
}

/**
 * 这手牌是否**只能自摸**（R-05）。
 *
 * 十三烂且字牌 5 或 6 张 → true，点炮路径必须直接拒胡；
 * 七星（7 张字牌）与其它所有牌型 → false，自摸点炮都能胡。
 *
 * 副露的牌不在 counts 里，所以有副露时 totalCount < 14 → isShiSanLan 为 false → 返回 false，
 * 与"十三烂必须门清"一致。
 */
export function requiresSelfDraw(counts: Counts): boolean {
  if (!isShiSanLan(counts)) return false;
  return countWordTiles(counts) < 7;
}
