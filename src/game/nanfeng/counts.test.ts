// 移植自 nf-mahjong/tests/core/counts.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { countsOf, countsKey, firstNonZero, totalCount } from './counts';
import { COUNT_SIZE } from './tiles';

describe('计数工具', () => {
  it('countsOf 统计每种牌的张数', () => {
    const c = countsOf([11, 11, 23]);
    expect(c[11]).toBe(2);
    expect(c[23]).toBe(1);
    expect(c[12]).toBe(0);
    expect(totalCount(c)).toBe(3);
  });

  it('countsOf 每次返回长度 COUNT_SIZE 的新数组', () => {
    expect(countsOf([11])).toHaveLength(COUNT_SIZE);
    expect(countsOf([11])).not.toBe(countsOf([11]));
  });

  it('firstNonZero 返回最小非零牌码', () => {
    const c = countsOf([11, 11, 23, 45]);
    expect(firstNonZero(c)).toBe(11);
    c[11] = 0;
    c[23] = 0;
    expect(firstNonZero(c)).toBe(45);
    expect(firstNonZero(countsOf([]))).toBe(-1);
  });

  it('countsKey 对相同计数稳定、对不同计数不同', () => {
    expect(countsKey(countsOf([11, 12]))).toBe(countsKey(countsOf([12, 11])));
    expect(countsKey(countsOf([11, 12]))).not.toBe(countsKey(countsOf([11, 13])));
  });
});
