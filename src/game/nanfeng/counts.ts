// 移植自 nf-mahjong/assets/scripts/core/counts.ts（逻辑未改动）
/**
 * 计数工具：把一组牌折算成 int[COUNT_SIZE] 计数数组。
 *
 * 判胡、归一、牌张守恒都在 counts 上运算，避免到处传牌数组。
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { COUNT_SIZE, type Tile } from './tiles';

/** 下标即牌码的计数数组。 */
export type Counts = Uint8Array;

/** 统计每种牌的张数，每次返回新数组。 */
export function countsOf(tiles: readonly Tile[]): Counts {
  const c = new Uint8Array(COUNT_SIZE);
  for (const t of tiles) c[t] += 1;
  return c;
}

/** 总张数。 */
export function totalCount(c: Counts): number {
  let n = 0;
  for (let i = 0; i < c.length; i++) n += c[i];
  return n;
}

/**
 * 最小非零牌码；全零返回 -1。
 * 判胡回溯的剪枝基础：每张牌必然属于某个面子，且以它为首张。
 */
export function firstNonZero(c: Counts): Tile | -1 {
  for (let t = 11; t < c.length; t++) if (c[t] > 0) return t;
  return -1;
}

/**
 * 记忆化用的稳定字符串键。
 * 刻意不做位压缩（修正 S-05）：14 张手牌规模下字符串键足够快，而位宽算错是静默出错。
 */
export function countsKey(c: Counts): string {
  return c.join('');
}
