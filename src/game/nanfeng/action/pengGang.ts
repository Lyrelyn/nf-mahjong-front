// 移植自 nf-mahjong/assets/scripts/core/action/pengGang.ts（逻辑未改动）
/**
 * 碰 / 杠 / 胡的合法性判定。
 *
 * 全部是**纯谓词**：只看手牌与配置，不看阶段、不看谁在等谁。阶段相关的事由调用方显式传进来
 * （`ownTurn`）或由状态机把关 —— 这样每条规则都能单独写单测，包括"越权调用应当返回 false"。
 *
 * R-06 之后这里**没有禁碰 / 禁胡状态**：漏了随时能碰、随时能胡，也不需要"摸牌后清除标记"。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { judgeHu } from '../hu/huJudge';
import { requiresSelfDraw } from '../hu/shiSanLan';
import type { Counts } from '../counts';
import type { RuleConfig } from '../ruleConfig';
import type { Tile } from '../tiles';
import type { HandState } from './hand';

function withTile(counts: Counts, tile: Tile): Counts {
  const c = counts.slice();
  c[tile] += 1;
  return c;
}

/** 手里的全部暗牌：`concealed` + 刚摸到的那张。 */
function fullCounts(h: HandState): Counts {
  return h.drawnTile === null ? h.concealed : withTile(h.concealed, h.drawnTile);
}

/** 某张牌在"暗牌 + 刚摸到的"里共有几张。 */
function concealedCopies(h: HandState, tile: Tile): number {
  return h.concealed[tile] + (h.drawnTile === tile ? 1 : 0);
}

/** 碰：手里至少 2 张。 */
export function canPeng(h: HandState, tile: Tile, _cfg: RuleConfig): boolean {
  return h.concealed[tile] >= 2;
}

/** 明杠（直杠）：手里至少 3 张。 */
export function canMingGang(h: HandState, tile: Tile, _cfg: RuleConfig): boolean {
  return h.concealed[tile] >= 3;
}

/** 暗杠：手里**正好** 4 张，且必须轮到自己。 */
export function canAnGang(h: HandState, tile: Tile, _cfg: RuleConfig, ownTurn: boolean): boolean {
  return ownTurn && h.concealed[tile] === 4;
}

/**
 * 补杠（弯杠）：碰过这张、手里还有第 4 张（通常是刚摸上来的那张），且必须轮到自己。
 * `justPeng` 为真表示本巡刚碰过 —— 碰完不能立刻补杠同一张。
 */
export function canBuGang(h: HandState, tile: Tile, _cfg: RuleConfig, ownTurn: boolean): boolean {
  if (!ownTurn || h.justPeng) return false;
  const penged = h.melds.some((m) => m.kind === 'PENG' && m.tile === tile);
  return penged && concealedCopies(h, tile) >= 1;
}

/**
 * 这手牌能否按 `zimo` 的方式胡。
 *
 * 两条与"怎么胡"有关的规则在这里落地：
 *   - **假胡的点炮开关**（`hu.jiaHu.allowRon`）：`structure === 'NONE'` 说明这手牌只有假胡标签，
 *     开关为假时点炮拒胡、自摸照常（R-03）。
 *   - **十三烂的自摸限制**（R-05）：字牌 5 / 6 张时只能自摸 —— 这是胡牌合法性限制，不只是计分。
 *     判定要用**并入待胡那张牌之后**的 14 张手牌，所以放在这里而不是判胡主干里。
 */
function isWinningHand(h: HandState, counts: Counts, cfg: RuleConfig, zimo: boolean): boolean {
  const result = judgeHu(counts, h.melds, cfg);
  if (result.tags.size === 0) return false;
  if (zimo) return true;
  if (result.structure === 'NONE' && !cfg.hu.jiaHu.allowRon) return false;
  return !requiresSelfDraw(counts);
}

/** 自摸：手里已经是成胡的 14 张。 */
export function canHuSelf(h: HandState, cfg: RuleConfig): boolean {
  return isWinningHand(h, fullCounts(h), cfg, true);
}

/** 点炮 / 抢杠：把别人打出的那张并进来，看是否成胡。 */
export function canHuRon(h: HandState, tile: Tile, cfg: RuleConfig): boolean {
  return isWinningHand(h, withTile(fullCounts(h), tile), cfg, false);
}
