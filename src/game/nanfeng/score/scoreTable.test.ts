// 移植自 nf-mahjong/tests/core/score/scoreTable.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { COLOR_BONUS, GUI_YI_BONUS, scoreOfTags, STRUCTURE_SCORE } from './scoreTable';
import { ALL_FAN_TAGS, type FanTag } from '../fanTags';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from '../ruleConfig';

const cfg = DEFAULT_RULE_CONFIG;
const tags = (...t: FanTag[]): Set<FanTag> => new Set(t);
const score = (set: Set<FanTag>, c: RuleConfig = cfg, zimo = false): number =>
  scoreOfTags(set, c, { zimo }).score;

describe('分层计分：结构型（取最高）', () => {
  it('单标签基础分与 Task 0 确认的数值一致', () => {
    expect(score(tags('PING_HU'))).toBe(1);
    expect(score(tags('SHI_SAN_LAN'))).toBe(3);
    expect(score(tags('PENG_PENG_HU'))).toBe(4);
    expect(score(tags('QI_DUI'))).toBe(8);
  });

  it('结构型互斥，同时出现时取最高而不是相加', () => {
    expect(score(tags('PING_HU', 'PENG_PENG_HU'))).toBe(4);
    expect(score(tags('PING_HU', 'PENG_PENG_HU', 'QI_DUI'))).toBe(8);
  });

  it('七星十三烂两档：自摸 4 炮、其他 2 炮（2026-10-06 改规）', () => {
    expect(score(tags('QI_XING_SHI_SAN_LAN'), cfg, true)).toBe(4);
    expect(score(tags('QI_XING_SHI_SAN_LAN'), cfg, false)).toBe(2);
  });

  it('碰碰胡单调 8 炮，高于普通碰碰胡 4 炮；同时出现取最高的 8', () => {
    expect(score(tags('PENG_PENG_HU_DAN_DIAO'))).toBe(8);
    expect(score(tags('PENG_PENG_HU', 'PENG_PENG_HU_DAN_DIAO'))).toBe(8);
  });
});

describe('分层计分：一色型（加成）', () => {
  it('真胡的一色是加在结构分上的：平胡 1 + 清一色 10 = 11（Q-03 确认的真胡 11 分）', () => {
    expect(COLOR_BONUS.QING_YI_SE_ZHEN).toBe(10);
    expect(score(tags('PING_HU', 'QING_YI_SE_ZHEN'))).toBe(11);
  });

  it('字一色真：平胡 1 + 20 = 21（Q-04 确认的 21 分）', () => {
    expect(COLOR_BONUS.ZI_YI_SE_ZHEN).toBe(20);
    expect(score(tags('PING_HU', 'ZI_YI_SE_ZHEN'))).toBe(21);
  });

  it('假胡没有结构分，一色值就是全部：清一色假 4、字一色假 11（2026-10-06 改规，字一色假靠封顶落到 8）', () => {
    expect(score(tags('QING_YI_SE_JIA'))).toBe(4);
    expect(score(tags('ZI_YI_SE_JIA'))).toBe(11);
  });

  it('一色型之间互斥（清一色与字一色不可能同时成立），取最高', () => {
    expect(score(tags('PING_HU', 'QING_YI_SE_ZHEN', 'ZI_YI_SE_ZHEN'))).toBe(21);
  });
});

describe('分层计分：归一与事件（叠加）', () => {
  it('归一加成 四/八/十二 = 3/5/9', () => {
    expect(GUI_YI_BONUS).toEqual({ SI_GUI_YI: 3, BA_GUI_YI: 5, SHI_ER_GUI_YI: 9 });
    expect(score(tags('QI_DUI', 'SI_GUI_YI'))).toBe(8 + 3);
    expect(score(tags('QI_DUI', 'BA_GUI_YI'))).toBe(8 + 5);
    expect(score(tags('QI_DUI', 'SHI_ER_GUI_YI'))).toBe(8 + 9);
  });

  it('归一系列互斥，同时出现取最高', () => {
    expect(score(tags('QI_DUI', 'SI_GUI_YI', 'SHI_ER_GUI_YI'))).toBe(8 + 9);
  });

  it('杠上开花 +4 事件加成', () => {
    expect(score(tags('PING_HU', 'GANG_SHANG_KAI_HUA'))).toBe(1 + 4);
    expect(score(tags('PING_HU', 'QING_YI_SE_ZHEN', 'GANG_SHANG_KAI_HUA'))).toBe(1 + 10 + 4);
  });

  it('抢杠胡本身不加分（分数来自牌型）', () => {
    expect(score(tags('PING_HU', 'QIANG_GANG_HU'))).toBe(1);
  });

  it('多维叠加：七对 + 清一色真 + 四归一 = 8 + 10 + 3', () => {
    expect(score(tags('QI_DUI', 'QING_YI_SE_ZHEN', 'SI_GUI_YI'))).toBe(21);
  });

  it('多维叠加：碰碰胡 + 字一色真 = 4 + 20；再加十二归一 = 4 + 20 + 9', () => {
    expect(score(tags('PENG_PENG_HU', 'ZI_YI_SE_ZHEN'))).toBe(24);
    expect(score(tags('PENG_PENG_HU', 'ZI_YI_SE_ZHEN', 'SHI_ER_GUI_YI'))).toBe(33);
  });

  it('空标签集是 0 分（不该出现在正常流程里，但不许报错）', () => {
    expect(score(tags())).toBe(0);
  });
});

describe('例外覆盖表与自检', () => {
  it('override 优先于分层公式，键由 tagKey 生成', () => {
    const c: RuleConfig = {
      ...cfg,
      score: { ...cfg.score, override: { 'QI_DUI+QING_YI_SE_ZHEN': 99 } },
    };
    expect(score(tags('QI_DUI', 'QING_YI_SE_ZHEN'), c)).toBe(99);
    // 只覆盖命中的那一组，其它组合照走公式
    expect(score(tags('QI_DUI', 'ZI_YI_SE_ZHEN'), c)).toBe(8 + 20);
  });

  it('每个 FanTag 都在分层表里有定义（防止漏配导致静默低分）', () => {
    const defined = new Set<string>([
      ...Object.keys(STRUCTURE_SCORE),
      ...Object.keys(COLOR_BONUS),
      ...Object.keys(GUI_YI_BONUS),
      'QI_XING_SHI_SAN_LAN',
      'GANG_SHANG_KAI_HUA',
      'QIANG_GANG_HU',
      'ZI_MO',
    ]);
    for (const tag of ALL_FAN_TAGS) {
      expect(defined.has(tag), `标签 ${tag} 没有在计分表里定义`).toBe(true);
    }
  });

  it('未覆盖组合回落到分层公式，而不是取最大值兜底，unmapped 为空', () => {
    const r = scoreOfTags(tags('PENG_PENG_HU', 'SI_GUI_YI'), cfg);
    expect(r.score).toBe(4 + 3);
    expect(r.unmapped).toEqual([]);
  });

  it('cap 不在这一层做（封顶属于结算，Task 19）', () => {
    const capped: RuleConfig = { ...cfg, score: { ...cfg.score, cap: 5 } };
    expect(score(tags('ZI_YI_SE_ZHEN', 'PING_HU'), capped)).toBe(21);
  });
});
