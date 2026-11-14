// 移植自 nf-mahjong/assets/scripts/core/action/hand.ts（逻辑未改动）
/**
 * 手牌结构 `HandState` 与手牌操作。
 *
 * 不可变风格（计划 Task 11 Step 3）：`addTile` / `removeTile` / `addMeld` 都返回**新的** `HandState`，
 * 不改动入参。这让回放、撤销与"先算一遍看结果"都能直接做 —— 状态机的 `apply` 因此可以写成
 * "算出新状态，校验不变量，失败就整个丢掉"，不会污染原状态。
 *
 * 张数口径：`concealed` 只放**暗牌**，刚摸到的那张单独记在 `drawnTile` 上（庄家开局即 13 + 1 = 14），
 * 副露按 `meldTileCount` 折算（碰 3、三种杠 4）。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { countsOf, totalCount, type Counts } from '../counts';
import { meldTileCount, type Meld } from '../melds';
import type { RuleConfig } from '../ruleConfig';
import { COUNT_SIZE, type Tile } from '../tiles';

export interface HandState {
  /** 暗牌计数（**不含** `drawnTile`，也不含副露）。长度 `COUNT_SIZE`。 */
  concealed: Counts;
  /** 已经亮出来的碰与杠。 */
  melds: Meld[];
  /** 刚摸到、还没打出的那张牌；不在摸牌阶段时为 `null`。 */
  drawnTile: Tile | null;
  /** 本巡是否刚碰过 —— 碰后不能立即补杠。 */
  justPeng: boolean;
}

export function createHand(): HandState {
  return { concealed: countsOf([]), melds: [], drawnTile: null, justPeng: false };
}

/** 手牌张数 = 暗牌 + 摸到的那张 + 副露折算。 */
export function handTileCount(h: HandState): number {
  let n = totalCount(h.concealed) + (h.drawnTile === null ? 0 : 1);
  for (const meld of h.melds) n += meldTileCount(meld);
  return n;
}

export function addTile(h: HandState, tile: Tile): HandState {
  const concealed = h.concealed.slice();
  concealed[tile] += 1;
  return { ...h, concealed };
}

export function removeTile(h: HandState, tile: Tile): HandState {
  if (h.concealed[tile] === 0) {
    throw new RangeError(`手牌里没有 ${tile} 这张牌，不能移除`);
  }
  const concealed = h.concealed.slice();
  concealed[tile] -= 1;
  return { ...h, concealed };
}

export function addMeld(h: HandState, meld: Meld): HandState {
  return { ...h, melds: [...h.melds, meld] };
}

/**
 * 手牌级不变量：**同一种牌的总数不得超过 4 张**（暗牌 + `drawnTile` + 全部副露一起算）。
 *
 * 这里**故意不检查"手牌张数符合阶段"** —— 那是状态级的不变量，由 Task 17 的 `assertInvariants`
 * 负责（它才知道当前 `Phase`）。所以本函数只做与阶段无关的逐牌上限检查，入参 `cfg` 暂时不用，
 * 保留在签名里是为了 Task 17 直接透传配置、不必改调用点。
 */
export function assertHandInvariants(h: HandState, _cfg: RuleConfig): void {
  for (let t = 0; t < COUNT_SIZE; t++) {
    let n = h.concealed[t];
    if (h.drawnTile === t) n += 1;
    for (const meld of h.melds) {
      if (meld.tile === t) n += meldTileCount(meld);
    }
    if (n > 4) {
      throw new RangeError(`手牌不合法：牌码 ${t} 超过 4 张（实际 ${n} 张）`);
    }
  }
}
