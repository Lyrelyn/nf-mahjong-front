// 移植自 nf-mahjong/assets/scripts/core/hu/sevenPairs.ts（逻辑未改动）
/**
 * 七对判定。
 *
 * 南丰口径（规则文档 §2.5）：不要求 258 做将；4 张同牌算 2 对，
 * 因此四归一 / 八归一 / 十二归一可以叠加在七对之上。
 * 门清要求（无副露）由调用方 judgeHu 检查，本函数只看暗牌计数。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { totalCount, type Counts } from '../counts';

export function isSevenPairs(counts: Counts): boolean {
  // 总张数 14 且对数 7 ⟺ 每种牌都是偶数张（奇数张会浪费牌，使对数 < 7）。
  if (totalCount(counts) !== 14) return false;
  let pairs = 0;
  for (let t = 11; t < counts.length; t++) pairs += counts[t] >> 1;
  return pairs === 7;
}
