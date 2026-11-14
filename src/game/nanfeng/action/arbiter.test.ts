// 移植自 nf-mahjong/tests/core/action/arbiter.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { arbitrate } from './arbiter';
import type { ActionType } from './options';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from '../ruleConfig';

const cfg = DEFAULT_RULE_CONFIG;

/** 造响应表（显式标注类型，否则 TS 会把字面量放宽成 string）。 */
const resp = (...pairs: [number, ActionType][]): Map<number, ActionType> => new Map(pairs);

const noMulti: RuleConfig = { ...cfg, claim: { ...cfg.claim, allowMultipleHu: false } };

describe('仲裁优先级（对应 Review Focus #2）', () => {
  it('胡 > 杠 > 碰，且胡通吃（有人胡时碰/杠全部作废）', () => {
    const r = arbitrate(0, resp([1, 'PENG'], [2, 'MING_GANG'], [3, 'HU']), cfg);
    expect(r.winners).toEqual([{ seat: 3, type: 'HU' }]);
    expect([...r.others].sort()).toEqual([1, 2]);
  });

  it('明杠压过碰', () => {
    const r = arbitrate(0, resp([1, 'PENG'], [3, 'MING_GANG']), cfg);
    expect(r.winners).toEqual([{ seat: 3, type: 'MING_GANG' }]);
    expect(r.others).toEqual([1]);
  });

  it('同级取距出牌者最近者（碰/杠只出一个赢家）', () => {
    expect(arbitrate(0, resp([3, 'PENG'], [1, 'PENG']), cfg).winners).toEqual([
      { seat: 1, type: 'PENG' },
    ]);
    // 3→1 距离 2，3→2 距离 3
    expect(arbitrate(3, resp([1, 'PENG'], [2, 'PENG']), cfg).winners).toEqual([
      { seat: 1, type: 'PENG' },
    ]);
  });

  it('全员 PASS → 无赢家', () => {
    expect(arbitrate(0, resp([1, 'PASS'], [2, 'PASS']), cfg).winners).toEqual([]);
  });

  it('PASS 的响应者不进 others（没有碰/杠需要作废）', () => {
    const r = arbitrate(0, resp([1, 'PENG'], [2, 'PASS']), cfg);
    expect(r.winners).toEqual([{ seat: 1, type: 'PENG' }]);
    expect(r.others).toEqual([]);
  });

  it('只影响窗口内已响应的玩家，未响应者不算 PASS 也不参与', () => {
    expect(arbitrate(0, resp([1, 'PENG']), cfg).winners).toEqual([{ seat: 1, type: 'PENG' }]);
  });

  it('同一输入重复调用结果一致（确定性）', () => {
    const rs = resp([1, 'PENG'], [2, 'PENG']);
    expect(arbitrate(0, rs, cfg)).toEqual(arbitrate(0, rs, cfg));
  });
});

describe('一炮多响（Q-05）', () => {
  it('多家同时胡都算，全部进 winners，且按距离升序（顺序固定）', () => {
    const r = arbitrate(0, resp([2, 'HU'], [1, 'HU']), cfg);
    expect(r.winners).toEqual([
      { seat: 1, type: 'HU' },
      { seat: 2, type: 'HU' },
    ]);
    expect(r.others).toEqual([]);
  });

  it('三家同时胡也全部算', () => {
    const r = arbitrate(0, resp([1, 'HU'], [2, 'HU'], [3, 'HU']), cfg);
    expect(r.winners.map((w) => w.seat)).toEqual([1, 2, 3]);
  });

  it('多家胡时不相干的碰/杠全部作废并进 others', () => {
    const r = arbitrate(0, resp([1, 'HU'], [2, 'HU'], [3, 'PENG']), cfg);
    expect(r.winners).toEqual([
      { seat: 1, type: 'HU' },
      { seat: 2, type: 'HU' },
    ]);
    expect(r.others).toEqual([3]);
  });

  it('单家胡时 others 里的另一家胡（被通吃）也要报出来', () => {
    const r = arbitrate(0, resp([1, 'HU'], [3, 'HU']), cfg);
    expect(r.winners.map((w) => w.seat)).toEqual([1, 3]);
  });

  it('关掉 allowMultipleHu 时退回"只取最近一家"（开关保留）', () => {
    const r = arbitrate(0, resp([1, 'HU'], [2, 'HU']), noMulti);
    expect(r.winners).toEqual([{ seat: 1, type: 'HU' }]);
    expect(r.others).toEqual([2]);
  });
});

describe('防御性输入', () => {
  it('窗口外动作（暗杠/补杠/出牌）不会被当成赢家', () => {
    const r = arbitrate(0, resp([1, 'AN_GANG'], [2, 'PENG']), cfg);
    expect(r.winners).toEqual([{ seat: 2, type: 'PENG' }]);
    expect(r.others).toEqual([1]);
  });

  it('只有窗口外动作时无赢家', () => {
    const r = arbitrate(0, resp([1, 'BU_GANG']), cfg);
    expect(r.winners).toEqual([]);
    expect(r.others).toEqual([1]);
  });

  it('空响应表 → 无赢家、无 others', () => {
    expect(arbitrate(0, resp(), cfg)).toEqual({ winners: [], others: [] });
  });
});
