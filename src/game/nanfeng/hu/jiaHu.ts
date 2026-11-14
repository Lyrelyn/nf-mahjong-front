// 移植自 nf-mahjong/assets/scripts/core/hu/jiaHu.ts（逻辑未改动）
/**
 * 假胡（南丰特色，规则文档 §2.8 已确认存在）。
 *
 * 条件（满足其一）：全部牌同属一个数牌花色；或全部为字牌。
 * **不需要构成任何面子/将** —— 这是南丰与常规麻将最大的判胡差异。
 * 不要求门清：副露牌参与花色判定。
 *
 * 牌张数（14 张含胡牌张）不是本谓词的职责：那是"整手牌是否成胡"的条件，
 * 由 judgeHu 在整手牌层面统一检查，本谓词只回答"花色是否够格"。
 *
 * S-11 未决：规则文档 §2.8 标"已确认存在"，§5.3 的计分表又标"默认关闭识别"。
 * 当前按 spec 的判胡设计取 enabled=true（见 ruleConfig.ts）。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import type { Counts } from '../counts';
import type { Meld } from '../melds';
import { isQingYiSe, isZiYiSe } from './colors';

export function isJiaHu(counts: Counts, melds: readonly Meld[]): boolean {
  return isQingYiSe(counts, melds) || isZiYiSe(counts, melds);
}
