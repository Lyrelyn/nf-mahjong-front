// 移植自 nf-mahjong/tests/core/hu/decompose.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { isPengPengHu, isPengPengHuDanDiao, isStandard } from './decompose';
import { countsOf } from '../counts';
import { DEFAULT_RULE_CONFIG } from '../ruleConfig';
import type { Meld } from '../melds';

const cfg = DEFAULT_RULE_CONFIG;

describe('标准型面子分解', () => {
  it('4 组面子 + 1 将成立', () => {
    const c = countsOf([11, 12, 13, 11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41]);
    expect(isStandard(c, 0, cfg)).toBe(true);
  });

  it('听牌形（13 张）不成立', () => {
    const c = countsOf([11, 12, 13, 11, 12, 13, 21, 22, 23, 31, 31, 31, 41]);
    expect(isStandard(c, 0, cfg)).toBe(false);
  });

  it('多一个单张不成立', () => {
    const c = countsOf([11, 12, 13, 11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 45]);
    expect(isStandard(c, 0, cfg)).toBe(false);
  });

  it('副露抵扣面子需求', () => {
    const c = countsOf([11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41]); // 3 组 + 将
    const melds: Meld[] = [{ kind: 'PENG', tile: 51, fromSeat: 2 }];
    expect(isStandard(c, melds.length, cfg)).toBe(true);
  });

  it('将牌有多种选择时，只有正确的那个成立（枚举必须走完全部候选）', () => {
    // 11/12/13 各两张 + 21 刻 + 31 刻 + 41 对：
    // 以 11、12、13 为将都拆不出第二组面子，只有以 41 为将时 11-12-13 能连续成两组顺子。
    const c = countsOf([11, 11, 12, 12, 13, 13, 21, 21, 21, 31, 31, 31, 41, 41]);
    expect(isStandard(c, 0, cfg)).toBe(true);
  });

  it('同为多将牌候选但都不成立时判否', () => {
    // 把 41 对换成 41 + 42，两组面子无法配齐
    const c = countsOf([11, 11, 12, 12, 13, 13, 21, 21, 21, 31, 31, 31, 41, 42]);
    expect(isStandard(c, 0, cfg)).toBe(false);
  });

  it('全刻子（碰碰胡形）成立', () => {
    const c = countsOf([11, 11, 11, 21, 21, 21, 31, 31, 31, 41, 41, 41, 51, 51]);
    expect(isStandard(c, 0, cfg)).toBe(true);
  });

  it('不修改调用方传入的 counts（纯函数语义）', () => {
    const c = countsOf([11, 12, 13, 11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41]);
    const before = c.join('');
    isStandard(c, 0, cfg);
    expect(c.join('')).toBe(before);
  });

  it('副露超过 4 组时不成立', () => {
    const c = countsOf([11, 11]);
    expect(isStandard(c, 5, cfg)).toBe(false);
  });
});

describe('碰碰胡单调：胡的那张牌配成将（2026-10-06 新增牌型）', () => {
  // 111 222 333 444 + 55 这个 14 张形，可能来自两种不同的听牌形：
  //   来牌前 111 222 333 444 5  → 胡 5 是单钓
  //   来牌前 111 222 333 44 55  → 胡 4 是对倒
  // 只看成牌分不出两者，所以判定必须知道"胡的是哪张"。
  const shape = (): ReturnType<typeof countsOf> =>
    countsOf([11, 11, 11, 21, 21, 21, 31, 31, 31, 41, 41, 41, 51, 51]);

  it('胡成将的那张 → 成立', () => {
    const c = shape();
    expect(isPengPengHu(c, 0)).toBe(true);
    expect(isPengPengHuDanDiao(c, 0, 51)).toBe(true);
  });

  it('对倒来的那一张 → 不算单调（同一个形，只看胡牌张就能区分）', () => {
    expect(isPengPengHuDanDiao(shape(), 0, 41)).toBe(false);
  });

  it('副露抵扣面子需求后同样成立', () => {
    const c = countsOf([11, 11, 11, 21, 21, 21, 31, 31, 31, 41, 41]); // 3 组 + 将
    expect(isPengPengHuDanDiao(c, 1, 41)).toBe(true);
  });

  it('不是碰碰胡（含顺子）一律不成立', () => {
    // 11/12/13 各两张 + 14/15/16 顺子：将牌候选都拆不出全刻子
    const c = countsOf([11, 11, 12, 12, 13, 13, 14, 15, 16, 21, 21, 21, 41, 41]);
    expect(isPengPengHu(c, 0)).toBe(false);
    expect(isPengPengHuDanDiao(c, 0, 41)).toBe(false);
  });

  it('张数不对、或手上根本没有那张牌时不成立', () => {
    expect(isPengPengHuDanDiao(countsOf([11, 11, 11, 21, 21, 21, 31, 31, 31, 41, 41]), 0, 41)).toBe(
      false,
    );
    expect(isPengPengHuDanDiao(shape(), 0, 52)).toBe(false);
  });

  it('不修改调用方传入的 counts（纯函数语义）', () => {
    const c = shape();
    const before = c.join('');
    isPengPengHuDanDiao(c, 0, 51);
    expect(c.join('')).toBe(before);
  });
});
