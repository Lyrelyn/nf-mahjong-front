// 移植自 nf-mahjong/tests/core/hu/guiYi.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { countGuiYi, guiYiTag } from './guiYi';
import { meldSetCount, meldTileCount, type Meld } from '../melds';
import { countsOf } from '../counts';

describe('副露折算：组数与张数', () => {
  it('面子需求：杠算刻，三种杠都占 1 组', () => {
    expect(meldSetCount({ kind: 'AN_GANG', tile: 11, fromSeat: null })).toBe(1);
    expect(meldSetCount({ kind: 'BU_GANG', tile: 11, fromSeat: null })).toBe(1);
    expect(meldSetCount({ kind: 'PENG', tile: 11, fromSeat: 2 })).toBe(1);
  });

  it('张数折算：碰 3 张，三种杠各 4 张（R-07：归一与张数同口径）', () => {
    expect(meldTileCount({ kind: 'PENG', tile: 11, fromSeat: 2 })).toBe(3);
    expect(meldTileCount({ kind: 'MING_GANG', tile: 11, fromSeat: 2 })).toBe(4);
    expect(meldTileCount({ kind: 'AN_GANG', tile: 11, fromSeat: null })).toBe(4);
    expect(meldTileCount({ kind: 'BU_GANG', tile: 11, fromSeat: null })).toBe(4);
  });
});

describe('归一计数（R-07：该牌码的 4 张全归你就算，杠也算）', () => {
  it('统计"暗牌 + 全部副露"总数为 4 的牌码个数', () => {
    const melds: Meld[] = [{ kind: 'PENG', tile: 11, fromSeat: 1 }];
    // 11：碰 3 + 暗 1 = 4；22：暗 4 = 4 → 两个归一
    expect(countGuiYi(countsOf([11, 22, 22, 22, 22]), melds)).toBe(2);
  });

  it('明杠、暗杠、补杠的 4 张都算归一（R-07 前明杠不算，现在算）', () => {
    expect(countGuiYi(countsOf([]), [{ kind: 'MING_GANG', tile: 11, fromSeat: 2 }])).toBe(1);
    expect(countGuiYi(countsOf([]), [{ kind: 'AN_GANG', tile: 11, fromSeat: null }])).toBe(1);
    expect(countGuiYi(countsOf([]), [{ kind: 'BU_GANG', tile: 11, fromSeat: null }])).toBe(1);
  });

  it('碰过的那张牌补杠后归一仍在（R-04：做了个合法动作不该掉分）', () => {
    // 补杠前后是同一批 4 张牌：碰 3 张 + 手里第 4 张 → 补杠后这 4 张全在副露里
    expect(countGuiYi(countsOf([11]), [{ kind: 'PENG', tile: 11, fromSeat: 1 }])).toBe(1);
    expect(countGuiYi(countsOf([]), [{ kind: 'BU_GANG', tile: 11, fromSeat: null }])).toBe(1);
  });

  it('手里暗持 4 张去暗杠后归一仍在（R-04 的同一条原则）', () => {
    expect(countGuiYi(countsOf([11, 11, 11, 11]), [])).toBe(1);
    expect(countGuiYi(countsOf([]), [{ kind: 'AN_GANG', tile: 11, fromSeat: null }])).toBe(1);
  });

  it('只有 3 张不算归一', () => {
    expect(countGuiYi(countsOf([11, 11, 11]), [])).toBe(0);
    // 碰走 3 张、手里没有第 4 张 → 不算
    expect(countGuiYi(countsOf([]), [{ kind: 'PENG', tile: 11, fromSeat: 2 }])).toBe(0);
  });

  it('两种牌各 4 张 → 2 个归一', () => {
    expect(countGuiYi(countsOf([11, 11, 11, 11, 41, 41, 41, 41]), [])).toBe(2);
  });
});

describe('归一标签映射', () => {
  it('一个个数对应一个标签，0 与 4 个都不给标签', () => {
    expect(guiYiTag(0)).toBeNull();
    expect(guiYiTag(1)).toBe('SI_GUI_YI');
    expect(guiYiTag(2)).toBe('BA_GUI_YI');
    expect(guiYiTag(3)).toBe('SHI_ER_GUI_YI');
    expect(guiYiTag(4)).toBeNull();
  });
});
