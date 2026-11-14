// 移植自 nf-mahjong/assets/scripts/core/hu/wordStraight.ts（逻辑未改动）
/**
 * 字牌顺子模式表（南丰特色）：3 张**不同**字牌组成一组面子。
 *
 * 约束（规则文档 §2.3）：
 *   - 风牌（东南西北）取 3 有 4 种组合，箭牌（中发白）取 3 有 1 种，共 5 种；
 *   - 风与箭不可混搭；
 *   - 每个模式按牌码升序存储 —— 这是 decompose 剪枝正确性的前提：
 *     回溯时只从"最小非零牌"开始决策，因此只需要考虑以它为首张的模式。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { isDragon, isWind, type Tile } from '../tiles';

export const WORD_PATTERNS: readonly (readonly Tile[])[] = [
  [41, 42, 43], // 东南西
  [41, 42, 44], // 东南北
  [41, 43, 44], // 东西北
  [42, 43, 44], // 南北西
  [51, 52, 53], // 中发白
];

/** 以 t 为最小元素的模式（t 必须是字牌，否则返回空数组）。 */
export function wordPatternsStartingAt(t: Tile): readonly (readonly Tile[])[] {
  if (!isWind(t) && !isDragon(t)) return [];
  return WORD_PATTERNS.filter((pattern) => pattern[0] === t);
}
