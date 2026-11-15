// 移植自 nf-mahjong/tests/core/sim.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { chooseAction, runManyGames, runOneGame, runStats } from './sim/randomAgent';
import { DEFAULT_RULE_CONFIG } from './ruleConfig';
import { createRng } from './prng';
import { craftedRound } from './testSupport/fixtures';

/**
 * 无头 fuzz。这里是"规则引擎能不能自己跑起来"的总闸：
 * `applyAction` 每次变换前后都断言全局不变量（Task 17），所以"跑不崩"就等于"不变量恒成立"。
 */
describe('无头随机对局', () => {
  it('跑 120 局（每局 3 圈）零失败', () => {
    const r = runManyGames(120, DEFAULT_RULE_CONFIG, 3);
    expect(r.firstFailure).toBeNull();
    expect(r.failed).toBe(0);
    expect(r.games).toBe(120);
  }, 120_000);

  it('同一 seed 的两局完全一致（可重放）', () => {
    const a = runOneGame(7, DEFAULT_RULE_CONFIG);
    const b = runOneGame(7, DEFAULT_RULE_CONFIG);
    expect(a).toEqual(b);
    // 摘要里含分数与步数，所以这条断言真的在比"整局走向"，不只是比局数
    expect(a.digest).toMatch(/rounds=3 .*scores=/);
  });

  it('不同 seed 通常走出不同的局（随机性没有被压平）', () => {
    const digests = new Set([1, 2, 3, 4, 5].map((seed) => runOneGame(seed, DEFAULT_RULE_CONFIG).digest));
    expect(digests.size).toBeGreaterThan(1);
  });

  it('胡与荒庄都达到实质覆盖（加了孤张偏好后胡牌率应是两位数百分比）', () => {
    const s = runStats(200, DEFAULT_RULE_CONFIG, 1);
    expect(s.rounds).toBe(200);
    // 纯随机乱打时这里只有 ~1%（实测胡 1 / 荒庄 199）——那样"判胡 → 计分 → 结算"整条路几乎
    // 没被 fuzz 压到。加了"优先打孤张"之后实测约 30%。
    //
    // 2026-11 改规后平胡只能自摸，随机对局里最常见的就是平胡，点炮胡整条路变窄 ——
    // 实测从 ~60 掉到 24/200（12%）。阈值放到 12（6%）：仍然要求"胡到两位数百分比"，
    // 但不能再拿改规前的 40（20%）当基准，否则一改规则这条 fuzz 就红。
    expect(s.hu).toBeGreaterThan(12);
    expect(s.huangZhuang).toBeGreaterThan(40);
    expect(s.hu + s.huangZhuang).toBe(200);
  }, 120_000);

  it('每局都真的打到了结算（不会因为步数超限而被截断）', () => {
    // 步数超限会抛异常 → runManyGames 会把它计成失败；这条用例把"上限没被踩到"钉住
    const r = runManyGames(30, DEFAULT_RULE_CONFIG, 3);
    expect(r.firstFailure).toBeNull();
  }, 60_000);
});

/**
 * 出牌偏好：**优先打孤张**。
 *
 * 为什么必须有这条：纯随机出牌几乎不可能成牌 —— `npm run sim -- 80` 实测胡 1 / 荒庄 79。
 * 那样 fuzz 只压得实"荒庄"一条路，而判胡→计分→结算整条路径几乎没被覆盖。加了这条偏好之后，
 * 随机对局会保留对子与搭子，胡牌率抬到两位数百分比，Phase 4 才算真的"实用检查点"。
 */
describe('出牌偏好孤张', () => {
  /** 座位 1：四组面子 + 一张孤张 19，外加摸到 25（25 与手里的 23 是搭子，不算孤张）。 */
  const isolatedReady = () =>
    craftedRound({
      turn: 1,
      hands: [
        null,
        {
          concealed: [11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 41, 19],
          drawnTile: 25,
        },
        null,
        null,
      ],
    });

  it('手里只有一张孤张时，总打它（跨 30 个种子都成立）', () => {
    const s = isolatedReady();
    const picked = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const action = chooseAction(s, DEFAULT_RULE_CONFIG, createRng(seed), 1000);
      expect(action).not.toBeNull();
      expect(action!.type).toBe('DISCARD');
      picked.add(action!.tile as number);
    }
    expect([...picked]).toEqual([19]);
  });

  it('孤张不止一张时在其中随机挑（不是写死第一张）', () => {
    // 19 与 29 都是孤张（万子只剩 19；条子只有 21,22,23，29 距 23 有 6 格）
    const s = craftedRound({
      turn: 1,
      hands: [
        null,
        {
          concealed: [11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 41, 29],
          drawnTile: 19,
        },
        null,
        null,
      ],
    });
    const picked = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      picked.add(chooseAction(s, DEFAULT_RULE_CONFIG, createRng(seed), 1000)!.tile as number);
    }
    expect([...picked].sort((a, b) => a - b)).toEqual([19, 29]);
  });

  it('没有孤张时退回"手里任意一张"（不会无牌可打）', () => {
    const s = craftedRound({
      turn: 1,
      hands: [
        null,
        {
          concealed: [11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 41, 14],
          drawnTile: 15,
        },
        null,
        null,
      ],
    });
    const action = chooseAction(s, DEFAULT_RULE_CONFIG, createRng(3), 1000);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('DISCARD');
  });
});
