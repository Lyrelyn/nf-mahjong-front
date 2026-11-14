// 移植自 nf-mahjong/tests/core/hu/huJudge.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { judgeHu } from './huJudge';
import { countsOf } from '../counts';
import { DEFAULT_RULE_CONFIG, validateRuleConfig, type RuleConfig } from '../ruleConfig';
import { tagKey } from '../fanTags';
import type { Meld } from '../melds';

const cfg = DEFAULT_RULE_CONFIG;

describe('judgeHu 维度合并', () => {
  it('全万子标准型：给结构标签与清一色真胡，不给假胡标签（S-01/S-02 的回归锁）', () => {
    const c = countsOf([11, 12, 13, 11, 12, 13, 14, 15, 16, 17, 17, 17, 18, 18]);
    const r = judgeHu(c, [], cfg);
    expect(r.structure).toBe('STANDARD');
    expect(r.tags.has('PING_HU')).toBe(true);
    expect(r.tags.has('QING_YI_SE_ZHEN')).toBe(true);
    expect(r.tags.has('QING_YI_SE_JIA')).toBe(false);
  });

  it('全同一花色但不成结构 → 假胡', () => {
    const c = countsOf([11, 11, 12, 14, 15, 17, 17, 19, 19, 11, 12, 14, 15, 17]);
    const r = judgeHu(c, [], cfg);
    expect(r.structure).toBe('NONE');
    expect(r.tags.has('QING_YI_SE_JIA')).toBe(true);
    expect(r.tags.has('QING_YI_SE_ZHEN')).toBe(false);
  });

  it('七对 + 清一色 同时给两个标签（计分表的多标签行必须可达）', () => {
    const c = countsOf([11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16, 16, 17, 17]);
    const r = judgeHu(c, [], cfg);
    expect(r.structure).toBe('QI_DUI');
    expect(r.tags.has('QI_DUI')).toBe(true);
    expect(r.tags.has('QING_YI_SE_ZHEN')).toBe(true);
    expect(r.tags.size).toBeGreaterThan(1);
  });

  it('七对 + 四归一 叠加', () => {
    const c = countsOf([11, 11, 11, 11, 12, 12, 13, 13, 21, 21, 22, 22, 41, 41]);
    const r = judgeHu(c, [], cfg);
    expect(r.structure).toBe('QI_DUI');
    expect(r.tags.has('QI_DUI')).toBe(true);
    expect(r.tags.has('SI_GUI_YI')).toBe(true);
  });

  it('碰碰胡 + 字一色真胡（一副露都不需要）', () => {
    const c = countsOf([41, 41, 41, 42, 42, 42, 43, 43, 43, 51, 51, 51, 52, 52]);
    const r = judgeHu(c, [], cfg);
    expect(r.structure).toBe('STANDARD');
    expect(r.tags.has('PENG_PENG_HU')).toBe(true);
    expect(r.tags.has('ZI_YI_SE_ZHEN')).toBe(true);
    expect(r.tags.has('ZI_YI_SE_JIA')).toBe(false);
  });

  it('十三烂 与 七星十三烂 分别给对应标签', () => {
    const lan = judgeHu(countsOf([11, 15, 19, 21, 25, 29, 31, 35, 39, 41, 42, 43, 51, 52]), [], cfg);
    expect(lan.structure).toBe('SHI_SAN_LAN');
    expect(lan.tags.has('SHI_SAN_LAN')).toBe(true);

    const qiXing = judgeHu(countsOf([11, 15, 21, 25, 31, 35, 39, 41, 42, 43, 44, 51, 52, 53]), [], cfg);
    expect(qiXing.structure).toBe('SHI_SAN_LAN');
    expect(qiXing.tags.has('QI_XING_SHI_SAN_LAN')).toBe(true);
    expect(qiXing.tags.has('SHI_SAN_LAN')).toBe(false);
  });

  it('有副露时不判七对与十三烂', () => {
    const melds: Meld[] = [{ kind: 'PENG', tile: 41, fromSeat: 1 }];
    const r = judgeHu(countsOf([11, 11, 12, 12, 13, 13, 21, 21, 22, 22]), melds, cfg);
    expect(r.structure).not.toBe('QI_DUI');
    expect(r.tags.has('QI_DUI')).toBe(false);
  });

  it('关掉假胡开关后整条通路失效', () => {
    const off: RuleConfig = { ...cfg, hu: { ...cfg.hu, jiaHu: { enabled: false, allowRon: false } } };
    const c = countsOf([11, 11, 12, 14, 15, 17, 17, 19, 19, 11, 12, 14, 15, 17]);
    expect(judgeHu(c, [], off).tags.size).toBe(0);
  });

  it('张数不是 14（含副露折算）时一律不胡', () => {
    // 9 张全万子：花色够格，但张数不足 —— 不能让短牌型被判成假胡
    const short = countsOf([11, 11, 12, 14, 15, 17, 17, 19, 19]);
    expect(judgeHu(short, [], cfg).tags.size).toBe(0);

    // 10 张暗牌 + 1 组碰 = 13 张，同样不足
    const melds: Meld[] = [{ kind: 'PENG', tile: 41, fromSeat: 1 }];
    expect(judgeHu(countsOf([11, 11, 12, 12, 13, 13, 21, 21, 22, 22]), melds, cfg).tags.size).toBe(0);
  });

  it('副露计入张数：11 张暗牌 + 1 组碰 = 14 张，可正常判胡', () => {
    const melds: Meld[] = [{ kind: 'PENG', tile: 41, fromSeat: 1 }];
    const c = countsOf([11, 12, 13, 11, 12, 13, 14, 15, 16, 18, 18]);
    const r = judgeHu(c, melds, cfg);
    expect(r.structure).toBe('STANDARD');
    expect(r.tags.has('PING_HU')).toBe(true);
  });
});

describe('组合键的稳定性（S-06）', () => {
  it('与标签书写顺序无关', () => {
    expect(tagKey(['SI_GUI_YI', 'ZI_YI_SE_ZHEN'])).toBe(tagKey(['ZI_YI_SE_ZHEN', 'SI_GUI_YI']));
  });

  it('按维度分段排序：一色型在归一系列之前（与规则文档计分表的写法一致）', () => {
    expect(tagKey(['SI_GUI_YI', 'ZI_YI_SE_ZHEN'])).toBe('ZI_YI_SE_ZHEN+SI_GUI_YI');
    expect(tagKey(['SHI_ER_GUI_YI', 'ZI_YI_SE_ZHEN', 'QI_DUI'])).toBe('QI_DUI+ZI_YI_SE_ZHEN+SHI_ER_GUI_YI');
  });

  it('去重', () => {
    expect(tagKey(['QI_DUI', 'QI_DUI'])).toBe('QI_DUI');
  });
});

describe('配置自检', () => {
  it('默认配置合法', () => {
    expect(() => validateRuleConfig(cfg)).not.toThrow();
  });

  it('override 键里出现未知标签 → 启动即失败', () => {
    const bad: RuleConfig = { ...cfg, score: { ...cfg.score, override: { 'QI_DUI+NOT_A_TAG': 99 } } };
    expect(() => validateRuleConfig(bad)).toThrow(/未知标签/);
  });

  it('override 键的顺序不对 → 启动即失败（否则整张表静默失配）', () => {
    const bad: RuleConfig = {
      ...cfg,
      score: { ...cfg.score, override: { 'SI_GUI_YI+ZI_YI_SE_ZHEN': 99 } },
    };
    expect(() => validateRuleConfig(bad)).toThrow(/顺序/);
  });

  it('顺序正确的 override 键通过', () => {
    const good: RuleConfig = {
      ...cfg,
      score: { ...cfg.score, override: { 'QI_DUI+ZI_YI_SE_ZHEN+SHI_ER_GUI_YI': 321 } },
    };
    expect(() => validateRuleConfig(good)).not.toThrow();
  });

  it('买码张数（R-09）只能是 0/1/2/4，其余一律启动即失败', () => {
    expect(() => validateRuleConfig({ ...cfg, buyCode: { count: 3 as never } })).toThrow(/buyCode/);
    expect(() => validateRuleConfig({ ...cfg, buyCode: { count: 2 as never } })).not.toThrow();
  });
});
