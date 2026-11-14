// 移植自 nf-mahjong/assets/scripts/core/hu/huJudge.ts（逻辑未改动）
/**
 * 判胡入口：按维度独立判定后**合并标签集合**，而不是"特型优先短路 + 返回单一枚举"。
 *
 * 这是对规则文档 §2.4 的修正（S-01 / S-02）：
 *   - S-01：计分表是按多标签组合建键的（如 `QI_DUI+ZI_YI_SE_ZHEN`）。若 judgeHu 只返回单一枚举，
 *           表里所有多标签行永远不可达。所以必须返回 Set<FanTag>，且"标签收集"是显式的一步。
 *   - S-02：规则文档把假胡放在标准型之前 `return`，会让"全万子且成标准型"的牌被判成假胡，
 *           与 §2.8/H-31「同时满足真结构时只打真胡标签」直接冲突。这里假胡只作**兜底**。
 *
 * 结构型（标准型 / 七对 / 十三烂）互斥，取第一个成立的；其余维度各自独立叠加。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { totalCount, type Counts } from '../counts';
import { meldTileCount, type Meld } from '../melds';
import type { RuleConfig } from '../ruleConfig';
import type { FanTag } from '../fanTags';
import { isPengPengHu, isStandard } from './decompose';
import { isQingYiSe, isZiYiSe } from './colors';
import { countGuiYi, guiYiTag } from './guiYi';
import { isJiaHu } from './jiaHu';
import { isSevenPairs } from './sevenPairs';
import { isQiXingShiSanLan, isShiSanLan } from './shiSanLan';

export type StructureKind = 'STANDARD' | 'QI_DUI' | 'SHI_SAN_LAN' | 'NONE';

export interface JudgeResult {
  structure: StructureKind;
  tags: Set<FanTag>;
}

export function judgeHu(counts: Counts, melds: readonly Meld[], cfg: RuleConfig): JudgeResult {
  const tags = new Set<FanTag>();
  const meldCount = melds.length;

  // 整手牌必须是 14 张（暗牌 + 副露折算，含胡牌张）。张数不对一律不胡。
  let meldTiles = 0;
  for (const meld of melds) meldTiles += meldTileCount(meld);
  if (totalCount(counts) + meldTiles !== 14) {
    return { structure: 'NONE', tags };
  }

  // 结构型：互斥，取第一个成立的。七对与十三烂都要求门清（无副露）。
  let structure: StructureKind = 'NONE';
  if (meldCount === 0 && cfg.hu.qiDui.enabled && isSevenPairs(counts)) {
    structure = 'QI_DUI';
  } else if (meldCount === 0 && cfg.hu.shiSanLan.enabled && isShiSanLan(counts)) {
    structure = 'SHI_SAN_LAN';
  } else if (isStandard(counts, meldCount, cfg)) {
    structure = 'STANDARD';
  }

  const qing = isQingYiSe(counts, melds);
  const zi = isZiYiSe(counts, melds);

  if (structure !== 'NONE') {
    if (structure === 'QI_DUI') tags.add('QI_DUI');
    if (structure === 'SHI_SAN_LAN') {
      tags.add(isQiXingShiSanLan(counts) ? 'QI_XING_SHI_SAN_LAN' : 'SHI_SAN_LAN');
    }
    if (structure === 'STANDARD') {
      tags.add(isPengPengHu(counts, meldCount) ? 'PENG_PENG_HU' : 'PING_HU');
    }
    if (qing) tags.add('QING_YI_SE_ZHEN');
    if (zi) tags.add('ZI_YI_SE_ZHEN');
    const guiYi = guiYiTag(countGuiYi(counts, melds));
    if (guiYi) tags.add(guiYi);
  } else if (cfg.hu.jiaHu.enabled && isJiaHu(counts, melds)) {
    // 假胡兜底：真结构成立时绝不叠加假胡标签（H-31），故只在 structure === 'NONE' 时到达。
    if (qing) tags.add('QING_YI_SE_JIA');
    if (zi) tags.add('ZI_YI_SE_JIA');
  }

  return { structure, tags };
}
