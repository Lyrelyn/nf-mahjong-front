// 移植自 nf-mahjong/tests/core/tiles.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import {
  COUNT_SIZE,
  WALL_SIZE,
  fullWall,
  isDragon,
  isNumberTile,
  isWind,
  isWord,
  rankOf,
  suitOf,
} from './tiles';
import { countsOf, totalCount } from './counts';

describe('牌编码', () => {
  it('编码区间符合约定', () => {
    expect(suitOf(11)).toBe('WAN');
    expect(suitOf(19)).toBe('WAN');
    expect(suitOf(29)).toBe('TIAO');
    expect(suitOf(35)).toBe('TONG');
    expect(suitOf(41)).toBe('WIND');
    expect(suitOf(53)).toBe('DRAGON');
    expect(isWord(41)).toBe(true);
    expect(isWord(51)).toBe(true);
    expect(isWord(39)).toBe(false);
    expect(rankOf(11)).toBe(1);
    expect(rankOf(19)).toBe(9);
    expect(rankOf(44)).toBe(4);
    expect(rankOf(53)).toBe(3);
  });

  it('合法性谓词与 suitOf 一致', () => {
    expect(isNumberTile(11)).toBe(true);
    expect(isNumberTile(39)).toBe(true);
    expect(isNumberTile(41)).toBe(false);
    expect(isWind(41)).toBe(true);
    expect(isWind(44)).toBe(true);
    expect(isWind(51)).toBe(false);
    expect(isDragon(51)).toBe(true);
    expect(isDragon(53)).toBe(true);
    expect(isDragon(41)).toBe(false);
  });

  it('非法牌码直接报错，而不是静默返回（S-09 的编码区间隐患）', () => {
    for (const bad of [0, 10, 20, 40, 45, 50, 54, 99]) {
      expect(() => suitOf(bad), `suitOf(${bad})`).toThrow();
      expect(() => rankOf(bad), `rankOf(${bad})`).toThrow();
    }
  });

  it('fullWall 是 136 张且每种恰好 4 张', () => {
    const w = fullWall();
    expect(w).toHaveLength(WALL_SIZE);
    expect(totalCount(countsOf(w))).toBe(WALL_SIZE);
    for (let t = 11; t <= 53; t++) {
      if (isNumberTile(t) || isWord(t)) expect(countsOf(w)[t], `牌码 ${t}`).toBe(4);
    }
  });

  it('COUNT_SIZE 与编码区间一致（54..60 保留，61+ 留给马牌）', () => {
    expect(COUNT_SIZE).toBe(54);
  });
});
