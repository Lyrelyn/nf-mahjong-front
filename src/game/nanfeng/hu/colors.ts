// 移植自 nf-mahjong/assets/scripts/core/hu/colors.ts（逻辑未改动）
/**
 * 一色型判定：清一色（全同一数牌花色）与字一色（全字牌，风箭可混）。
 *
 * 副露参与判定：暗牌与全部副露牌必须同花色（或全为字牌）。
 * 空牌一律返回 false —— 不能让"没有牌"把谓词变成恒真。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import type { Counts } from '../counts';
import type { Meld } from '../melds';
import { isWord, suitOf, type Suit } from '../tiles';

function collectSuits(counts: Counts, melds: readonly Meld[]): Set<Suit> {
  const suits = new Set<Suit>();
  for (let t = 11; t < counts.length; t++) {
    if (counts[t] > 0) suits.add(suitOf(t));
  }
  for (const meld of melds) suits.add(suitOf(meld.tile));
  return suits;
}

/** 清一色：万 / 条 / 筒 三者之一，且牌数为正。 */
export function isQingYiSe(counts: Counts, melds: readonly Meld[]): boolean {
  const suits = collectSuits(counts, melds);
  if (suits.size !== 1) return false;
  const [only] = suits;
  return only === 'WAN' || only === 'TIAO' || only === 'TONG';
}

/** 字一色：全部为字牌（风与箭可混），且牌数为正。 */
export function isZiYiSe(counts: Counts, melds: readonly Meld[]): boolean {
  let hasTile = false;
  for (let t = 11; t < counts.length; t++) {
    if (counts[t] === 0) continue;
    hasTile = true;
    if (!isWord(t)) return false;
  }
  for (const meld of melds) {
    hasTile = true;
    if (!isWord(meld.tile)) return false;
  }
  return hasTile;
}
