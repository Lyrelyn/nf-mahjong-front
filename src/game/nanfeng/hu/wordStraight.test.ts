// 移植自 nf-mahjong/tests/core/hu/wordStraight.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { WORD_PATTERNS, wordPatternsStartingAt } from './wordStraight';
import { isStandard } from './decompose';
import { countsOf } from '../counts';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from '../ruleConfig';
import { isDragon, isWind } from '../tiles';

const withWordStraight: RuleConfig = DEFAULT_RULE_CONFIG;
const withoutWordStraight: RuleConfig = {
  ...DEFAULT_RULE_CONFIG,
  hu: { ...DEFAULT_RULE_CONFIG.hu, wordStraight: { enabled: false } },
};

describe('字牌顺子模式表', () => {
  it('恰好 5 种模式，且每种按牌码升序', () => {
    expect(WORD_PATTERNS).toHaveLength(5);
    expect(WORD_PATTERNS.map((p) => p.join(','))).toEqual([
      '41,42,43',
      '41,42,44',
      '41,43,44',
      '42,43,44',
      '51,52,53',
    ]);
    for (const p of WORD_PATTERNS) expect([...p]).toEqual([...p].sort((a, b) => a - b));
  });

  it('风与箭不可混搭', () => {
    for (const p of WORD_PATTERNS) {
      expect(p.every((t) => isWind(t)) || p.every((t) => isDragon(t)), p.join(',')).toBe(true);
    }
  });

  it('按最小元素索引：41 起 3 种、42 起 1 种、43 起 0 种、51 起 1 种', () => {
    expect(wordPatternsStartingAt(41)).toHaveLength(3);
    expect(wordPatternsStartingAt(42)).toHaveLength(1);
    expect(wordPatternsStartingAt(43)).toEqual([]); // 43 永远不可能成为"最小非零牌"
    expect(wordPatternsStartingAt(44)).toEqual([]);
    expect(wordPatternsStartingAt(51)).toHaveLength(1);
  });
});

describe('字牌顺子参与面子分解', () => {
  const hand = countsOf([41, 42, 43, 11, 12, 13, 21, 22, 23, 31, 31, 31, 51, 51]);

  it('开启时字牌顺子可作一组面子', () => {
    expect(isStandard(hand, 0, withWordStraight)).toBe(true);
  });

  it('关闭时退化为刻子判定，同一手牌不成立', () => {
    expect(isStandard(hand, 0, withoutWordStraight)).toBe(false);
  });

  it('中发白顺子同样成立', () => {
    const c = countsOf([51, 52, 53, 11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41]);
    expect(isStandard(c, 0, withWordStraight)).toBe(true);
  });

  it('风与箭混搭不成面子', () => {
    // 41,42,51 不是任何模式，且无法用刻子补齐
    const c = countsOf([41, 42, 51, 11, 12, 13, 21, 22, 23, 31, 31, 31, 43, 43]);
    expect(isStandard(c, 0, withWordStraight)).toBe(false);
  });
});
