// 移植自 nf-mahjong/tests/core/action/options.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { ACTION_PRIORITY, collectOptions, ownTurnOptions } from './options';
import { createHand, type HandState } from './hand';
import { DEFAULT_RULE_CONFIG } from '../ruleConfig';
import {
  canHuHand,
  canPengGangHand,
  canPengHand,
  handOf,
  zimoReady,
} from '../testSupport/fixtures';

const cfg = DEFAULT_RULE_CONFIG;

describe('可操作项收集', () => {
  it('从出牌者下家开始顺时针，只收出牌响应类操作（不含暗杠/补杠/出牌）', () => {
    const opts = collectOptions(0, 11, [createHand(), canPengHand(), createHand(), createHand()], cfg, null);
    expect([...opts.keys()]).toEqual([1]);

    const types = opts.get(1)!.map((o) => o.type);
    expect(types).toContain('PENG');
    expect(types).not.toContain('AN_GANG');
    expect(types).not.toContain('BU_GANG');
    expect(types).not.toContain('DISCARD');
  });

  it('无事可做的玩家不进窗口（只能 PASS 的人不入窗）', () => {
    const opts = collectOptions(0, 11, [createHand(), createHand(), createHand(), createHand()], cfg, null);
    expect(opts.size).toBe(0);
  });

  it('出牌者自己不进窗口', () => {
    // 座位 0 手里有 3 张 11，但他是出牌者
    const opts = collectOptions(0, 11, [canPengGangHand(), createHand(), createHand(), createHand()], cfg, null);
    expect(opts.has(0)).toBe(false);
  });

  it('每个玩家同一类型只保留一条，且始终带 PASS（priority 0）', () => {
    const opts = collectOptions(0, 11, [createHand(), canPengGangHand(), createHand(), createHand()], cfg, null);
    const list = opts.get(1)!;
    expect(list.filter((o) => o.type === 'PENG')).toHaveLength(1);
    expect(list.filter((o) => o.type === 'MING_GANG')).toHaveLength(1);
    expect(list.find((o) => o.type === 'PASS')!.priority).toBe(ACTION_PRIORITY.PASS);
    expect(ACTION_PRIORITY.PASS).toBe(0);
    expect(ACTION_PRIORITY.HU).toBeGreaterThan(ACTION_PRIORITY.MING_GANG);
    expect(ACTION_PRIORITY.MING_GANG).toBeGreaterThan(ACTION_PRIORITY.PENG);
  });

  it('按 priority 降序、同级按 distance 升序排序', () => {
    const opts = collectOptions(0, 11, [createHand(), canPengGangHand(), createHand(), canPengHand()], cfg, null);
    const all = [...opts.values()].flat();
    expect(all[0].priority).toBeGreaterThanOrEqual(all[all.length - 1].priority);

    const forSeat1 = opts.get(1)!.map((o) => o.priority);
    expect(forSeat1).toEqual([...forSeat1].sort((a, b) => b - a));

    // 距离按顺时针算：0→1 是 1，0→3 是 3
    expect(opts.get(1)![0].distance).toBe(1);
    expect(opts.get(3)![0].distance).toBe(3);
  });

  it('能胡时 HU 排在 PENG 之前', () => {
    // 座位 1 既能胡 11 又握着 3 张 11
    const opts = collectOptions(0, 11, [createHand(), canHuHand(), createHand(), createHand()], cfg, null);
    expect(opts.get(1)!.map((o) => o.type)).toEqual(['HU', 'PENG', 'PASS']);
  });

  it('传 null 的预览提供者时不计算胡分预估', () => {
    const opts = collectOptions(0, 11, [createHand(), canHuHand(), createHand(), createHand()], cfg, null);
    expect(opts.get(1)!.find((o) => o.type === 'HU')!.huPreview).toBeNull();
  });

  it('给了预览提供者就填上胡分预估，且只填在 HU 上', () => {
    const preview = (seat: number, tile: number): number | null => (seat === 1 && tile === 11 ? 8 : null);
    const opts = collectOptions(0, 11, [createHand(), canHuHand(), createHand(), createHand()], cfg, preview);
    const list = opts.get(1)!;
    expect(list.find((o) => o.type === 'HU')!.huPreview).toBe(8);
    expect(list.find((o) => o.type === 'PENG')!.huPreview).toBeNull();
    expect(list.find((o) => o.type === 'PASS')!.huPreview).toBeNull();
  });

  it('十三烂字牌 5 张的手牌：点炮窗口里根本没有 HU 选项（R-05 联动）', () => {
    // 座位 1 手里 13 张，并进 52 正好是"字牌 5 张"的十三烂 —— 只许自摸
    const lan = handOf([11, 14, 17, 21, 24, 27, 31, 34, 37, 41, 42, 43, 51]);
    const opts = collectOptions(0, 52, [createHand(), lan, createHand(), createHand()], cfg, null);
    expect(opts.size).toBe(0); // 既碰不了也胡不了 → 不入窗
  });

  it('七星十三烂（字牌 7 张）在点炮窗口里出现 HU（R-05）', () => {
    const qiXing = handOf([11, 15, 21, 25, 31, 35, 39, 41, 42, 43, 44, 51, 52]);
    const opts = collectOptions(0, 53, [createHand(), qiXing, createHand(), createHand()], cfg, null);
    expect(opts.get(1)!.map((o) => o.type)).toEqual(['HU', 'PASS']);
  });

  it('距离环绕：出牌者是座位 3 时，座位 0 的距离是 1', () => {
    const opts = collectOptions(3, 11, [canPengHand(), createHand(), createHand(), createHand()], cfg, null);
    expect(opts.get(0)![0].distance).toBe(1);
  });
});

/**
 * Task 34：轮到自己出牌时的按钮。
 *
 * 为什么这些不由客户端自己算：`canAnGang` / `canBuGang` / `canHuSelf` 要用 `justPeng`（"本巡
 * 刚碰过，不能立刻补杠同一张"）这类**不在公开视图里**的状态。客户端自己复算就等于把规则抄了
 * 第二份，而两份规则迟早会不一致 —— 一份说得能杠、一份说不能，玩家点了按钮被 host 拒。
 * 所以由 host 用引擎算好、随私有视图下发，客户端只负责画。
 */
describe('自己回合的可操作项', () => {
  const typesOf = (hand: Parameters<typeof ownTurnOptions>[0]): string[] =>
    ownTurnOptions(hand, cfg).map((o) => o.type);

  it('自摸的牌形给出 HU', () => {
    expect(typesOf(zimoReady(1).hands[1])).toEqual(['HU']);
  });

  it('手里正好 4 张同一牌码 → 暗杠', () => {
    const hand = handOf([11, 11, 11, 11, 13, 15, 19, 21, 24, 27, 31, 34, 37, 41]);
    expect(typesOf(hand)).toEqual(['AN_GANG']);
  });

  it('碰过这张、手里还留着第 4 张 → 补杠', () => {
    const hand: HandState = {
      ...handOf([11, 13, 15, 19, 21, 24, 27, 31, 34, 37]),
      melds: [{ kind: 'PENG', tile: 11, fromSeat: 0 }],
    };
    expect(typesOf(hand)).toEqual(['BU_GANG']);
  });

  it('本巡刚碰过 → 不提示补杠（碰完不能立刻补同一张）', () => {
    const hand: HandState = {
      ...handOf([11, 13, 15, 19, 21, 24, 27, 31, 34, 37]),
      melds: [{ kind: 'PENG', tile: 11, fromSeat: 0 }],
      justPeng: true,
    };
    expect(typesOf(hand)).toEqual([]);
  });

  it('什么都不能做时是空数组，不是 undefined（没有选项就一个按钮都不显示）', () => {
    expect(typesOf(canPengHand())).toEqual([]);
  });

  it('不给出鸣牌窗口才有的那些（碰/明杠/过在这里没有意义）', () => {
    const hand = handOf([11, 11, 11, 11, 13, 15, 19, 21, 24, 27, 31, 34, 37, 41]);
    const types = typesOf(hand);
    for (const t of ['PENG', 'MING_GANG', 'PASS', 'DISCARD']) {
      expect(types).not.toContain(t);
    }
  });

  it('能自摸又有杠时，HU 排在最前（优先级高者在前，界面才不用自己排）', () => {
    // 111 111 的情况：concealed 里正好 4 张 11，同时是能自摸的牌形
    const hand: HandState = {
      ...handOf([11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 41, 11]),
      drawnTile: 11,
    };
    expect(typesOf(hand)[0]).toBe('HU');
  });

  /**
   * 每条选项都必须带上是**哪一张牌**。
   *
   * 一开始没带，于是"手里同时能暗杠 1111 和 2222"时界面上是两个一模一样的"暗杠"按钮 ——
   * 点哪个都长得一样，而点错了 host 会照做（它收到的就是那个牌码）。碰/明杠看着没这个问题
   * （碰的是别人刚打的那张，很明确），但那是"碰巧不歧义"，不是"不会歧义"。
   */
  it('每条选项都指明作用于哪张牌；过牌这条没有牌', () => {
    const opts = collectOptions(0, 11, [createHand(), canPengGangHand(), createHand(), createHand()], cfg, null);
    const list = opts.get(1)!;
    expect(list.find((o) => o.type === 'MING_GANG')!.tile).toBe(11);
    expect(list.find((o) => o.type === 'PENG')!.tile).toBe(11);
    expect(list.find((o) => o.type === 'PASS')!.tile).toBeNull();
  });

  it('同时能暗杠两张不同的牌时，两条选项靠 tile 区分开', () => {
    const hand = handOf([11, 11, 11, 11, 21, 21, 21, 21, 13, 15, 19, 31, 34, 37]);
    const list = ownTurnOptions(hand, cfg);
    expect(list.map((o) => o.type)).toEqual(['AN_GANG', 'AN_GANG']);
    expect(list.map((o) => o.tile)).toEqual([11, 21]);
  });

  it('自摸那条带的是刚摸到的那张（算炮数预估要用它）', () => {
    expect(ownTurnOptions(zimoReady(1).hands[1], cfg)[0]).toMatchObject({ type: 'HU', tile: 11 });
  });
});
