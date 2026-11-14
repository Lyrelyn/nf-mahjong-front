// 移植自 nf-mahjong/assets/scripts/core/melds.ts（逻辑未改动）
/**
 * 副露（碰 / 杠）的表示与折算。
 *
 * 两种折算必须分开（规则文档 §2.2）：
 *   - meldSetCount：占几组面子需求 —— 杠算刻，所以三种杠都算 1 组；
 *   - meldTileCount：这副露实际占了几张牌 —— 碰 3 张，三种杠各 4 张。
 *
 * R-07 把"归一折算"与"张数折算"合并了：归一统计的口径是"该牌码的 4 张全归你"，
 * 所以每副露对归一的贡献就是它占的张数，两者同口径，不再需要单独的 meldGuiYiCount。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import type { Tile } from './tiles';

export type MeldKind = 'PENG' | 'MING_GANG' | 'AN_GANG' | 'BU_GANG';

export interface Meld {
  kind: MeldKind;
  tile: Tile;
  /** 碰/明杠的来源座位；暗杠与补杠为 null。 */
  fromSeat: number | null;
}

/** 面子需求折算：杠算刻，一律占 1 组。 */
export function meldSetCount(_meld: Meld): 1 {
  return 1;
}

/** 张数折算：碰 3 张，明杠/暗杠/补杠各 4 张。归一统计与本手牌张数共用这一折算。 */
export function meldTileCount(meld: Meld): 3 | 4 {
  return meld.kind === 'PENG' ? 3 : 4;
}
