// 移植自 nf-mahjong/tests/core/hu/sevenPairs.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { isSevenPairs } from './sevenPairs';
import { countsOf } from '../counts';

describe('七对', () => {
  it('7 个对子成立，且不要求 258 将', () => {
    expect(isSevenPairs(countsOf([11, 11, 12, 12, 13, 13, 21, 21, 22, 22, 41, 41, 53, 53]))).toBe(true);
  });

  it('4 张同牌算 2 对', () => {
    expect(isSevenPairs(countsOf([11, 11, 11, 11, 12, 12, 13, 13, 21, 21, 22, 22, 41, 41]))).toBe(true);
  });

  it('3 组四张 + 1 对（7 对）成立', () => {
    expect(isSevenPairs(countsOf([11, 11, 11, 11, 21, 21, 21, 21, 31, 31, 31, 31, 41, 41]))).toBe(true);
  });

  it('6 对 + 两张单张（14 张）不成立', () => {
    expect(isSevenPairs(countsOf([11, 11, 12, 12, 13, 13, 21, 21, 22, 22, 41, 41, 43, 44]))).toBe(false);
  });

  it('13 张不成立（张数不足）', () => {
    expect(isSevenPairs(countsOf([11, 11, 12, 12, 13, 13, 21, 21, 22, 22, 41, 41, 43]))).toBe(false);
  });

  it('15 张不成立（张数过多）', () => {
    expect(isSevenPairs(countsOf([11, 11, 12, 12, 13, 13, 21, 21, 22, 22, 41, 41, 43, 43, 44]))).toBe(false);
  });
});
