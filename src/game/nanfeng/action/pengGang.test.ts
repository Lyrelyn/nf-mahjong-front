// 移植自 nf-mahjong/tests/core/action/pengGang.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import {
  canAnGang,
  canBuGang,
  canHuRon,
  canHuSelf,
  canMingGang,
  canPeng,
} from './pengGang';
import { addMeld, addTile, createHand, type HandState } from './hand';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from '../ruleConfig';
import type { Meld } from '../melds';
import type { Tile } from '../tiles';

const cfg = DEFAULT_RULE_CONFIG;
const PENG = (tile: Tile): Meld => ({ kind: 'PENG', tile, fromSeat: 2 });

const handOf = (tiles: readonly Tile[]): HandState => {
  let h = createHand();
  for (const t of tiles) h = addTile(h, t);
  return h;
};

/**
 * 13 张，并进 41 成**碰碰胡**：`11×3 + 12×3 + 13×3 + 21×3 + 41,41`。
 *
 * 2026-11 改规后平胡只能自摸，所以"测点炮"的用例一律改用碰碰胡 —— 仍用平胡手牌的话，
 * `canHuRon` 会先被"平胡不能点炮"挡掉，测到的就不是这条用例本来要测的东西了。
 */
const PENG_PENG_13: readonly Tile[] = [11, 11, 11, 12, 12, 12, 13, 13, 13, 21, 21, 21, 41];

describe('碰与明杠的门槛', () => {
  it('碰需要两张，明杠需要三张', () => {
    const h = handOf([11, 11, 11]);
    expect(canPeng(h, 11, cfg)).toBe(true);
    expect(canMingGang(h, 11, cfg)).toBe(true);

    const h2 = handOf([11, 11]);
    expect(canPeng(h2, 11, cfg)).toBe(true);
    expect(canMingGang(h2, 11, cfg)).toBe(false);
  });

  it('只有一张就碰不了', () => {
    expect(canPeng(handOf([11]), 11, cfg)).toBe(false);
    expect(canMingGang(handOf([11]), 11, cfg)).toBe(false);
  });

  it('漏碰没有限制：随时能碰（R-06）', () => {
    // 上一巡放弃了碰，这一巡同一张牌再来照样能碰 —— 不存在任何禁碰状态
    expect(canPeng(handOf([11, 11]), 11, cfg)).toBe(true);
  });
});

describe('暗杠与补杠必须轮到自己', () => {
  it('暗杠要手里正好 4 张，且 ownTurn 为真', () => {
    const h = handOf([11, 11, 11, 11]);
    expect(canAnGang(h, 11, cfg, true)).toBe(true);
    expect(canAnGang(h, 11, cfg, false)).toBe(false); // 越权调用

    expect(canAnGang(handOf([11, 11, 11]), 11, cfg, true)).toBe(false);
    expect(canAnGang(handOf([11, 11, 11, 11, 11]), 11, cfg, true)).toBe(false); // 不可能状态也不放行
  });

  it('补杠要"碰过这张 + 手里还有第 4 张"，且轮到自己', () => {
    const base = addMeld(addTile(createHand(), 11), PENG(11));
    expect(canBuGang(base, 11, cfg, true)).toBe(true);
    expect(canBuGang(base, 11, cfg, false)).toBe(false);

    // 没有碰过这张 → 不能补杠（那是暗杠）
    expect(canBuGang(addTile(createHand(), 11), 11, cfg, true)).toBe(false);
  });

  it('刚摸到的那张也算第 4 张（补杠通常是摸上来的）', () => {
    const base = addMeld(createHand(), PENG(11));
    expect(canBuGang({ ...base, drawnTile: 11 }, 11, cfg, true)).toBe(true);
  });

  it('碰后不能立即补杠', () => {
    const h = addMeld(addTile(createHand(), 11), PENG(11));
    expect(canBuGang({ ...h, justPeng: true }, 11, cfg, true)).toBe(false);
    expect(canBuGang({ ...h, justPeng: false }, 11, cfg, true)).toBe(true);
  });
});

describe('自摸与点炮', () => {
  it('成胡的自摸成立', () => {
    expect(canHuSelf(handOf([11, 12, 13, 11, 12, 13, 14, 15, 16, 17, 17, 17, 18, 18]), cfg)).toBe(true);
  });

  it('没成胡的自摸不成立（混花色，连假胡都不是）', () => {
    expect(canHuSelf(handOf([11, 12, 14, 11, 12, 15, 21, 22, 24, 21, 22, 25, 31, 31]), cfg)).toBe(false);
  });

  it('全同一花色但不成结构 → 假胡，自摸成立（R-03）', () => {
    expect(canHuSelf(handOf([11, 12, 14, 11, 12, 15, 11, 12, 13, 17, 17, 17, 18, 18]), cfg)).toBe(true);
  });

  it('张数不是 14 不成立（点炮只差那一张）', () => {
    const h = handOf([11, 12, 13, 11, 12, 13, 14, 15, 16, 17, 17, 17, 18]);
    expect(canHuRon(h, 18, cfg)).toBe(true);
    expect(canHuRon(h, 19, cfg)).toBe(true); // 全万子 → 假胡，默认允许点炮（R-03）
    expect(canHuRon(h, 21, cfg)).toBe(false); // 混进条子 → 既不成结构也不是假胡
    expect(canHuSelf(h, cfg)).toBe(false); // 手里只有 13 张
  });

  it('点炮时把待胡的牌并进手牌再判：差一张就是胡', () => {
    const h = handOf(PENG_PENG_13);
    expect(canHuRon(h, 41, cfg)).toBe(true);
    expect(canHuSelf(addTile(h, 41), cfg)).toBe(true);
  });
});

describe('十三烂的自摸限制（R-05）', () => {
  it('字牌 5 张时点炮拒胡、自摸照常', () => {
    const h = handOf([11, 14, 17, 21, 24, 27, 31, 34, 37, 41, 42, 43, 51]); // 字牌 41,42,43,51
    expect(canHuRon(h, 52, cfg)).toBe(false); // 第 5 张字牌 → 只许自摸
    expect(canHuSelf(addTile(h, 52), cfg)).toBe(true);
  });

  it('字牌 6 张时同样只能自摸', () => {
    const h = handOf([11, 15, 19, 21, 25, 29, 31, 35, 41, 42, 43, 44, 51]);
    expect(canHuRon(h, 52, cfg)).toBe(false);
    expect(canHuSelf(addTile(h, 52), cfg)).toBe(true);
  });

  it('七星十三烂（字牌 7 张）允许点炮', () => {
    const h = handOf([11, 15, 21, 25, 31, 35, 39, 41, 42, 43, 44, 51, 52]);
    expect(canHuRon(h, 53, cfg)).toBe(true);
  });

  it('不是十三烂的手牌不受这条限制', () => {
    const h = handOf(PENG_PENG_13);
    expect(canHuRon(h, 41, cfg)).toBe(true);
  });
});

describe('假胡的点炮开关（hu.jiaHu.allowRon）', () => {
  // 全万子、拆不出结构 → 假胡
  const JIA_HU_13: readonly Tile[] = [11, 11, 12, 14, 15, 17, 17, 19, 19, 11, 12, 14, 15];

  it('allowRon 为真时假胡可以点炮', () => {
    expect(canHuRon(handOf(JIA_HU_13), 17, cfg)).toBe(true);
  });

  it('allowRon 为假时假胡只能自摸', () => {
    const noRon: RuleConfig = { ...cfg, hu: { ...cfg.hu, jiaHu: { enabled: true, allowRon: false } } };
    expect(canHuRon(handOf(JIA_HU_13), 17, noRon)).toBe(false);
    expect(canHuSelf(handOf([...JIA_HU_13, 17]), noRon)).toBe(true);
  });

  it('allowRon 为假只挡住假胡，真结构照常点炮', () => {
    const noRon: RuleConfig = { ...cfg, hu: { ...cfg.hu, jiaHu: { enabled: true, allowRon: false } } };
    const h = handOf(PENG_PENG_13);
    expect(canHuRon(h, 41, noRon)).toBe(true);
  });
});

/**
 * 2026-11 改规：**平胡不能胡别人的牌**（点炮 / 抢杠都算别人的牌），只能自摸。
 * 其余牌型一律照常 —— 规则只认"标准结构 + 标签里只有 PING_HU 一个"这手牌。
 */
describe('纯平胡只能自摸（2026-11 改规）', () => {
  /** `11-12-13 + 21-22-23 + 31×3 + 41×3 + 51,51` 将，并进 51 即胡 → 标签只有 PING_HU。 */
  const PLAIN_13: readonly Tile[] = [11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 41, 51];

  it('平胡点炮被拒，自摸照常', () => {
    expect(canHuRon(handOf(PLAIN_13), 51, cfg)).toBe(false);
    expect(canHuSelf(handOf([...PLAIN_13, 51]), cfg)).toBe(true);
  });

  it('碰碰胡照常点炮（"除平胡外全都能点炮"）', () => {
    expect(canHuRon(handOf(PENG_PENG_13), 41, cfg)).toBe(true);
  });

  it('一色只是加成，底下的标准结构仍能点炮', () => {
    // 全万子：11-12-13 + 14×3 + 16×3 + 19×3 + 17,17 → PING_HU + QING_YI_SE_ZHEN 两个标签
    const qingSe = handOf([12, 13, 14, 14, 14, 16, 16, 16, 17, 17, 19, 19, 19]);
    expect(canHuRon(qingSe, 11, cfg)).toBe(true);
  });
});
