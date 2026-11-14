// 移植自 nf-mahjong/tests/core/score/settle.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { settleRound } from './settle';
import { applyAction } from '../state/apply';
import { craftedRound, zimoReady, type CraftedRoundSpec } from '../testSupport/fixtures';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from '../ruleConfig';
import type { GameState, RoundOutcome } from '../state/gameState';
import type { FanTag } from '../fanTags';

const cfg = DEFAULT_RULE_CONFIG;
/** 显式关掉封顶，用来验证"封顶前"的分层公式。 */
const noCap: RuleConfig = { ...cfg, score: { ...cfg.score, cap: 0 } };

/** 造一个只关心"庄家 + 本局杠分台账"的结算输入。 */
const stateOf = (roundGangScore: number[] = [0, 0, 0, 0], dealer = 0): GameState => ({
  ...craftedRound({ turn: dealer, dealer, hands: [null, null, null, null] } as CraftedRoundSpec),
  roundGangScore,
});

const hu = (
  winners: { seat: number; zimo: boolean; tags: FanTag[]; gangShang?: boolean }[],
  loserSeat: number | null,
): RoundOutcome => ({ kind: 'HU', winners, loserSeat });

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

describe('自摸与点炮的单价（Q-01：自摸不翻倍）', () => {
  it('自摸：三家各付一份，单价与点炮相同', () => {
    const r = settleRound(stateOf(), hu([{ seat: 0, zimo: true, tags: ['PING_HU'] }], null), cfg);
    expect(r.deltas).toEqual([3, -1, -1, -1]);
    expect(sum(r.deltas)).toBe(0);
  });

  it('点炮：只有放炮者付，单价还是 1', () => {
    const r = settleRound(stateOf(), hu([{ seat: 0, zimo: false, tags: ['PING_HU'] }], 2), cfg);
    expect(r.deltas).toEqual([1, 0, -1, 0]);
  });

  it('七星十三烂点炮只有 2 炮（2026-10-06 改规；分档在结算里同样生效）', () => {
    const r = settleRound(
      stateOf(),
      hu([{ seat: 0, zimo: false, tags: ['QI_XING_SHI_SAN_LAN'] }], 1),
      cfg,
    );
    expect(r.deltas[0]).toBe(2);
  });

  it('七星十三烂自摸是 4 炮 → 三家各付 4', () => {
    const r = settleRound(
      stateOf(),
      hu([{ seat: 0, zimo: true, tags: ['QI_XING_SHI_SAN_LAN'] }], null),
      cfg,
    );
    expect(r.deltas[0]).toBe(12);
    expect(r.deltas.slice(1)).toEqual([-4, -4, -4]);
  });
});

describe('一炮多响（Q-05）', () => {
  it('放炮者分别付给每个赢家，零和仍成立', () => {
    const r = settleRound(
      stateOf(),
      hu(
        [
          { seat: 1, zimo: false, tags: ['PING_HU'] },
          { seat: 3, zimo: false, tags: ['QI_DUI'] },
        ],
        0,
      ),
      cfg,
    );
    expect(r.deltas).toEqual([-(1 + 8), 1, 0, 8]);
    expect(sum(r.deltas)).toBe(0);
  });

  it('三个赢家都算，detail 里逐家一条', () => {
    const r = settleRound(
      stateOf(),
      hu(
        [
          { seat: 1, zimo: false, tags: ['PING_HU'] },
          { seat: 2, zimo: false, tags: ['PING_HU'] },
          { seat: 3, zimo: false, tags: ['QI_DUI'] },
        ],
        0,
      ),
      cfg,
    );
    expect(r.deltas[0]).toBe(-(1 + 1 + 8));
    expect(r.detail.map((d) => d.seat)).toEqual([1, 2, 3]);
  });
});

describe('事件与牌型（分层公式的结算侧）', () => {
  it('杠上开花 +4 炮（叠加在牌型分上）', () => {
    const r = settleRound(
      stateOf(),
      hu([{ seat: 1, zimo: false, tags: ['PING_HU'], gangShang: true }], 0),
      cfg,
    );
    expect(r.deltas[1]).toBe(5);
    expect(r.deltas[0]).toBe(-5);
  });

  it('多维牌型（封顶前）：平胡 + 字一色真 + 十二归一 = 1 + 20 + 9 = 30', () => {
    const r = settleRound(
      stateOf(),
      hu([{ seat: 0, zimo: false, tags: ['PING_HU', 'ZI_YI_SE_ZHEN', 'SHI_ER_GUI_YI'] }], 1),
      noCap,
    );
    expect(r.deltas[0]).toBe(30);
  });

  it('庄家作为付款方不加倍（Q-04）', () => {
    const r = settleRound(
      stateOf([0, 0, 0, 0], 0),
      hu([{ seat: 1, zimo: true, tags: ['PING_HU'] }], null),
      cfg,
    );
    expect(r.deltas[0]).toBe(-1); // 与其它两家一样，没有加倍
  });
});

describe('封顶（2026-10-06：默认 8 炮，只有杠能突破）', () => {
  it('默认封顶 8：清一色真 / 字一色真假 / 七对加归一 全都被压到 8', () => {
    const cases: FanTag[][] = [
      ['PING_HU', 'QING_YI_SE_ZHEN'],
      ['PING_HU', 'ZI_YI_SE_ZHEN'],
      ['ZI_YI_SE_JIA'],
      ['PENG_PENG_HU_DAN_DIAO'],
      ['QI_DUI', 'SHI_ER_GUI_YI'],
    ];
    for (const tags of cases) {
      const r = settleRound(
        stateOf(),
        hu([{ seat: 0, zimo: true, tags: [...tags] }], null),
        cfg,
      );
      expect(r.deltas[0], tags.join('+')).toBe(24); // 三家 × 8
      expect(r.deltas.slice(1), tags.join('+')).toEqual([-8, -8, -8]);
    }
  });

  it('封顶线以内的牌型不受影响：清一色假 4、七星 2/4、碰碰胡 4、平胡 1', () => {
    const cases: [FanTag[], number][] = [
      [['QING_YI_SE_JIA'], 4],
      [['PENG_PENG_HU'], 4],
      [['SHI_SAN_LAN'], 3],
      [['PING_HU'], 1],
    ];
    for (const [tags, unit] of cases) {
      const r = settleRound(stateOf(), hu([{ seat: 0, zimo: false, tags }], 1), cfg);
      expect(r.deltas[0], tags.join('+')).toBe(unit);
    }
  });

  it('cap = 0 表示不封顶', () => {
    const r = settleRound(
      stateOf(),
      hu([{ seat: 0, zimo: false, tags: ['PING_HU', 'ZI_YI_SE_ZHEN', 'SHI_ER_GUI_YI'] }], 1),
      noCap,
    );
    expect(r.deltas[0]).toBe(30);
  });

  it('cap > 0 时单家实付不超过 cap', () => {
    const capped: RuleConfig = { ...cfg, score: { ...cfg.score, cap: 20 } };
    const r = settleRound(
      stateOf(),
      hu([{ seat: 0, zimo: false, tags: ['PING_HU', 'ZI_YI_SE_ZHEN', 'SHI_ER_GUI_YI'] }], 1),
      capped,
    );
    expect(r.deltas[0]).toBe(20);
    expect(r.deltas[1]).toBe(-20);
  });

  it('封顶只作用于单家实付，自摸仍是三家各付', () => {
    const capped: RuleConfig = { ...cfg, score: { ...cfg.score, cap: 5 } };
    const r = settleRound(
      stateOf(),
      hu([{ seat: 0, zimo: true, tags: ['QI_DUI'] }], null),
      capped,
    );
    expect(r.deltas).toEqual([15, -5, -5, -5]);
  });

  it('杠分在封顶之后并入 → 只有杠能突破封顶', () => {
    const r = settleRound(
      stateOf([0, 12, -4, -8], 1),
      hu([{ seat: 1, zimo: false, tags: ['PING_HU', 'ZI_YI_SE_ZHEN'] }], 0),
      cfg,
    );
    // 胡牌分封顶 8（座 1 +8、座 0 -8），杠分台账再并上去 → 座 1 净得 20，超过封顶线
    expect(r.deltas).toEqual([-8, 20, -4, -8]);
    expect(sum(r.deltas)).toBe(0);
  });
});

describe('本局杠分并入结算（Q-02）', () => {
  it('荒庄：庄家赔每家 1 分（共 3 分），已经开过的杠照常保留', () => {
    const r = settleRound(stateOf([2, -2, 0, 0], 0), { kind: 'HUANG_ZHUANG' }, cfg);
    expect(r.deltas).toEqual([-3 + 2, 1 - 2, 1, 1]);
    expect(sum(r.deltas)).toBe(0);
  });

  it('没有杠的荒庄：庄家 -3、其余各 +1', () => {
    const r = settleRound(stateOf(), { kind: 'HUANG_ZHUANG' }, cfg);
    expect(r.deltas).toEqual([-3, 1, 1, 1]);
  });

  it('荒庄时庄家不是座位 0 也照样由庄家赔', () => {
    const r = settleRound(stateOf([0, 0, 0, 0], 2), { kind: 'HUANG_ZHUANG' }, cfg);
    expect(r.deltas).toEqual([1, 1, -3, 1]);
  });

  it('胡牌时杠分同样并入（杠分独立于胡牌分）', () => {
    const r = settleRound(
      stateOf([-2, 6, -2, -2], 1),
      hu([{ seat: 1, zimo: true, tags: ['PING_HU'] }], null),
      cfg,
    );
    // 座位 1：+3（自摸）+6（暗杠）；其余：-1（付胡）-2（付杠）
    expect(r.deltas).toEqual([-3, 9, -3, -3]);
    expect(sum(r.deltas)).toBe(0);
  });
});

describe('零和是硬校验，不是静默修正', () => {
  it('台账本身就破坏零和时抛异常', () => {
    expect(() =>
      settleRound(
        stateOf([5, 0, 0, 0], 0),
        hu([{ seat: 0, zimo: false, tags: ['PING_HU'] }], 1),
        cfg,
      ),
    ).toThrow(/零和/);
  });

  it('每条路径都零和（自摸 / 点炮 / 多响 / 荒庄）', () => {
    const outcomes: RoundOutcome[] = [
      hu([{ seat: 0, zimo: true, tags: ['QI_DUI'] }], null),
      hu([{ seat: 2, zimo: false, tags: ['PENG_PENG_HU'] }], 3),
      hu(
        [
          { seat: 0, zimo: false, tags: ['PING_HU', 'QING_YI_SE_ZHEN'] },
          { seat: 2, zimo: false, tags: ['ZI_YI_SE_JIA'] },
        ],
        1,
      ),
      { kind: 'HUANG_ZHUANG' },
    ];
    for (const outcome of outcomes) {
      expect(sum(settleRound(stateOf([1, -1, 0, 0], 3), outcome, cfg).deltas)).toBe(0);
    }
  });
});

describe('与状态机的集成（apply.ts 在 SETTLING 时结算）', () => {
  it('自摸胡之后：累计分累加、本局杠分台账清零', () => {
    const s = zimoReady(1);
    const { state } = applyAction(s, { type: 'HU', seat: 1, tile: null, reqId: 1 }, cfg, 1);
    expect(state.phase).toBe('SETTLING');
    expect(state.scores).toEqual([-1, 3, -1, -1]);
    expect(state.roundGangScore).toEqual([0, 0, 0, 0]);
    expect(sum(state.scores)).toBe(0);
  });

  it('荒庄之后累计分同样落账', () => {
    const s = { ...stateOf([0, 0, 0, 0], 0), wall: [] };
    const r = settleRound(s, { kind: 'HUANG_ZHUANG' }, cfg);
    expect(sum(r.deltas)).toBe(0);
    expect(r.deltas[0]).toBe(-3);
  });
});
