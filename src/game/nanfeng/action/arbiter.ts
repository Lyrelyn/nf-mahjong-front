// 移植自 nf-mahjong/assets/scripts/core/action/arbiter.ts（逻辑未改动）
/**
 * 鸣牌仲裁：窗口关闭后，host 用它把一堆"我想碰/杠/胡"的响应收成一个结果。
 *
 * 规则（规则文档 §4，Task 0 已确认）：
 *   - 优先级 `HU(40) > MING_GANG(30) > PENG(20) > PASS(0)`；
 *   - **一炮多响**（Q-05）：`claim.allowMultipleHu` 为真时，HU 这一档**全部**响应者都算胡，
 *     放炮者分别付给每家（Task 19 结算）；为假时只取距出牌者最近的一家。
 *   - 碰/杠永远只出一个赢家，同级取最近者。
 *
 * `winners` 按"距出牌者的顺时针距离"升序返回 —— 顺序固定，host 与各客户端看到的数组一致，
 * 不会因为 `Map` 的插入顺序不同而分叉。
 *
 * `others` = 除赢家外的其它**非 PASS** 响应者，供上层把碰/杠作废。R-06 之后它**不再**用于
 * 写漏碰/漏胡标记（那套状态不存在）。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { ACTION_PRIORITY, type ActionType, type ClaimActionType } from './options';
import type { RuleConfig } from '../ruleConfig';

export interface ArbitrationWinner {
  seat: number;
  type: ActionType;
}

export interface ArbitrationResult {
  winners: ArbitrationWinner[];
  /** 未入选的响应者（不含 PASS），按座位号升序。 */
  others: number[];
}

function rankOf(type: ActionType): number {
  return type in ACTION_PRIORITY ? ACTION_PRIORITY[type as ClaimActionType] : -1;
}

export function arbitrate(
  triggerSeat: number,
  responses: ReadonlyMap<number, ActionType>,
  cfg: RuleConfig,
): ArbitrationResult {
  const seatCount = 4;
  const distanceOf = (seat: number): number =>
    (((seat - triggerSeat) % seatCount) + seatCount) % seatCount;

  // 距离升序 = 离出牌者越来越远；座位互不相同，所以不会有并列距离。
  const active = Array.from(responses.entries())
    .filter(([, type]) => type !== 'PASS')
    .sort(([a], [b]) => distanceOf(a) - distanceOf(b));

  if (active.length === 0) return { winners: [], others: [] };

  const topRank = Math.max(...active.map(([, type]) => rankOf(type)));
  if (topRank < 0) {
    // 全是窗口外动作（暗杠/补杠/出牌）：没有赢家，但它们确实"响"过，交给上层处理。
    return { winners: [], others: active.map(([seat]) => seat).sort((a, b) => a - b) };
  }

  const top = active.filter(([, type]) => rankOf(type) === topRank);
  const winners =
    top[0][1] === 'HU' && cfg.claim.allowMultipleHu ? top : [top[0]];

  const winnerSeats = new Set(winners.map(([seat]) => seat));
  const others = active
    .filter(([seat]) => !winnerSeats.has(seat))
    .map(([seat]) => seat)
    .sort((a, b) => a - b);

  return {
    winners: winners.map(([seat, type]) => ({ seat, type })),
    others,
  };
}
