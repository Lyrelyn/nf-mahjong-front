// 移植自 nf-mahjong/assets/scripts/core/state/phase.ts（逻辑未改动）
/**
 * 牌局阶段与"每个阶段允许哪些动作"。
 *
 * `LEGAL_ACTIONS` 是 `applyAction` 的第一道闸：任何不在表里的动作直接拒绝。
 * 表里只写**客户端能发起的意图**；`DRAW` / `DEAL` 这种 host 内部推进不是动作，不在表里。
 *
 * 注意 `CLAIM_WINDOW` 里的 `MING_GANG` 只在"别人打出的牌"上成立；"抢杠窗口"里
 * 只允许 `HU` / `PASS`，那一条由 `applyAction` 按 `claim.gangSeat` 额外把关（见 state/apply.ts）。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import type { ActionType } from '../action/options';

export type Phase =
  | 'LOBBY'
  | 'DEALING'
  | 'WAITING_PLAY'
  | 'CLAIM_WINDOW'
  | 'GANG_DRAW'
  | 'SETTLING'
  | 'ENDED';

export const LEGAL_ACTIONS: Record<Phase, readonly ActionType[]> = {
  LOBBY: [],
  DEALING: [],
  WAITING_PLAY: ['DISCARD', 'AN_GANG', 'BU_GANG', 'HU'],
  CLAIM_WINDOW: ['PENG', 'MING_GANG', 'HU', 'PASS'],
  GANG_DRAW: [],
  SETTLING: [],
  ENDED: [],
};
