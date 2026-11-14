// 移植自 nf-mahjong/tests/core/state/lobby.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { DEFAULT_RULE_CONFIG } from '../ruleConfig';
import { startLobby } from './gameState';
import { assertInvariants } from './invariants';
import { WALL_SIZE } from '../tiles';

const cfg = DEFAULT_RULE_CONFIG;

/**
 * 大厅状态：**还没开局**的那一段时间。
 *
 * 为什么需要一个专门的构造函数：`startRound` 硬要求恰好 4 个座位（房主坐庄要能在座位表里定位到
 * 自己），而"等人到齐"这个阶段里座位表**本来就不满** —— 用它硬造会直接抛。而 `GameState.phase`
 * 里早就有 `'LOBBY'` 了（`LEGAL_ACTIONS.LOBBY = []`，所有动作被拒；`failMigration` 也用它表达
 * "本局作废"），所以大厅不需要新的状态机，只需要一个能装下 <4 个人的开局状态。
 */
describe('大厅状态', () => {
  it('人还没到齐也能建（这就是它存在的理由）', () => {
    for (const seats of [['a'], ['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
      const s = startLobby({ seats, hostId: 'a', cfg, epoch: 1 });
      expect(s.phase).toBe('LOBBY');
      expect(s.hands).toHaveLength(seats.length);
      expect(s.seats).toEqual(seats);
    }
  });

  it('**一副牌都没发出去**：136 张全在牌墙里，四家都是空的', () => {
    const s = startLobby({ seats: ['a', 'b'], hostId: 'a', cfg, epoch: 1 });
    expect(s.wall).toHaveLength(WALL_SIZE);
    expect(s.wallPos).toBe(0);
    expect(s.hands.every((h) => h.drawnTile === null && h.melds.length === 0)).toBe(true);
    expect(s.discards).toEqual([[], []]);
    expect(s.scores).toEqual([0, 0]);
  });

  it('通过全部不变量（守恒、逐牌上限、零和）', () => {
    const s = startLobby({ seats: ['a', 'b', 'c'], hostId: 'a', cfg, epoch: 1 });
    expect(() => assertInvariants(s, cfg)).not.toThrow();
  });

  it('还没有开局，所以局数是 0（面板靠它显示"第几局"）', () => {
    const s = startLobby({ seats: ['a', 'b'], hostId: 'a', cfg, epoch: 1 });
    expect(s.round).toBe(0);
    // 大厅里没有任何"上一局的结果"，所以结算面板与换座都无从谈起
    expect(s.lastSettle).toBeNull();
    expect(s.lastOutcome).toBeNull();
  });

  it('房主不在座位表里 → 直接抛，不静默给个错的 hostSeat', () => {
    expect(() => startLobby({ seats: ['b', 'c'], hostId: 'a', cfg, epoch: 1 })).toThrow(/房主/);
  });

  it('一个人都没有 → 也抛（没有房主就没有权威）', () => {
    expect(() => startLobby({ seats: [], hostId: 'a', cfg, epoch: 1 })).toThrow(/房主|座位/);
  });
});
