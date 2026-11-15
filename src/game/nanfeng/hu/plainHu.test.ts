// 对应后端 tests/nanfeng/hu/test_plain_hu_ron.py 里"定义"那两条 + 事件型标签剔除
import { describe, it, expect } from 'vitest';
import { isEventTag, isPlainHu, patternTags } from './plainHu';
import type { FanTag } from '../fanTags';

const tags = (...list: FanTag[]): Set<FanTag> => new Set(list);

describe('纯平胡的定义（R-12）', () => {
  it('只有 PING_HU 才是平胡', () => {
    expect(isPlainHu(tags('PING_HU'))).toBe(true);
  });

  it('空标签不是平胡（没胡牌，别把"什么都没有"判成平胡）', () => {
    expect(isPlainHu(tags())).toBe(false);
  });

  it('任何一种牌型加成都不再是平胡', () => {
    const bonuses: FanTag[] = [
      'PENG_PENG_HU',
      'PENG_PENG_HU_DAN_DIAO',
      'QI_DUI',
      'SHI_SAN_LAN',
      'QI_XING_SHI_SAN_LAN',
      'QING_YI_SE_ZHEN',
      'QING_YI_SE_JIA',
      'ZI_YI_SE_ZHEN',
      'ZI_YI_SE_JIA',
      'SI_GUI_YI',
      'BA_GUI_YI',
      'SHI_ER_GUI_YI',
    ];
    for (const bonus of bonuses) expect(isPlainHu(tags('PING_HU', bonus)), bonus).toBe(false);
  });

  /**
   * 这条是**抢杠口子的守门人**：一手平胡抢杠胡的标签是 `PING_HU + QIANG_GANG_HU`，
   * 如果照字面判"标签多于一个 ⇒ 不是平胡"，平胡就能从抢杠这个口子胡别人的牌。
   */
  it('事件型标签不算牌型：平胡 + 抢杠胡 / 自摸 / 杠上开花 仍是平胡', () => {
    expect(isPlainHu(tags('PING_HU', 'QIANG_GANG_HU'))).toBe(true);
    expect(isPlainHu(tags('PING_HU', 'ZI_MO'))).toBe(true);
    expect(isPlainHu(tags('PING_HU', 'GANG_SHANG_KAI_HUA'))).toBe(true);
    expect(isPlainHu(tags('PING_HU', 'ZI_MO', 'GANG_SHANG_KAI_HUA'))).toBe(true);
  });

  it('事件型标签的边界：40 起是事件，之前都是牌型', () => {
    expect(isEventTag('SI_GUI_YI')).toBe(false);
    expect(isEventTag('SHI_ER_GUI_YI')).toBe(false);
    expect(isEventTag('ZI_MO')).toBe(true);
    expect(isEventTag('GANG_SHANG_KAI_HUA')).toBe(true);
    expect(isEventTag('QIANG_GANG_HU')).toBe(true);
  });

  it('patternTags 只留牌型，且不改原集合', () => {
    const original = tags('PING_HU', 'ZI_MO');
    expect([...patternTags(original)]).toEqual(['PING_HU']);
    expect([...original].sort()).toEqual(['PING_HU', 'ZI_MO']);
  });
});
