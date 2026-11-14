// 移植自 nf-mahjong/tests/core/hu/jiaHu.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { isJiaHu } from './jiaHu';
import { countsOf } from '../counts';
import type { Meld } from '../melds';

/**
 * 假胡（南丰已确认的口径，规则文档 §2.8）：
 * 全部牌同属一个花色，或全部为字牌 —— **不需要构成任何面子/将**。
 * 牌张数（14 张）不是这个谓词的职责，由 judgeHu 在整手牌层面检查。
 */
describe('假胡', () => {
  it('全同一花色即成立，不需要任何面子结构', () => {
    expect(isJiaHu(countsOf([11, 11, 12, 14, 15, 17, 17, 19, 19]), [])).toBe(true);
  });

  it('数牌与字牌混杂不成立', () => {
    expect(isJiaHu(countsOf([11, 12, 41]), [])).toBe(false);
  });

  it('跨两个数牌花色不成立', () => {
    expect(isJiaHu(countsOf([11, 12, 21]), [])).toBe(false);
  });

  it('副露参与花色判定', () => {
    const sameSuit: Meld[] = [{ kind: 'PENG', tile: 19, fromSeat: 1 }];
    const otherSuit: Meld[] = [{ kind: 'PENG', tile: 29, fromSeat: 1 }];
    expect(isJiaHu(countsOf([11, 12]), sameSuit)).toBe(true);
    expect(isJiaHu(countsOf([11, 12]), otherSuit)).toBe(false);
  });

  it('全字牌成立（风箭混搭也算）', () => {
    expect(isJiaHu(countsOf([41, 44, 51, 53]), [])).toBe(true);
  });

  it('空牌不成立', () => {
    expect(isJiaHu(countsOf([]), [])).toBe(false);
  });
});
