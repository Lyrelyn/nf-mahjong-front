// 移植自 nf-mahjong/tests/core/hu/shiSanLan.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import {
  countWordTiles,
  isQiXingShiSanLan,
  isShiSanLan,
  requiresSelfDraw,
} from './shiSanLan';
import { countsOf } from '../counts';

describe('十三烂', () => {
  it('间隔 ≥3 即成立，不限于 1/4/7 类（修正 S-04 的注释错误）', () => {
    // {1万,5万,9万} 相邻差 4、4，满足 ≥3，但既不属于 1/4/7 也不属于 2/5/8 或 3/6/9
    expect(isShiSanLan(countsOf([11, 15, 19, 21, 25, 29, 31, 35, 39, 41, 42, 43, 51, 52]))).toBe(true);
  });

  it('同花色间隔 <3 不成立', () => {
    expect(isShiSanLan(countsOf([11, 13, 19, 21, 25, 29, 31, 35, 39, 41, 42, 43, 51, 52]))).toBe(false);
  });

  it('同花色点数重复不成立', () => {
    expect(isShiSanLan(countsOf([11, 11, 19, 21, 25, 29, 31, 35, 39, 41, 42, 43, 51, 52]))).toBe(false);
  });

  it('字牌重复不成立', () => {
    expect(isShiSanLan(countsOf([11, 15, 19, 21, 25, 29, 31, 35, 39, 41, 41, 43, 51, 52]))).toBe(false);
  });

  it('不同花色的相同点数允许（R-05 已确认）', () => {
    expect(isShiSanLan(countsOf([11, 14, 17, 21, 24, 27, 31, 34, 37, 41, 42, 43, 51, 52]))).toBe(true);
  });

  it('13 张不成立', () => {
    expect(isShiSanLan(countsOf([11, 15, 19, 21, 25, 29, 31, 35, 39, 41, 42, 43, 51]))).toBe(false);
  });

  it('15 张不成立', () => {
    expect(isShiSanLan(countsOf([11, 15, 19, 21, 25, 29, 31, 35, 39, 41, 42, 43, 51, 52, 53]))).toBe(false);
  });
});

describe('七星十三烂', () => {
  it('字牌七种齐全即为七星', () => {
    const c = countsOf([11, 15, 21, 25, 31, 35, 39, 41, 42, 43, 44, 51, 52, 53]);
    expect(isShiSanLan(c)).toBe(true);
    expect(isQiXingShiSanLan(c)).toBe(true);
  });

  it('字牌只有六种时是十三烂但不算七星', () => {
    // 8 张数牌 + 6 种字牌 = 14 张，仍满足间隔要求
    const c = countsOf([11, 15, 19, 21, 25, 29, 31, 35, 41, 42, 43, 44, 51, 52]);
    expect(isShiSanLan(c)).toBe(true);
    expect(isQiXingShiSanLan(c)).toBe(false);
  });

  it('不成立十三烂时也不会成立七星', () => {
    const c = countsOf([11, 11, 19, 21, 25, 29, 31, 35, 39, 41, 42, 43, 44, 51]);
    expect(isQiXingShiSanLan(c)).toBe(false);
  });
});

/**
 * R-05 要求"字牌至少 5 张"。这里记录的是：这条下限**不是额外约束，而是推论**。
 * 每花色在 1..9 中相邻差 ≥3 最多取 3 张（1/4/7、1/5/9…），故数牌最多 3×3 = 9 张，
 * 14 张手牌里字牌必然 ≥ 5 张。所以 isShiSanLan 不需要再写一条下限判断。
 */
describe('字牌张数（R-05）', () => {
  it('数牌最多 9 张，故成立的十三烂其字牌数必为 5/6/7 —— 下限 5 无法被违反', () => {
    // 9 张数牌（每花色已取满 3 张）+ 5 张字牌 = 14 张，字牌数正好是下限
    const minWords = countsOf([11, 14, 17, 21, 24, 27, 31, 34, 37, 41, 42, 43, 51, 52]);
    expect(countWordTiles(minWords)).toBe(5);
    expect(isShiSanLan(minWords)).toBe(true);

    // 想凑到 4 张字牌就得有 10 张数牌，而第 10 张必然把某花色的间隔压到 3 以下
    const tenNumbers = countsOf([11, 14, 17, 21, 24, 27, 31, 34, 37, 39, 41, 42, 43, 51]);
    expect(countWordTiles(tenNumbers)).toBe(4);
    expect(isShiSanLan(tenNumbers)).toBe(false);
  });
});

describe('只能自摸的十三烂（R-05）', () => {
  it('字牌 5 张、6 张时只能自摸（点炮拒胡）', () => {
    expect(requiresSelfDraw(countsOf([11, 14, 17, 21, 24, 27, 31, 34, 37, 41, 42, 43, 51, 52]))).toBe(true);
    expect(requiresSelfDraw(countsOf([11, 15, 19, 21, 25, 29, 31, 35, 41, 42, 43, 44, 51, 52]))).toBe(true);
  });

  it('七星（字牌 7 张）可以点炮 —— 只是点数从 5 炮降到 3 炮', () => {
    expect(requiresSelfDraw(countsOf([11, 15, 21, 25, 31, 35, 39, 41, 42, 43, 44, 51, 52, 53]))).toBe(false);
  });

  it('不是十三烂的手牌一律不限制点炮', () => {
    expect(requiresSelfDraw(countsOf([11, 11, 11, 12, 12, 12, 13, 13, 13, 21, 21, 21, 31, 31]))).toBe(false);
  });

  it('张数不足 14（含被副露占用）时不限制点炮', () => {
    expect(requiresSelfDraw(countsOf([11, 14, 17, 21, 24, 27, 31, 34, 37, 41, 42, 43, 51]))).toBe(false);
  });
});
