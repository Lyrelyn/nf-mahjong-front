// 移植自 nf-mahjong/tests/core/action/hand.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import {
  addMeld,
  addTile,
  assertHandInvariants,
  createHand,
  handTileCount,
  removeTile,
  type HandState,
} from './hand';
import { DEFAULT_RULE_CONFIG } from '../ruleConfig';
import { meldTileCount, type Meld } from '../melds';
import type { Tile } from '../tiles';

const cfg = DEFAULT_RULE_CONFIG;
const PENG = (tile: Tile): Meld => ({ kind: 'PENG', tile, fromSeat: 1 });

describe('手牌张数', () => {
  it('暗牌 + 副露折算（碰算 3 张）', () => {
    const h = addMeld(addTile(createHand(), 11), PENG(22));
    expect(handTileCount(h)).toBe(4);
  });

  it('三种杠都按 4 张折算，与 meldTileCount 同口径（C-1 校准）', () => {
    const kinds = [
      { kind: 'MING_GANG', fromSeat: 2 },
      { kind: 'AN_GANG', fromSeat: null },
      { kind: 'BU_GANG', fromSeat: null },
    ] as const;
    for (const { kind, fromSeat } of kinds) {
      const meld: Meld = { kind, tile: 11, fromSeat };
      expect(handTileCount(addMeld(createHand(), meld))).toBe(meldTileCount(meld));
      expect(handTileCount(addMeld(createHand(), meld))).toBe(4);
    }
  });

  it('刚摸到的那张单独记在 drawnTile 上，同样计入张数', () => {
    expect(handTileCount({ ...createHand(), drawnTile: 11 })).toBe(1);

    // 13 张暗牌 + 摸到的 1 张 = 14（庄家开局的形态）
    let h: HandState = { ...createHand(), drawnTile: 11 };
    for (const t of [12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25]) h = addTile(h, t);
    expect(handTileCount(h)).toBe(14);
  });

  it('空手牌是 0 张', () => {
    expect(handTileCount(createHand())).toBe(0);
  });
});

describe('不可变更新', () => {
  it('addTile 返回新对象，不改动原对象', () => {
    const before = createHand();
    const after = addTile(before, 11);
    expect(after).not.toBe(before);
    expect(after.concealed).not.toBe(before.concealed);
    expect(handTileCount(before)).toBe(0);
    expect(handTileCount(after)).toBe(1);
  });

  it('removeTile 返回新对象，不改动原对象', () => {
    const before = addTile(addTile(createHand(), 11), 11);
    const after = removeTile(before, 11);
    expect(handTileCount(before)).toBe(2);
    expect(handTileCount(after)).toBe(1);
  });

  it('addMeld 追加而不覆盖已有副露', () => {
    const h = addMeld(addMeld(createHand(), PENG(11)), PENG(22));
    expect(h.melds).toHaveLength(2);
    expect(h.melds.map((m) => m.tile)).toEqual([11, 22]);
  });

  it('不可移除不存在的牌', () => {
    expect(() => removeTile(createHand(), 11)).toThrow(/没有/);
  });
});

describe('手牌不变量', () => {
  it('合法手牌不抛', () => {
    let h = createHand();
    for (const t of [11, 11, 11, 12, 12, 12, 13, 13, 13, 21, 21, 21, 31, 31]) h = addTile(h, t);
    expect(() => assertHandInvariants(h, cfg)).not.toThrow();
  });

  it('单独暗持 4 张是合法的（那正是暗杠的前置）', () => {
    let h = createHand();
    for (let i = 0; i < 4; i++) h = addTile(h, 11);
    expect(() => assertHandInvariants(h, cfg)).not.toThrow();
  });

  it('每种牌总数不得超过 4：暗牌与副露要一起算', () => {
    let h = createHand();
    for (let i = 0; i < 4; i++) h = addTile(h, 11);
    h = addMeld(h, PENG(11));
    expect(() => assertHandInvariants(h, cfg)).toThrow(/超过 4 张/);
  });

  it('碰走 3 张 + 手里还有 2 张 = 第 5 张，超限（故意构造的坏状态）', () => {
    const h = addMeld(addTile(addTile(createHand(), 11), 11), PENG(11));
    expect(() => assertHandInvariants(h, cfg)).toThrow(/超过 4 张/);
  });
});
