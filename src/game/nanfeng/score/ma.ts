// 买码（码牌）—— 第 5 个参与者「买码位」跟着一个打牌座位收付。
/**
 * 口径（R-09，已与牌友确认；设计与推导见
 * `docs/superpowers/specs/2026-11-08-nanfeng-ma-design.md`）：
 *
 * * 开局洗牌后，牌墙**末尾 N 张**留作码牌（N = `cfg.buyCode.count`，可选 0/1/2/4）。
 *   它们不参与发牌、也不参与摸牌，所以本局牌墙少 N 张、荒庄提前 N 张。
 * * 局中码牌**不公开**，结算时按翻开顺序公开。
 * * **每张码牌按点数指向场上一个打牌座位**：`(点数 − 1) % 4`，0 = 庄家、1 = 庄下家、
 *   2 = 对家、3 = 庄上家。字牌用自己的点数（东南西北 1..4、中发白 1..3）。
 * * 结算见 `score/settle.ts`：买码位复制被指向座位这一局的**每一笔现金流**，多张同座位叠加。
 *
 * 码牌复用真实牌码（洗牌结果里的牌），**不占用** 61+ 那段预留编码。
 *
 * 本文件属于引擎禁区（spec §3.3）：不得 import Cocos、不得使用 Math.random / Date.now / IO。
 */

import { rankOf, type Tile } from '../tiles';

/** 开局可选的码牌张数（0 = 不买码，买码不是必须的）。 */
export const MA_COUNT_CHOICES = [0, 1, 2, 4] as const;

export type MaCount = (typeof MA_COUNT_CHOICES)[number];

/** 一桌固定 4 个打牌座位（买码位不占座位）。 */
export const MA_TABLE_SEATS = 4;

export function isMaCount(value: number): value is MaCount {
  return (MA_COUNT_CHOICES as readonly number[]).includes(value);
}

/** 码牌指向**相对庄家**的第几个座位（0 = 庄家，1 = 下家，2 = 对家，3 = 上家）。 */
export function maPosition(tile: Tile): number {
  return (rankOf(tile) - 1) % MA_TABLE_SEATS;
}

/** 码牌指向的绝对座位号（0..3）。 */
export function maTargetSeat(tile: Tile, dealer: number): number {
  return (dealer + maPosition(tile)) % MA_TABLE_SEATS;
}

/** 按翻开顺序给出每张码牌指向的座位。 */
export function maTargets(tiles: readonly Tile[], dealer: number): number[] {
  return tiles.map((tile) => maTargetSeat(tile, dealer));
}
