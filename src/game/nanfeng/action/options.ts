// 移植自 nf-mahjong/assets/scripts/core/action/options.ts（逻辑未改动）
/**
 * 可操作项收集：一张牌打出后，算出**每个其他玩家**能做什么，供 host 开鸣牌窗口。
 *
 * 只有"有事可做"的玩家进入窗口（只能 PASS 的人不入窗，避免全桌等一个只能过的人 —— spec §6.2）。
 * 窗口内恒定带一条 `PASS`，所以 UI 永远有"过"可按。
 *
 * **只收出牌响应类操作**：`HU` / `MING_GANG` / `PENG` / `PASS`。暗杠与补杠属自己回合，不下发。
 *
 * R-06 之后这里没有任何"这一巡是否禁碰/禁胡"的判断（那套状态不存在）；`HU` 是否出现完全由
 * `canHuRon` 决定 —— 所以"十三烂字牌 5/6 张"的手牌在点炮窗口里**根本不会出现 HU 选项**（R-05）。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { canHuRon, canAnGang, canBuGang, canHuSelf, canMingGang, canPeng } from './pengGang';
import type { RuleConfig } from '../ruleConfig';
import type { Tile } from '../tiles';
import type { HandState } from './hand';

export type ActionType =
  | 'DISCARD'
  | 'PENG'
  | 'MING_GANG'
  | 'AN_GANG'
  | 'BU_GANG'
  | 'HU'
  | 'PASS';

/** 客户端上行的一个意图。**不是状态** —— 只有 host 能改状态。 */
export interface PlayerAction {
  type: ActionType;
  seat: number;
  tile: Tile | null;
  reqId: number;
}

export interface ActionOption {
  type: ActionType;
  priority: number;
  distance: number;
  /**
   * 这条动作作用于哪张牌；`PASS` 与出牌这类没有具体牌的为 `null`。
   *
   * 为什么必须带上：界面只有"类型"是不够的 —— 手里同时能暗杠 `1111` 和 `2222` 时，
   * 两条选项的 `type` 都是 `AN_GANG`，界面上就成了两个一模一样的"暗杠"按钮，
   * 而 host 收到的就是那个牌码，点错了它照做。碰/明杠看着不歧义（碰的是别人刚打的那张），
   * 但那是"碰巧不歧义"。
   */
  tile: Tile | null;
  /** 胡牌预估炮数；非 HU 选项与未提供预估时都是 `null`。 */
  huPreview: number | null;
}

/** 胡分预估：由调用方注入（计分模块在 Task 18/19 才存在，这里只留接口）。 */
export type HuPreviewProvider = (seat: number, tile: Tile) => number | null;

/**
 * 仲裁优先级（规则文档 §4，Task 0 已确认）。**只有出牌响应类操作有优先级** ——
 * 暗杠/补杠/出牌不经仲裁，所以它们不在这张表里，用 `ClaimActionType` 把这件事写进类型。
 */
export const ACTION_PRIORITY = {
  HU: 40,
  MING_GANG: 30,
  PENG: 20,
  PASS: 0,
} as const;

export type ClaimActionType = keyof typeof ACTION_PRIORITY;

/**
 * 收集窗口内每个玩家的可操作项。
 *
 * `distance` 是从出牌者往下家数的顺时针距离（1..seatCount-1）；同级优先级按它升序，即"距出牌者
 * 最近者优先"。
 */
export function collectOptions(
  triggerSeat: number,
  triggerTile: Tile,
  hands: readonly HandState[],
  cfg: RuleConfig,
  huPreview: HuPreviewProvider | null,
): Map<number, ActionOption[]> {
  const seatCount = hands.length;
  const result = new Map<number, ActionOption[]>();

  for (let distance = 1; distance < seatCount; distance++) {
    const seat = (triggerSeat + distance) % seatCount;
    const hand = hands[seat];
    const list: ActionOption[] = [];

    // 每类最多一条，所以不需要事后去重。
    if (canHuRon(hand, triggerTile, cfg)) {
      list.push({
        type: 'HU',
        priority: ACTION_PRIORITY.HU,
        distance,
        tile: triggerTile,
        huPreview: huPreview === null ? null : huPreview(seat, triggerTile),
      });
    }
    if (canMingGang(hand, triggerTile, cfg)) {
      list.push({
        type: 'MING_GANG',
        priority: ACTION_PRIORITY.MING_GANG,
        distance,
        tile: triggerTile,
        huPreview: null,
      });
    }
    if (canPeng(hand, triggerTile, cfg)) {
      list.push({
        type: 'PENG',
        priority: ACTION_PRIORITY.PENG,
        distance,
        tile: triggerTile,
        huPreview: null,
      });
    }

    if (list.length === 0) continue; // 只能 PASS 的玩家不进窗口

    list.push({
      type: 'PASS',
      priority: ACTION_PRIORITY.PASS,
      distance,
      tile: null,
      huPreview: null,
    });
    list.sort((a, b) => b.priority - a.priority || a.distance - b.distance);
    result.set(seat, list);
  }

  return result;
}

/** 一条"不经仲裁"的自家动作：没有距离可言，也没有炮数预估。 */
function ownOption(type: ActionType, tile: Tile): ActionOption {
  return { type, priority: type === 'HU' ? ACTION_PRIORITY.HU : ACTION_PRIORITY.PASS, distance: 0, tile, huPreview: null };
}

/**
 * 轮到自己出牌时的可操作项：暗杠 / 补杠 / 自摸。**出牌本身不在这里** —— 点一张牌就是出牌。
 *
 * 为什么必须由 host 算好下发、而不是客户端自己判断：`canBuGang` 要看 `justPeng`（"本巡刚碰过，
 * 不能立刻补杠同一张"），而 `justPeng` **不在公开视图里**；客户端要自己算，就得把这份规则抄第二遍，
 * 两份规则迟早不一致 —— 表现为"按钮亮着但点下去被 host 拒"。判据本来就只有一个（引擎），
 * 那就让它只算一次。
 *
 * 排序：HU 排在前面（优先级 40 > 0），杠类按牌码升序、同码先暗杠后补杠。`Array.sort` 是稳定的，
 * 所以"入列顺序"就是同优先级下的次序 —— 这里入列顺序本身是确定的，不依赖实现细节。
 */
export function ownTurnOptions(hand: HandState, cfg: RuleConfig): ActionOption[] {
  const list: ActionOption[] = [];
  // 自摸那条的 tile 是刚摸到的那张 —— 计分要用它，界面上也是"胡这张"的意思。
  if (canHuSelf(hand, cfg) && hand.drawnTile !== null) {
    list.push(ownOption('HU', hand.drawnTile));
  }

  for (let tile = 11; tile < hand.concealed.length; tile++) {
    if (canAnGang(hand, tile as Tile, cfg, true)) {
      list.push(ownOption('AN_GANG', tile as Tile));
    }
    if (canBuGang(hand, tile as Tile, cfg, true)) {
      list.push(ownOption('BU_GANG', tile as Tile));
    }
  }

  return list.sort((a, b) => b.priority - a.priority);
}
