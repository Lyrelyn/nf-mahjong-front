// 移植自 nf-mahjong/tests/core/state/invariants.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { assertInvariants, effectiveHandSize, physicalHandSize } from './invariants';
import { applyAction } from './apply';
import { startRound, type GameState } from './gameState';
import { addMeld, addTile, createHand } from '../action/hand';
import { DEFAULT_RULE_CONFIG } from '../ruleConfig';
import { settleRound } from '../score/settle';
import {
  anGangReady,
  buGangReady,
  corruptState,
  mingGangReady,
  playToDiscard,
  startBase,
} from '../testSupport/fixtures';

const cfg = DEFAULT_RULE_CONFIG;

/** 深拷贝一份状态，方便"改坏它再看断言"。 */
const clone = (s: GameState): GameState => structuredClone(s);

describe('两个张数概念', () => {
  it('物理张数把杠算 4，结构张数把杠算 3 个位', () => {
    const hand = addMeld(addTile(createHand(), 11), { kind: 'AN_GANG', tile: 22, fromSeat: null });
    expect(physicalHandSize(hand)).toBe(5); // 1 张暗牌 + 4 张杠
    expect(effectiveHandSize(hand)).toBe(4); // 1 张暗牌 + 一副露（3 个位）
  });
});

describe('牌张守恒', () => {
  it('开局状态合法，不抛', () => {
    expect(() => assertInvariants(startRound(startBase()), cfg)).not.toThrow();
  });

  it('出牌、摸牌、碰、杠之后都仍然守恒', () => {
    const discarded = applyAction(
      playToDiscard(0),
      { type: 'DISCARD', seat: 0, tile: 11, reqId: 1 },
      cfg,
      1,
    ).state;
    expect(() => assertInvariants(discarded, cfg)).not.toThrow();

    const penged = applyAction(
      mingGangReady(11, 1, 0),
      { type: 'PENG', seat: 1, tile: 11, reqId: 1 },
      cfg,
      1,
    ).state;
    expect(() => assertInvariants(penged, cfg)).not.toThrow();

    for (const s of [anGangReady(1, 11), mingGangReady(11, 1, 0)]) {
      const kind = s.turn === 1 && s.hands[1].concealed[11] === 4 ? 'AN_GANG' : 'MING_GANG';
      const after = applyAction(s, { type: kind, seat: 1, tile: 11, reqId: 1 }, cfg, 1).state;
      expect(() => assertInvariants(after, cfg)).not.toThrow();
    }
  });

  it('牌张守恒：从牌墙抽走一张（谁也没拿到）→ 报错', () => {
    const broken = clone(startRound(startBase()));
    broken.wall = broken.wall.slice(1);
    expect(() => assertInvariants(broken, cfg)).toThrow(/牌张守恒/);
  });

  it('5 人局（买码 4 张）开局仍然守恒：预留的码牌算在 136 张里', () => {
    const withMa = startRound(startBase({ cfg: { ...cfg, buyCode: { count: 4 } } }));
    expect(() => assertInvariants(withMa, cfg)).not.toThrow();

    // 把一张码牌弄丢 → 守恒立刻破（说明它确实被计入了总数，而不是"牌墙少了 4 张没人管"）
    const broken = clone(withMa);
    broken.maTiles = broken.maTiles.slice(1);
    expect(() => assertInvariants(broken, cfg)).toThrow(/牌张守恒/);
  });

  it('往牌河凭空多塞一张会先被"超过 4 张"拦住（两条检查的顺序是有意的）', () => {
    const broken = clone(startRound(startBase()));
    broken.discards[0] = [11];
    expect(() => assertInvariants(broken, cfg)).toThrow(/超过 4 张/);
  });
});

describe('每种牌不得超过 4 张', () => {
  it('手里已经 4 张再添一张 → 超过 4 张报错', () => {
    const s = anGangReady(1, 11); // 座位 1 手里正好 4 张 11
    const broken = clone(s);
    broken.hands[1].concealed[11] += 1;
    expect(() => assertInvariants(broken, cfg)).toThrow(/超过 4 张/);
  });

  it('开局状态里每种牌恰好 4 张（分布正确）', () => {
    const s = startRound(startBase());
    const tally = new Map<number, number>();
    for (let i = s.wallPos; i < s.wall.length; i++) tally.set(s.wall[i], (tally.get(s.wall[i]) ?? 0) + 1);
    for (const hand of s.hands) {
      for (let t = 0; t < hand.concealed.length; t++) {
        if (hand.concealed[t]) tally.set(t, (tally.get(t) ?? 0) + hand.concealed[t]);
      }
      if (hand.drawnTile !== null) tally.set(hand.drawnTile, (tally.get(hand.drawnTile) ?? 0) + 1);
    }
    expect(tally.size).toBe(34);
    for (const [tile, n] of tally) expect(n, `牌码 ${tile}`).toBe(4);
  });
});

describe('手牌数符合阶段', () => {
  it('WAITING_PLAY：出牌那家 14 张、其余 13 张', () => {
    const s = startRound(startBase());
    expect(() => assertInvariants(s, cfg)).not.toThrow();

    // 把座位 2 的一张牌挪给座位 3：守恒仍然成立，只有手牌数不对
    const broken = clone(s);
    const moved = broken.hands[2].concealed.findIndex((n) => n > 0);
    broken.hands[2].concealed[moved] -= 1;
    broken.hands[3].concealed[moved] += 1;
    expect(() => assertInvariants(broken, cfg)).toThrow(/手牌数/);
  });

  it('CLAIM_WINDOW：四家都是 13 张（含抢杠窗口）', () => {
    expect(() => assertInvariants(mingGangReady(11, 1, 0), cfg)).not.toThrow();

    const buGang = applyAction(
      buGangReady(1, 11, 2),
      { type: 'BU_GANG', seat: 1, tile: 11, reqId: 1 },
      cfg,
      1,
    ).state;
    expect(buGang.phase).toBe('CLAIM_WINDOW');
    expect(() => assertInvariants(buGang, cfg)).not.toThrow();
  });

  it('杠后补一张仍然是 14 张（结构上），物理上则是 15 张', () => {
    const s = anGangReady(1, 11);
    const after = applyAction(s, { type: 'AN_GANG', seat: 1, tile: 11, reqId: 1 }, cfg, 1).state;
    expect(effectiveHandSize(after.hands[1])).toBe(14);
    expect(physicalHandSize(after.hands[1])).toBe(15);
    expect(() => assertInvariants(after, cfg)).not.toThrow();
  });

  it('把出牌那家的一张牌挪给别家 → 两家张数都不对', () => {
    const s = startRound(startBase());
    const broken = clone(s);
    const moved = broken.hands[broken.turn].concealed.findIndex((n) => n > 0);
    broken.hands[broken.turn].concealed[moved] -= 1;
    const other = (broken.turn + 1) % broken.hands.length;
    broken.hands[other].concealed[moved] += 1;
    expect(() => assertInvariants(broken, cfg)).toThrow(/手牌数/);
  });
});

describe('得分零和', () => {
  it('杠分入账后仍然零和', () => {
    const s = mingGangReady(11, 1, 0);
    const after = applyAction(s, { type: 'MING_GANG', seat: 1, tile: 11, reqId: 1 }, cfg, 1).state;
    expect(() => assertInvariants(after, cfg)).not.toThrow();
  });

  it('分数被人为改坏 → 得分不为零报错', () => {
    const broken = clone(startRound(startBase()));
    broken.roundGangScore[0] = 5;
    expect(() => assertInvariants(broken, cfg)).toThrow(/得分不为零/);
  });

  it('买码位也在零和里：五家合计必须为 0', () => {
    const base = startRound(startBase({ cfg: { ...cfg, buyCode: { count: 2 } } }));
    const settled = settleRound(
      base,
      {
        kind: 'HU',
        winners: [{ seat: base.dealer, zimo: true, tags: ['PING_HU'] }],
        loserSeat: null,
      },
      base.cfg,
    );
    // 模拟"结算刚落账"的那一刻：四家分与买码位净额同时进账
    const after: GameState = {
      ...base,
      scores: base.scores.map((value, seat) => value + settled.deltas[seat]),
      maScore: base.maScore + settled.maDelta,
      lastSettle: settled,
    };
    expect(() => assertInvariants(after, cfg)).not.toThrow();

    // 把买码位那份账改坏 → 五家不再零和
    const broken = clone(after);
    broken.maScore += 1;
    expect(() => assertInvariants(broken, cfg)).toThrow(/得分不为零/);
  });
});

describe('applyAction 前后各断言一次', () => {
  it('喂进来的坏状态在变换前就被挡住', () => {
    expect(() =>
      applyAction(corruptState(), { type: 'DISCARD', seat: 0, tile: 11, reqId: 1 }, cfg, 1),
    ).toThrow(/牌张守恒/);
  });

  it('合法状态照常跑完，不误报', () => {
    const { state } = applyAction(
      playToDiscard(0),
      { type: 'DISCARD', seat: 0, tile: 11, reqId: 1 },
      cfg,
      1,
    );
    expect(state.phase).toBe('WAITING_PLAY');
    expect(() => assertInvariants(state, cfg)).not.toThrow();
  });

  it('换成与牌局不同的 cfg 也不影响断言（四条检查都与配置无关）', () => {
    const s = startRound(startBase());
    const other = { ...cfg, score: { ...cfg.score, cap: 99 } };
    expect(() => assertInvariants(s, other)).not.toThrow();
  });
});
