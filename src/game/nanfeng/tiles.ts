// 移植自 nf-mahjong/assets/scripts/core/tiles.ts（逻辑未改动）
/**
 * 牌编码与常量。
 *
 * 编码约定（spec「Global Constraints」）：
 *   万 11..19 / 条 21..29 / 筒 31..39 / 风 41..44（东南西北）/ 箭 51..53（中发白）
 *   54..60 保留，61+ 预留给马牌。
 *
 * 本文件属于引擎禁区（spec §3.3）：不得 import Cocos、不得使用 Math.random / Date.now / IO。
 */

export type Tile = number;

export type Suit = 'WAN' | 'TIAO' | 'TONG' | 'WIND' | 'DRAGON';

/** counts 数组长度：下标即牌码；0..10 与 54.. 不使用。 */
export const COUNT_SIZE = 54;

/** 整副牌张数（每种 4 张）。R-01 确认牌张构成后如需调整，只改 fullWall()。 */
export const WALL_SIZE = 136;

/** 数牌：万 11..19、条 21..29、筒 31..39。 */
export function isNumberTile(t: Tile): boolean {
  return t >= 11 && t <= 39 && t % 10 >= 1 && t % 10 <= 9;
}

/** 风牌：41..44（东南西北）。 */
export function isWind(t: Tile): boolean {
  return t >= 41 && t <= 44;
}

/** 箭牌：51..53（中发白）。 */
export function isDragon(t: Tile): boolean {
  return t >= 51 && t <= 53;
}

/** 字牌 = 风牌 或 箭牌。 */
export function isWord(t: Tile): boolean {
  return isWind(t) || isDragon(t);
}

/** 任一有效牌码。 */
export function isValidTile(t: Tile): boolean {
  return isNumberTile(t) || isWord(t);
}

/** 花色。非法牌码抛错，不静默返回。 */
export function suitOf(t: Tile): Suit {
  if (isNumberTile(t)) {
    const tens = Math.floor(t / 10);
    if (tens === 1) return 'WAN';
    if (tens === 2) return 'TIAO';
    return 'TONG';
  }
  if (isWind(t)) return 'WIND';
  if (isDragon(t)) return 'DRAGON';
  throw new RangeError(`非法牌码：${t}`);
}

/** 点数：数牌 1..9；风 1..4；箭 1..3。非法牌码抛错。 */
export function rankOf(t: Tile): number {
  if (isNumberTile(t)) return t % 10;
  if (isWind(t)) return t - 40;
  if (isDragon(t)) return t - 50;
  throw new RangeError(`非法牌码：${t}`);
}

/** 整副牌：34 种 × 4 张 = 136 张。顺序固定，洗牌由 core/prng.ts 负责。 */
export function fullWall(): Tile[] {
  const wall: Tile[] = [];
  for (const base of [10, 20, 30]) {
    for (let rank = 1; rank <= 9; rank++) {
      for (let copy = 0; copy < 4; copy++) wall.push(base + rank);
    }
  }
  for (let t = 41; t <= 44; t++) {
    for (let copy = 0; copy < 4; copy++) wall.push(t);
  }
  for (let t = 51; t <= 53; t++) {
    for (let copy = 0; copy < 4; copy++) wall.push(t);
  }
  return wall;
}
