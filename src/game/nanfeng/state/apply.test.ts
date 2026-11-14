// 移植自 nf-mahjong/tests/core/state/apply.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { createRng, shuffleWall } from '../prng';
import { handTileCount } from '../action/hand';
import { fullWall } from '../tiles';
import { DEFAULT_RULE_CONFIG } from '../ruleConfig';
import { LEGAL_ACTIONS } from './phase';
import { applyAction, type GameEvent } from './apply';
import { nextRoundSeating, startRound } from './gameState';
import {
  anGangReady,
  buGangReady,
  craftedRound,
  mingGangReady,
  playToDiscard,
  ronReady,
  startBase,
  withWallAlmostEmpty,
  zimoReady,
} from '../testSupport/fixtures';

const cfg = DEFAULT_RULE_CONFIG;
const huEventOf = (events: readonly GameEvent[]) =>
  events.find((e): e is Extract<GameEvent, { type: 'HU' }> => e.type === 'HU')!;

describe('洗牌与发牌', () => {
  it('相同种子产生相同牌墙（可重放），不同种子不同', () => {
    const a = shuffleWall(fullWall(), createRng(42));
    const b = shuffleWall(fullWall(), createRng(42));
    expect(a).toEqual(b);
    expect(shuffleWall(fullWall(), createRng(43))).not.toEqual(a);
    expect(a).toHaveLength(136);
    expect(new Set(a).size).toBe(34); // 万条筒各 9 + 风 4 + 箭 3
  });

  it('开局发牌：庄家 14 张，其余 13 张，牌墙剩余 83 张', () => {
    const s = startRound(startBase());
    expect(handTileCount(s.hands[0])).toBe(14);
    expect(handTileCount(s.hands[1])).toBe(13);
    expect(s.wall.length).toBe(136 - 53);
    expect(s.wallPos).toBe(0);
    expect(s.phase).toBe('WAITING_PLAY');
    expect(s.turn).toBe(0);
    expect(s.dealer).toBe(0);
    expect(s.roundGangScore).toEqual([0, 0, 0, 0]);
    expect(s.seq).toBe(0);
  });
});

describe('出牌与摸牌', () => {
  it('出牌 → 无人可响应 → 下家摸牌', () => {
    const s = playToDiscard(0);
    const { state } = applyAction(s, { type: 'DISCARD', seat: 0, tile: 11, reqId: 1 }, cfg, 1000);
    expect(state.phase).toBe('WAITING_PLAY');
    expect(state.turn).toBe(1);
    expect(state.claim).toBeNull();
    expect(state.discards[0]).toEqual([11]);
    expect(state.hands[0].drawnTile).toBeNull();
    expect(state.hands[1].drawnTile).not.toBeNull();
  });

  it('seq 每次客户端动作 +1，actionLog 按发生顺序追加（摸牌是同一 seq 的后续）', () => {
    const s = playToDiscard(0);
    const seq0 = s.seq;
    const { state } = applyAction(s, { type: 'DISCARD', seat: 0, tile: 11, reqId: 1 }, cfg, 1);
    expect(state.seq).toBe(seq0 + 1);
    expect(state.actionLog.map((e) => e.type)).toEqual(['DISCARD', 'DRAW']);
    expect(state.actionLog[0].seq).toBe(seq0 + 1);
    expect(state.actionLog[1].seq).toBe(seq0 + 1);
  });

  it('摸空牌墙 → 荒庄，绝不死循环（Review Focus #1）', () => {
    const s = withWallAlmostEmpty(playToDiscard(0));
    const { state, events } = applyAction(s, { type: 'DISCARD', seat: 0, tile: 11, reqId: 1 }, cfg, 1000);
    expect(state.phase).toBe('SETTLING');
    expect(events.some((e) => e.type === 'HUANG_ZHUANG')).toBe(true);
  });

  it('拒绝非法动作且不改状态', () => {
    const s = startRound(startBase());
    const before = structuredClone(s);
    expect(() => applyAction(s, { type: 'DISCARD', seat: 1, tile: 11, reqId: 1 }, cfg, 1)).toThrow(
      /不是你的回合/,
    );
    expect(() => applyAction(s, { type: 'PENG', seat: 1, tile: 11, reqId: 1 }, cfg, 1)).toThrow();
    expect(s).toEqual(before);
  });

  it('打出手里没有的牌要报错', () => {
    const s = playToDiscard(0);
    expect(() => applyAction(s, { type: 'DISCARD', seat: 0, tile: 19, reqId: 1 }, cfg, 1)).toThrow(
      /没有/,
    );
  });
});

describe('合法动作表', () => {
  it('按阶段给答案：WAITING_PLAY 能出牌/暗杠/补杠/自摸，CLAIM_WINDOW 能碰杠胡过', () => {
    expect(LEGAL_ACTIONS.WAITING_PLAY).toContain('DISCARD');
    expect(LEGAL_ACTIONS.WAITING_PLAY).toContain('AN_GANG');
    expect(LEGAL_ACTIONS.WAITING_PLAY).toContain('BU_GANG');
    expect(LEGAL_ACTIONS.WAITING_PLAY).not.toContain('PENG');
    expect(LEGAL_ACTIONS.CLAIM_WINDOW).toEqual(['PENG', 'MING_GANG', 'HU', 'PASS']);
    expect(LEGAL_ACTIONS.SETTLING).toEqual([]);
    expect(LEGAL_ACTIONS.ENDED).toEqual([]);
  });
});

describe('鸣牌窗口：碰与明杠', () => {
  it('碰：副露 3 张、牌河里的那张被拿走、出牌权转到碰的人', () => {
    const s = mingGangReady(11, 1, 0);
    expect(s.phase).toBe('CLAIM_WINDOW');
    expect(s.claim!.pending).toEqual([1]);

    const { state } = applyAction(s, { type: 'PENG', seat: 1, tile: 11, reqId: 1 }, cfg, 1);
    expect(state.phase).toBe('WAITING_PLAY');
    expect(state.turn).toBe(1);
    expect(state.claim).toBeNull();
    expect(state.hands[1].melds).toEqual([{ kind: 'PENG', tile: 11, fromSeat: 0 }]);
    expect(state.hands[1].justPeng).toBe(true);
    expect(state.discards[0]).toEqual([]);
    expect(state.lastDiscard).toBeNull();
  });

  it('明杠后补一张，杠上开花标记生效', () => {
    const s = mingGangReady(11, 1, 0);
    const { state } = applyAction(s, { type: 'MING_GANG', seat: 1, tile: 11, reqId: 1 }, cfg, 1);
    expect(state.phase).toBe('WAITING_PLAY');
    expect(state.turn).toBe(1);
    expect(state.hands[1].drawnTile).not.toBeNull();
    expect(state.drawnFromGang).toBe(true);
    expect(state.hands[1].melds[0].kind).toBe('MING_GANG');
  });

  it('窗口内不能被提供没提供的操作（手里没有 11 就不能碰）', () => {
    const s = ronReady(11, [1], 0);
    expect(() => applyAction(s, { type: 'PENG', seat: 1, tile: 11, reqId: 1 }, cfg, 1)).toThrow(
      /不能执行/,
    );
    expect(() => applyAction(s, { type: 'DISCARD', seat: 1, tile: 12, reqId: 1 }, cfg, 1)).toThrow();
  });

  it('全员不要 → 出牌留在牌河，下家摸牌', () => {
    const s = mingGangReady(11, 1, 0);
    const { state } = applyAction(s, { type: 'PASS', seat: 1, tile: null, reqId: 1 }, cfg, 1);
    expect(state.phase).toBe('WAITING_PLAY');
    expect(state.turn).toBe(1);
    expect(state.discards[0]).toEqual([11]);
  });
});

describe('胡牌（胜负与事件）', () => {
  it('自摸：进 SETTLING，事件 zimo=true', () => {
    const s = zimoReady(1);
    const { state, events } = applyAction(s, { type: 'HU', seat: 1, tile: null, reqId: 1 }, cfg, 1);
    expect(state.phase).toBe('SETTLING');
    const hu = huEventOf(events);
    expect(hu.winners).toHaveLength(1);
    expect(hu.winners[0]).toMatchObject({ seat: 1, zimo: true, gangShang: false });
    expect(hu.loserSeat).toBeNull();
    expect(hu.winners[0].tags).toContain('PING_HU');
  });

  it('点炮：胡的那家进 SETTLING，事件带放炮者', () => {
    const s = ronReady(11, [1], 0);
    const { state, events } = applyAction(s, { type: 'HU', seat: 1, tile: 11, reqId: 1 }, cfg, 1);
    expect(state.phase).toBe('SETTLING');
    const hu = huEventOf(events);
    expect(hu.winners.map((w) => w.seat)).toEqual([1]);
    expect(hu.winners[0]).toMatchObject({ zimo: false, qiangGang: false });
    expect(hu.loserSeat).toBe(0);
  });

  it('一炮多响：两家同时胡都算，按距离升序（Q-05）', () => {
    const s = ronReady(11, [1, 2], 0);
    expect(s.claim!.pending).toEqual([1, 2]);

    const opened = applyAction(s, { type: 'HU', seat: 2, tile: 11, reqId: 1 }, cfg, 1).state;
    expect(opened.phase).toBe('CLAIM_WINDOW'); // 还有一家没响应

    const { state, events } = applyAction(opened, { type: 'HU', seat: 1, tile: 11, reqId: 2 }, cfg, 2);
    expect(state.phase).toBe('SETTLING');
    const hu = huEventOf(events);
    expect(hu.winners.map((w) => w.seat)).toEqual([1, 2]);
  });
});

describe('杠分即时入账（Q-02）', () => {
  it('暗杠：开杠者 +6，其余三家各 -2，自身零和', () => {
    const s = anGangReady(1, 11);
    const { state } = applyAction(s, { type: 'AN_GANG', seat: 1, tile: 11, reqId: 1 }, cfg, 1);
    expect(state.roundGangScore[1]).toBe(6);
    expect(state.roundGangScore[0]).toBe(-2);
    expect(state.roundGangScore[2]).toBe(-2);
    expect(state.roundGangScore[3]).toBe(-2);
    expect(state.roundGangScore.reduce((a, b) => a + b, 0)).toBe(0);
    expect(state.hands[1].melds[0]).toEqual({ kind: 'AN_GANG', tile: 11, fromSeat: null });
    expect(state.drawnFromGang).toBe(true);
  });

  it('直杠：只由点杠者单付 2，其余两家不扣', () => {
    const s = mingGangReady(11, 1, 0);
    const { state } = applyAction(s, { type: 'MING_GANG', seat: 1, tile: 11, reqId: 1 }, cfg, 1);
    expect(state.roundGangScore).toEqual([-2, 2, 0, 0]);
    expect(state.discards[0]).toEqual([]); // 这张牌进了副露，不再算牌河
  });

  it('补杠：+3 必须等抢杠窗口关闭才入账', () => {
    const s = buGangReady(1, 11, 2); // 座位 2 能抢杠
    const { state } = applyAction(s, { type: 'BU_GANG', seat: 1, tile: 11, reqId: 1 }, cfg, 1);
    expect(state.phase).toBe('CLAIM_WINDOW');
    expect(state.claim!.gangSeat).toBe(1);
    expect(state.roundGangScore[1]).toBe(0); // 尚未入账
    expect(state.hands[1].melds[0].kind).toBe('BU_GANG');

    const passed = applyAction(state, { type: 'PASS', seat: 2, tile: null, reqId: 2 }, cfg, 2).state;
    expect(passed.phase).toBe('WAITING_PLAY');
    expect(passed.turn).toBe(1);
    expect(passed.roundGangScore).toEqual([-1, 3, -1, -1]);
    // 补杠也要补一张：杠吃掉一张手牌，不补就少一张
    expect(passed.hands[1].drawnTile).not.toBeNull();
    expect(passed.drawnFromGang).toBe(true);
  });

  it('没人能抢杠时补杠立即入账，并补一张', () => {
    const s = buGangReady(1, 11, null);
    const { state } = applyAction(s, { type: 'BU_GANG', seat: 1, tile: 11, reqId: 1 }, cfg, 1);
    expect(state.phase).toBe('WAITING_PLAY');
    expect(state.turn).toBe(1);
    expect(state.roundGangScore).toEqual([-1, 3, -1, -1]);
    expect(state.hands[1].drawnTile).not.toBeNull();
    expect(state.drawnFromGang).toBe(true);
  });

  it('补杠被抢 → 本次一分不计，出抢杠胡事件', () => {
    const s = buGangReady(1, 11, 2);
    const opened = applyAction(s, { type: 'BU_GANG', seat: 1, tile: 11, reqId: 1 }, cfg, 1).state;
    const { state, events } = applyAction(opened, { type: 'HU', seat: 2, tile: 11, reqId: 2 }, cfg, 2);

    expect(state.phase).toBe('SETTLING');
    expect(state.roundGangScore[1]).toBe(0); // 被抢 → 不计
    const event = events.find((e): e is Extract<GameEvent, { type: 'QIANG_GANG_HU' }> => e.type === 'QIANG_GANG_HU')!;
    expect(event.gangSeat).toBe(1);
    expect(event.winners.map((w) => w.seat)).toEqual([2]);
    expect(event.winners[0].tags).toContain('QIANG_GANG_HU');
  });

  it('不能补杠没碰过的牌，也不能越权暗杠', () => {
    const s = anGangReady(1, 11);
    expect(() => applyAction(s, { type: 'AN_GANG', seat: 2, tile: 11, reqId: 1 }, cfg, 1)).toThrow();
    expect(() => applyAction(s, { type: 'BU_GANG', seat: 1, tile: 11, reqId: 1 }, cfg, 1)).toThrow(
      /不能补杠/,
    );
  });
});

describe('每局换座（R-02 五人轮换）', () => {
  it('庄家胡 → 连庄、对家下场；点炮胡 → 胡牌者坐庄、放炮者下场；流局 → 对家坐庄、庄家下场', () => {
    const s = startRound({ ...startBase(), dealer: 1 });

    expect(
      nextRoundSeating(s, { kind: 'HU', winners: [{ seat: 1, zimo: true }], loserSeat: null }),
    ).toEqual({ dealer: 1, sittingOut: 3 });
    expect(
      nextRoundSeating(s, { kind: 'HU', winners: [{ seat: 2, zimo: false }], loserSeat: 0 }),
    ).toEqual({ dealer: 2, sittingOut: 0 });
    expect(nextRoundSeating(s, { kind: 'HUANG_ZHUANG' })).toEqual({ dealer: 3, sittingOut: 1 });
  });

  it('庄家被点炮胡时不再连庄，改由胡牌者坐庄', () => {
    const s = startRound({ ...startBase(), dealer: 1 });
    expect(
      nextRoundSeating(s, { kind: 'HU', winners: [{ seat: 3, zimo: false }], loserSeat: 1 }),
    ).toEqual({ dealer: 3, sittingOut: 1 });
  });

  it('多家同时胡时取距放炮者最近的那家坐庄', () => {
    const s = startRound({ ...startBase(), dealer: 3 });
    expect(
      nextRoundSeating(s, {
        kind: 'HU',
        winners: [
          { seat: 1, zimo: false },
          { seat: 2, zimo: false },
        ],
        loserSeat: 0,
      }).dealer,
    ).toBe(1);
  });

  it('非庄家自摸：胡牌者坐庄，自摸者的对家下场（R-02 的表漏掉的第三种情形）', () => {
    const s = startRound({ ...startBase(), dealer: 0 });
    // 座位 1 自摸 → 1 坐庄、1 的对家 3 下场
    expect(
      nextRoundSeating(s, { kind: 'HU', winners: [{ seat: 1, zimo: true }], loserSeat: null }),
    ).toEqual({ dealer: 1, sittingOut: 3 });
    // 座位 2 自摸 → 2 坐庄、对家 0（原来的庄家）下场
    expect(
      nextRoundSeating(s, { kind: 'HU', winners: [{ seat: 2, zimo: true }], loserSeat: null }),
    ).toEqual({ dealer: 2, sittingOut: 0 });
  });

  it('点炮胡但没给放炮者 → 报错，不静默取默认值', () => {
    const s = startRound({ ...startBase(), dealer: 1 });
    expect(() =>
      nextRoundSeating(s, { kind: 'HU', winners: [{ seat: 2, zimo: false }], loserSeat: null }),
    ).toThrow(/放炮/);
  });
});

describe('碰碰胡单调：标签由"胡的是哪张"决定（2026-10-06 改规）', () => {
  const settleOf = (events: readonly GameEvent[]) =>
    events.find((e): e is Extract<GameEvent, { type: 'SETTLE' }> => e.type === 'SETTLE')!;

  it('自摸单钓将 → 打 PENG_PENG_HU_DAN_DIAO，8 炮（正好等于封顶）', () => {
    // 来牌前 111 222 333 444 + 5，胡 5 是把将配成对
    const state = craftedRound({
      hands: [
        { concealed: [11, 11, 11, 21, 21, 21, 31, 31, 31, 41, 41, 41, 51], drawnTile: 51 },
        null,
        null,
        null,
      ],
      turn: 0,
      dealer: 0,
    });
    const { events } = applyAction(
      state,
      { type: 'HU', seat: 0, tile: null, reqId: 1 },
      cfg,
      1,
    );
    expect(huEventOf(events).winners[0].tags).toContain('PENG_PENG_HU_DAN_DIAO');
    expect(settleOf(events).deltas).toEqual([24, -8, -8, -8]);
  });

  it('对倒胡出同一个 14 张形 → 只有普通碰碰胡，4 炮', () => {
    // 来牌前 111 222 333 44 55，胡 4 是等对倒。成牌形与上一例完全相同，只有来牌不同。
    const state = craftedRound({
      hands: [
        { concealed: [11, 11, 11, 21, 21, 21, 31, 31, 31, 41, 41, 51, 51], drawnTile: 41 },
        null,
        null,
        null,
      ],
      turn: 0,
      dealer: 0,
    });
    const { events } = applyAction(
      state,
      { type: 'HU', seat: 0, tile: null, reqId: 1 },
      cfg,
      1,
    );
    const tags = huEventOf(events).winners[0].tags;
    expect(tags).toContain('PENG_PENG_HU');
    expect(tags).not.toContain('PENG_PENG_HU_DAN_DIAO');
    expect(settleOf(events).deltas).toEqual([12, -4, -4, -4]);
  });

  it('点炮单钓同样打标签（不是只有自摸才算）', () => {
    const state = craftedRound({
      hands: [
        // 座 0 手里 13 张杂牌 + 刚摸到的 51，打出去给座 1 胡
        {
          concealed: [12, 13, 14, 15, 16, 17, 18, 19, 22, 23, 24, 25, 26],
          drawnTile: 51,
        },
        // 来牌前 111 222 333 444 + 5
        { concealed: [11, 11, 11, 21, 21, 21, 31, 31, 31, 41, 41, 41, 51] },
        // 另外两家给"看起来像听牌、其实胡不了 51"的杂牌，且完全不与上面两家撞牌
        { concealed: [32, 32, 32, 33, 33, 33, 34, 34, 34, 42, 42, 42, 43] },
        { concealed: [35, 35, 35, 36, 36, 36, 37, 37, 37, 44, 44, 44, 53] },
      ],
      turn: 0,
      dealer: 0,
    });
    const discarded = applyAction(
      state,
      { type: 'DISCARD', seat: 0, tile: 51, reqId: 1 },
      cfg,
      1,
    ).state;
    const { events } = applyAction(
      discarded,
      { type: 'HU', seat: 1, tile: 51, reqId: 2 },
      cfg,
      2,
    );
    const winner = huEventOf(events).winners[0];
    expect(winner.seat).toBe(1);
    expect(winner.zimo).toBe(false);
    expect(winner.tags).toContain('PENG_PENG_HU_DAN_DIAO');
    expect(settleOf(events).deltas).toEqual([-8, 8, 0, 0]);
  });
});

/**
 * Task 34：结算面板要显示"各家输赢 + 番型明细"，而这两样原本只出现在 `SETTLE` **事件**里，
 * 而 `HostSession` 只取 `applyAction(...).state`、把 events 整个丢掉 —— 于是明细算完就没了。
 * 所以它必须落进状态，而且必须落在 `GameState`（不是 host 的字段）：房主迁移要用**公开信息**
 * 重建状态，只活在 host 内存里的东西一换房主就丢了。
 */
describe('单局结算落进状态（结算面板的数据来源）', () => {
  const settleOf = (events: readonly GameEvent[]) =>
    events.find((e): e is Extract<GameEvent, { type: 'SETTLE' }> => e.type === 'SETTLE')!;
  const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

  it('开局没有结算', () => {
    expect(startRound(startBase()).lastSettle).toBeNull();
    expect(startRound(startBase()).lastOutcome).toBeNull();
  });

  it('自摸胡：lastSettle 与 SETTLE 事件一致，deltas 零和，detail 带得出番型', () => {
    const { state, events } = applyAction(
      zimoReady(1),
      { type: 'HU', seat: 1, tile: null, reqId: 1 },
      cfg,
      1,
    );
    const settle = settleOf(events);

    expect(state.lastSettle).not.toBeNull();
    expect(state.lastSettle?.deltas).toEqual(settle.deltas);
    expect(state.lastSettle?.detail).toEqual(settle.detail);
    expect(sum(state.lastSettle?.deltas ?? [])).toBe(0);

    const line = state.lastSettle?.detail[0];
    expect(line?.seat).toBe(1);
    expect(line?.zimo).toBe(true);
    expect(line?.tags).toContain('PING_HU');
    expect(line?.income).toBe(line!.unit * 3); // 自摸：三家各付一份
  });

  it('荒庄也落进状态，且 detail 为空（面板要能显示"庄家赔三家"这种没有番型的局）', () => {
    const s = withWallAlmostEmpty(playToDiscard(0));
    const { state, events } = applyAction(
      s,
      { type: 'DISCARD', seat: 0, tile: 11, reqId: 1 },
      cfg,
      1000,
    );
    const settle = settleOf(events);

    expect(state.phase).toBe('SETTLING');
    expect(state.lastSettle).not.toBeNull();
    expect(state.lastSettle?.deltas).toEqual(settle.deltas);
    expect(state.lastSettle?.detail).toEqual([]);
    expect(sum(state.lastSettle?.deltas ?? [])).toBe(0);
    expect(state.lastOutcome).toEqual({ kind: 'HUANG_ZHUANG' });
  });

  /**
   * 胜负结果与账目**都要**留下，因为它们是两件事：`lastSettle` 是账（谁进多少分），
   * `lastOutcome` 是因（谁赢、自摸还是点炮、谁放的炮）。下一局谁坐庄、谁下场
   * （`nextRoundSeating`）要的是后者，而"放炮的是谁"在 `FanDetail` 里**根本没有** ——
   * 光看账推不出来。
   */
  it('点炮胡：结果里带着放炮者（账目里没有这个信息）', () => {
    const { state } = applyAction(
      ronReady(11, [1], 0),
      { type: 'HU', seat: 1, tile: 11, reqId: 1 },
      cfg,
      1,
    );
    const outcome = state.lastOutcome;
    expect(outcome?.kind).toBe('HU');
    if (outcome?.kind !== 'HU') throw new Error('夹具：这一局应该是胡牌');
    expect(outcome.loserSeat).toBe(0);
    expect(outcome.winners.map((w) => w.seat)).toEqual([1]);
    expect(outcome.winners[0].zimo).toBe(false);
    // 账目那一侧确实没有放炮者这个字段
    expect(Object.keys(state.lastSettle ?? {}).sort()).toEqual([
      'deltas',
      'detail',
      'maDelta',
      'maDetail',
    ]);
  });

  it('胜负结果是一份**拷贝**：改它不会改到事件里那份', () => {
    const { state, events } = applyAction(
      ronReady(11, [1], 0),
      { type: 'HU', seat: 1, tile: 11, reqId: 1 },
      cfg,
      1,
    );
    const fromEvent = huEventOf(events);
    const outcome = state.lastOutcome;
    if (outcome?.kind !== 'HU') throw new Error('夹具：这一局应该是胡牌');

    expect(outcome.winners).not.toBe(fromEvent.winners);
    // 推一个**这一手本来没有**的标签，然后看事件那一份有没有跟着变。
    // （不能用"推一个已经有的标签"来验：那样不论拷没拷，事件里的数组看起来都一样。）
    expect(fromEvent.winners[0].tags).not.toContain('PENG_PENG_HU');
    outcome.winners[0].tags?.push('PENG_PENG_HU');
    expect(fromEvent.winners[0].tags).not.toContain('PENG_PENG_HU');
  });
});
