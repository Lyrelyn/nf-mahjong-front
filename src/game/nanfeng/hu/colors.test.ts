// 移植自 nf-mahjong/tests/core/hu/colors.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { isQingYiSe, isZiYiSe } from './colors';
import { countsOf } from '../counts';
import type { Meld } from '../melds';

describe('清一色', () => {
  it('暗牌 + 副露同属一个数牌花色 → 成立', () => {
    const melds: Meld[] = [{ kind: 'PENG', tile: 17, fromSeat: 2 }];
    expect(isQingYiSe(countsOf([11, 12, 13, 14, 15, 16]), melds)).toBe(true);
  });

  it('副露与暗牌不同花色 → 不成立', () => {
    const melds: Meld[] = [{ kind: 'PENG', tile: 27, fromSeat: 2 }];
    expect(isQingYiSe(countsOf([11, 12, 13]), melds)).toBe(false);
  });

  it('只有字牌 → 不是清一色（那是字一色）', () => {
    expect(isQingYiSe(countsOf([41, 42, 51]), [])).toBe(false);
  });

  it('空牌不算清一色（不能因为"没有牌"而恒真）', () => {
    expect(isQingYiSe(countsOf([]), [])).toBe(false);
  });
});

describe('字一色', () => {
  it('全字牌成立，风与箭可混', () => {
    expect(isZiYiSe(countsOf([41, 42, 51, 52]), [])).toBe(true);
  });

  it('含数牌不成立', () => {
    expect(isZiYiSe(countsOf([41, 42, 11]), [])).toBe(false);
  });

  it('副露是数牌时不成立', () => {
    const melds: Meld[] = [{ kind: 'PENG', tile: 11, fromSeat: 1 }];
    expect(isZiYiSe(countsOf([41, 42]), melds)).toBe(false);
  });

  it('副露全字牌且暗牌全字牌 → 成立', () => {
    const melds: Meld[] = [{ kind: 'AN_GANG', tile: 41, fromSeat: null }];
    expect(isZiYiSe(countsOf([51, 52]), melds)).toBe(true);
  });

  it('空牌不算字一色', () => {
    expect(isZiYiSe(countsOf([]), [])).toBe(false);
  });
});
