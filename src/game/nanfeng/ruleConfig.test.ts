// 移植自 nf-mahjong/tests/core/ruleConfig.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { DEFAULT_RULE_CONFIG, validateRuleConfig, type RuleConfig } from './ruleConfig';

const cfg = DEFAULT_RULE_CONFIG;

describe('计分与鸣牌开关（Task 0 规则校准）', () => {
  it('自摸不翻倍（Q-01）：自摸与点炮的单价相同，只是付款人数不同', () => {
    expect(cfg.score.zimoDouble).toBe(false);
  });

  it('杠分（Q-02）：直杠 2 / 补杠 1 / 暗杠 2，在开杠时即时结算', () => {
    expect(cfg.score.gang).toEqual({ mingGang: 2, buGang: 1, anGang: 2 });
  });

  it('荒庄（R-08）：庄家赔每家 1 分（共 3 分）', () => {
    expect(cfg.score.huangZhuang).toEqual({ dealerPaysEach: 1 });
  });

  it('一炮多响（Q-05）：多家同时胡都算，放炮者分别付给每家', () => {
    expect(cfg.claim.allowMultipleHu).toBe(true);
  });

  it('封顶 8 炮（2026-10-06 改规，原为不封顶）：只有杠分能突破', () => {
    expect(cfg.score.cap).toBe(8);
    // 杠分是独立台账，不参与封顶；荒庄也保留
    expect(cfg.score.gang).toEqual({ mingGang: 2, buGang: 1, anGang: 2 });
  });

  it('买码（R-09，已确认）：默认不买码，张数只能是 0/1/2/4', () => {
    expect(cfg.buyCode.count).toBe(0);
    expect(() => validateRuleConfig({ ...cfg, buyCode: { count: 3 as never } })).toThrow(/buyCode/);
    for (const count of [0, 1, 2, 4]) {
      expect(() => validateRuleConfig({ ...cfg, buyCode: { count: count as never } })).not.toThrow();
    }
  });
});

describe('漏碰/漏胡限制不存在（R-06）', () => {
  it('配置项 forbiddenHu 整个删除 —— 两条限制都不存在，没有可配的东西', () => {
    expect('forbiddenHu' in cfg).toBe(false);
  });
});

describe('配置自检（新增校验）', () => {
  it('默认配置合法', () => {
    expect(() => validateRuleConfig(cfg)).not.toThrow();
  });

  it('杠分为负 → 启动即失败', () => {
    const bad: RuleConfig = {
      ...cfg,
      score: { ...cfg.score, gang: { ...cfg.score.gang, anGang: -1 } },
    };
    expect(() => validateRuleConfig(bad)).toThrow(/gang/);
  });

  it('荒庄赔付为负 → 启动即失败', () => {
    const bad: RuleConfig = {
      ...cfg,
      score: { ...cfg.score, huangZhuang: { dealerPaysEach: -1 } },
    };
    expect(() => validateRuleConfig(bad)).toThrow(/huangZhuang/);
  });
});
