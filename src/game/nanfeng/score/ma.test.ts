// 口径来自 nf-mahjong-backend/tests/nanfeng/test_ma.py（买码 / 码牌）
import { describe, it, expect } from 'vitest';
import {
  MA_COUNT_CHOICES,
  isMaCount,
  maPosition,
  maTargetSeat,
  maTargets,
} from './ma';
import { settleRound } from './settle';
import { startRound, type GameState, type RoundOutcome } from '../state/gameState';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from '../ruleConfig';
import { craftedRound, startBase } from '../testSupport/fixtures';
import { fullWall, type Tile } from '../tiles';

/** 带买码的配置（张数由用例指定）。 */
const maCfg = (count: number): RuleConfig => ({
  ...DEFAULT_RULE_CONFIG,
  buyCode: { count: count as RuleConfig['buyCode']['count'] },
});

/** 造一个"只关心码牌与杠分台账"的结算输入（四家杂牌，不下发任何碰/胡）。 */
const stateWithMa = (
  maTiles: readonly Tile[],
  opts: {
    dealer?: number;
    roundGangScore?: number[];
    roundGangFlows?: GameState['roundGangFlows'];
  } = {},
): GameState => ({
  ...craftedRound({
    turn: opts.dealer ?? 0,
    dealer: opts.dealer ?? 0,
    hands: [null, null, null, null],
  }),
  maTiles: [...maTiles],
  roundGangScore: opts.roundGangScore ?? [0, 0, 0, 0],
  roundGangFlows: opts.roundGangFlows ?? [],
});

const hu = (seat: number, zimo: boolean, loserSeat: number | null = null): RoundOutcome => ({
  kind: 'HU',
  winners: [{ seat, zimo, tags: ['PING_HU'] }],
  loserSeat,
});

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

describe('码牌指向（相对庄家、按点数）', () => {
  it('数牌取下个位，字牌取自己的点数', () => {
    expect(maPosition(11)).toBe(0); // 一万
    expect(maPosition(12)).toBe(1);
    expect(maPosition(13)).toBe(2);
    expect(maPosition(14)).toBe(3);
    expect(maPosition(15)).toBe(0); // 五万 → 绕回庄家
    expect(maPosition(19)).toBe(0); // 九万
    expect(maPosition(21)).toBe(0); // 一条
    expect(maPosition(33)).toBe(2); // 三筒
    expect(maPosition(39)).toBe(0); // 九筒（9 → 绕回庄家）
    expect(maPosition(41)).toBe(0); // 东
    expect(maPosition(42)).toBe(1); // 南
    expect(maPosition(43)).toBe(2); // 西
    expect(maPosition(44)).toBe(3); // 北
    expect(maPosition(51)).toBe(0); // 中
    expect(maPosition(52)).toBe(1); // 发
    expect(maPosition(53)).toBe(2); // 白
  });

  it('全副牌的方位都落在 0..3', () => {
    for (const tile of fullWall()) {
      const position = maPosition(tile);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(3);
    }
  });

  it('非法牌码直接抛错，不静默返回', () => {
    expect(() => maPosition(45 as Tile)).toThrow(/非法牌码/);
  });

  it('绝对座位 = 庄家 + 相对方位（绕一圈）', () => {
    expect(maTargetSeat(11, 0)).toBe(0);
    expect(maTargetSeat(11, 2)).toBe(2);
    expect(maTargetSeat(12, 3)).toBe(0); // 3 + 1 绕回 0
  });

  it('maTargets 按翻开顺序给出每个座位', () => {
    expect(maTargets([11, 12, 41, 44], 1)).toEqual([1, 2, 1, 0]);
  });

  it('张数只能是 0/1/2/4', () => {
    expect(MA_COUNT_CHOICES).toEqual([0, 1, 2, 4]);
    for (const ok of [0, 1, 2, 4]) expect(isMaCount(ok)).toBe(true);
    for (const bad of [3, 5, 8, -1]) expect(isMaCount(bad)).toBe(false);
  });
});

describe('开局预留码牌', () => {
  it('不买码时没有码牌，牌墙张数与常局一致', () => {
    const state = startRound(startBase({ cfg: maCfg(0) }));
    expect(state.maTiles).toEqual([]);
    expect(state.wall.length).toBe(83);
    expect(state.maScore).toBe(0);
  });

  it.each([1, 2, 4])('买 %i 张：码牌取自牌墙末尾，牌墙正好少这几张', (count) => {
    const state = startRound(startBase({ cfg: maCfg(count) }));
    expect(state.maTiles).toHaveLength(count);
    expect(state.wall.length).toBe(83 - count);

    // 同一个种子 ⇒ 同一副洗好的牌：买码那一局就是"常局牌墙的末尾 N 张被留出来"
    const plain = startRound(startBase({ cfg: maCfg(0) }));
    expect(state.maTiles).toEqual(plain.wall.slice(83 - count));
    expect(state.wall).toEqual(plain.wall.slice(0, 83 - count));
  });

  it('码牌不进任何人的手牌，也不在牌墙里（136 张仍然守恒）', () => {
    const state = startRound(startBase({ cfg: maCfg(4) }));
    const dealt: Tile[] = [];
    for (const hand of state.hands) {
      for (let tile = 0; tile < hand.concealed.length; tile++) {
        for (let k = 0; k < hand.concealed[tile]; k++) dealt.push(tile);
      }
      if (hand.drawnTile !== null) dealt.push(hand.drawnTile);
    }

    // 牌墙 + 手牌 + 码牌 = 整副牌：每种牌码恰好 4 张（多一张/少一张都会在这里露出来）
    const counts = new Map<Tile, number>();
    const addCount = (tile: Tile): void => {
      counts.set(tile, (counts.get(tile) ?? 0) + 1);
    };
    state.wall.forEach(addCount);
    state.maTiles.forEach(addCount);
    dealt.forEach(addCount);
    for (const [tile, n] of counts) expect(n, `牌码 ${tile}`).toBe(4);
    expect(dealt).toHaveLength(53);
    expect(state.wall).toHaveLength(83 - 4);
  });
});

describe('买码结算：复制被指向座位的每一笔现金流', () => {
  it('关掉买码时买码位净额为 0', () => {
    const r = settleRound(stateWithMa([]), hu(0, true), maCfg(1));
    expect(r.deltas).toEqual([3, -1, -1, -1]);
    expect(r.maDelta).toBe(0);
    expect(r.maDetail).toEqual([]);
    expect(sum(r.deltas) + r.maDelta).toBe(0);
  });

  it('码指赢家：自摸 1 炮时其余三家各付两份，买码位 +3', () => {
    // 11 = 一万 → 相对庄家 0；庄家设 0 → 指向座位 0（赢家）
    const r = settleRound(stateWithMa([11], { dealer: 0 }), hu(0, true), maCfg(1));
    expect(r.deltas).toEqual([3, -2, -2, -2]);
    expect(r.maDelta).toBe(3);
    expect(r.maDetail).toEqual([{ tile: 11, seat: 0, delta: 3 }]);
    expect(sum(r.deltas) + r.maDelta).toBe(0);
  });

  it('码指放炮者：点炮 1 炮时赢家收双份，买码位一起输', () => {
    // 12 → 相对 1 → 座位 1 = 放炮者：他付 1 给赢家，买码位也付 1 给赢家
    const r = settleRound(stateWithMa([12], { dealer: 0 }), hu(0, false, 1), maCfg(1));
    expect(r.deltas).toEqual([2, -1, 0, 0]);
    expect(r.maDelta).toBe(-1);
    expect(sum(r.deltas) + r.maDelta).toBe(0);
  });

  it('两张码牌指向同一家 → 叠加（跟着下两倍注）', () => {
    // 11 与 15 都指相对 0；庄家 0 → 都指座位 0（赢家）
    const r = settleRound(stateWithMa([11, 15], { dealer: 0 }), hu(0, true), maCfg(2));
    expect(r.deltas).toEqual([3, -3, -3, -3]);
    expect(r.maDelta).toBe(6);
    expect(r.maDetail.map((d) => d.delta)).toEqual([3, 3]);
    expect(sum(r.deltas) + r.maDelta).toBe(0);
  });

  it('四张码牌覆盖四家 → 买码位不赚不亏（正负相消）', () => {
    // 指 0/1/2/3 各一张：11(0) 12(1) 13(2) 14(3)，庄家 0
    const r = settleRound(stateWithMa([11, 12, 13, 14], { dealer: 0 }), hu(0, true), maCfg(4));
    expect(r.maDelta).toBe(0);
    // 买码位自己零和，但四家的收付被"每个座位都被下注"改变了：赢家多收、三家各多付一份
    expect(r.deltas).toEqual([6, -2, -2, -2]);
    expect(sum(r.deltas) + r.maDelta).toBe(0);
  });

  it('四张全压一家：跟着收四遍', () => {
    const r = settleRound(stateWithMa([11, 15, 19, 21], { dealer: 0 }), hu(0, true), maCfg(4));
    expect(r.maDelta).toBe(12);
    expect(r.deltas).toEqual([3, -5, -5, -5]);
    expect(sum(r.deltas) + r.maDelta).toBe(0);
  });

  it('明杠是不对称流水：买码按笔复制，付款方多付一份、收款方多收一份', () => {
    // 0 号位自摸（三家各付 1）；1 号位开明杠，这 2 分**只由 2 号位付**。
    const r = settleRound(
      stateWithMa([13], {
        dealer: 0,
        roundGangScore: [0, 2, -2, 0],
        roundGangFlows: [{ payer: 2, payee: 1, amount: 2 }],
      }),
      hu(0, true),
      maCfg(1),
    );
    // 13 → 相对 2 → 座位 2（付款方）：他多付 1 给赢家、多付 2 给杠家，买码位净 -3
    expect(r.maDelta).toBe(-3);
    expect(r.deltas).toEqual([4, 3, -3, -1]);
    expect(sum(r.deltas) + r.maDelta).toBe(0);
  });

  it('荒庄：庄家赔三家各 1；码指庄家 → 买码位也赔三家各 1', () => {
    const r = settleRound(stateWithMa([11], { dealer: 0 }), { kind: 'HUANG_ZHUANG' }, maCfg(1));
    // 三家各收两份（庄家一份 + 买码位一份），庄家与买码位各赔 3
    expect(r.deltas).toEqual([-3, 2, 2, 2]);
    expect(r.maDelta).toBe(-3);
    expect(sum(r.deltas) + r.maDelta).toBe(0);
  });

  it('码指输家：赢家因此多收一份，被指那家照旧付自己那份', () => {
    // 12 → 相对 1 → 座位 1（自摸时付 1 的输家）。买码位也付 1 给赢家。
    const r = settleRound(stateWithMa([12], { dealer: 0 }), hu(0, true), maCfg(1));
    expect(r.deltas).toEqual([4, -1, -1, -1]);
    expect(r.maDelta).toBe(-1);
    expect(sum(r.deltas) + r.maDelta).toBe(0);
  });

  it('没开买码时老路径不变（四家零和）', () => {
    const r = settleRound(stateWithMa([]), hu(2, false, 0), maCfg(0));
    expect(r.maDelta).toBe(0);
    expect(sum(r.deltas)).toBe(0);
  });
});
