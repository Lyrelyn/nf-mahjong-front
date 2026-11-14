// 移植自 nf-mahjong/assets/scripts/core/hu/decompose.ts（逻辑未改动）
/**
 * 标准型判胡：4 组面子（顺子/刻子）+ 1 对将。
 *
 * 算法（规则文档 §2.4）：枚举将牌 → 扣掉 → 对剩余牌做面子分解。
 * 分解用「只从最小非零牌开始决策」的标准剪枝，保证不重不漏；
 * 记忆化用 countsKey 字符串（**不做位压缩**，见 S-05）。
 *
 * 字牌顺子（南丰特色）在 Task 7 接入 decompose 的 (c) 分支。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { countsKey, firstNonZero, totalCount, type Counts } from '../counts';
import { isNumberTile, isWord, rankOf, type Tile } from '../tiles';
import type { RuleConfig } from '../ruleConfig';
import { wordPatternsStartingAt } from './wordStraight';

/** 剩余牌是否已全部用尽。 */
function allZero(counts: Counts): boolean {
  for (let t = 11; t < counts.length; t++) if (counts[t] > 0) return false;
  return true;
}

/**
 * 能否用 counts 里的牌凑出 setsLeft 组面子。
 * 不改动调用方传入的 counts（内部先拷贝）。
 */
export function decompose(counts: Counts, setsLeft: number, cfg: RuleConfig): boolean {
  return search(counts.slice(), setsLeft, cfg, new Set<string>());
}

function search(counts: Counts, setsLeft: number, cfg: RuleConfig, failed: Set<string>): boolean {
  if (setsLeft === 0) return allZero(counts);

  const key = `${setsLeft}:${countsKey(counts)}`;
  if (failed.has(key)) return false;

  const t = firstNonZero(counts);
  if (t === -1) {
    failed.add(key);
    return false;
  }

  // (a) 刻子
  if (counts[t] >= 3) {
    counts[t] -= 3;
    const ok = search(counts, setsLeft - 1, cfg, failed);
    counts[t] += 3;
    if (ok) return true;
  }

  // (b) 数牌顺子：rank <= 7 才可能同花色连续三张
  if (isNumberTile(t) && rankOf(t) <= 7 && counts[t + 1] > 0 && counts[t + 2] > 0) {
    counts[t] -= 1;
    counts[t + 1] -= 1;
    counts[t + 2] -= 1;
    const ok = search(counts, setsLeft - 1, cfg, failed);
    counts[t] += 1;
    counts[t + 1] += 1;
    counts[t + 2] += 1;
    if (ok) return true;
  }

  // (c) 字牌顺子（南丰特色）：以 t 为最小元素的模式
  if (cfg.hu.wordStraight.enabled && isWord(t)) {
    for (const pattern of wordPatternsStartingAt(t)) {
      if (!pattern.every((p) => counts[p] > 0)) continue;
      for (const p of pattern) counts[p] -= 1;
      const ok = search(counts, setsLeft - 1, cfg, failed);
      for (const p of pattern) counts[p] += 1;
      if (ok) return true;
    }
  }

  failed.add(key);
  return false;
}

/**
 * 碰碰胡：4 组面子全部是刻子（副露里的碰与杠都算刻子），加一对将。
 * 与标准型共用同一套张数前提，但分解时只允许消耗刻子。
 */
export function isPengPengHu(counts: Counts, meldCount: number): boolean {
  const setsNeeded = 4 - meldCount;
  if (setsNeeded < 0) return false;
  if (totalCount(counts) !== setsNeeded * 3 + 2) return false;

  const work = counts.slice();
  for (let t = 11; t < work.length; t++) {
    if (work[t] < 2) continue;
    work[t] -= 2;
    const ok = consumeTriplets(work, setsNeeded);
    work[t] += 2;
    if (ok) return true;
  }
  return false;
}

function consumeTriplets(counts: Counts, setsLeft: number): boolean {
  if (setsLeft === 0) return allZero(counts);
  const t = firstNonZero(counts);
  // 最小非零牌不足 3 张就不可能成刻子，直接否
  if (t === -1 || counts[t] < 3) return false;
  counts[t] -= 3;
  const ok = consumeTriplets(counts, setsLeft - 1);
  counts[t] += 3;
  return ok;
}

/**
 * 碰碰胡单调：碰碰胡，且**胡的那张牌是把将牌配成对子的那一张**（听单钓将）。2026-10-06 新增。
 *
 * 为什么必须传 `winTile`：同一个 14 张成牌形 `111 222 333 444 55`，可能来自两种听牌形 ——
 *   - 来牌前 `111 222 333 444 + 5` → 胡 5 是单钓；
 *   - 来牌前 `111 222 333 44 55` → 胡 4 是对倒。
 * 只看成牌分不出两者，所以这**不是**成牌形的性质，而是"怎么胡的"的性质。
 *
 * 实现上就是把将牌钉死在 `winTile` 上，再要求剩下的牌全是刻子 ——
 * 正好是 `isPengPengHu` 把"枚举将牌"换成"将牌必须是胡的那张"。
 */
export function isPengPengHuDanDiao(counts: Counts, meldCount: number, winTile: Tile): boolean {
  const setsNeeded = 4 - meldCount;
  if (setsNeeded < 0) return false;
  if (totalCount(counts) !== setsNeeded * 3 + 2) return false;
  if (winTile < 0 || winTile >= counts.length) return false;
  if (counts[winTile] < 2) return false;

  const work = counts.slice();
  work[winTile] -= 2;
  return consumeTriplets(work, setsNeeded);
}

/**
 * 标准型判胡。
 * @param counts 暗牌计数
 * @param meldCount 已副露组数（每组抵扣 1 组面子需求）
 */
export function isStandard(counts: Counts, meldCount: number, cfg: RuleConfig): boolean {
  const setsNeeded = 4 - meldCount;
  if (setsNeeded < 0) return false;
  // 张数必须恰好：每组面子 3 张 + 将 2 张。先做这个判断可以挡掉绝大多数否例。
  if (totalCount(counts) !== setsNeeded * 3 + 2) return false;

  for (let t = 11; t < counts.length; t++) {
    if (counts[t] < 2) continue;
    counts[t] -= 2;
    const ok = decompose(counts, setsNeeded, cfg);
    counts[t] += 2;
    if (ok) return true;
  }
  return false;
}
