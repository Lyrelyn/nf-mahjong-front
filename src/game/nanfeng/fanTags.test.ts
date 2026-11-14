// 移植自 nf-mahjong/tests/core/fanTags.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { ALL_FAN_TAGS, FAN_TAG_ID, tagKey } from './fanTags';
import { DEFAULT_RULE_CONFIG } from './ruleConfig';

describe('标签表（Q-03：删掉天胡/地胡）', () => {
  it('不存在 TIAN_HU / DI_HU 两个标签 —— 南丰麻将没有这两个牌型', () => {
    expect(ALL_FAN_TAGS).not.toContain('TIAN_HU');
    expect(ALL_FAN_TAGS).not.toContain('DI_HU');
    expect('TIAN_HU' in FAN_TAG_ID).toBe(false);
    expect('DI_HU' in FAN_TAG_ID).toBe(false);
  });

  it('腾出来的 id 42/43 不复用给其它标签 —— 复用会让已有的 score.override 键静默改指', () => {
    expect(Object.values(FAN_TAG_ID)).not.toContain(42);
    expect(Object.values(FAN_TAG_ID)).not.toContain(43);
  });

  it('标签 id 唯一', () => {
    const ids = Object.values(FAN_TAG_ID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('组合键仍然按维度分段（一色型在归一系列之前）', () => {
    expect(tagKey(['SI_GUI_YI', 'ZI_YI_SE_ZHEN'])).toBe('ZI_YI_SE_ZHEN+SI_GUI_YI');
  });
});

describe('规则配置（Q-03：固定分通路删除）', () => {
  it('score 里没有天胡/地胡的固定分项', () => {
    expect('tianDiHu' in DEFAULT_RULE_CONFIG.score).toBe(false);
  });
});
