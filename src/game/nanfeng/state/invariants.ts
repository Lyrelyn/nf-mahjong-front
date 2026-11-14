// 移植自 nf-mahjong/assets/scripts/core/state/invariants.ts（逻辑未改动）
/**
 * 全局不变量：每次状态变更前后都断言，坏状态一律在**产生它的那一次变换**上炸掉，
 * 而不是漂到几巡之后变成"分数对不上"。
 *
 * 四条检查（Global Constraints / spec §12.4），错误消息都带上具体原因，方便真机排错一眼定位：
 *   1. 每种牌的总数不得超过 4 张；
 *   2. 牌张守恒：牌墙 + 暗牌 + 副露 + 牌河 = 136；
 *   3. 手牌数符合阶段；
 *   4. 得分零和：`scores` + `roundGangScore` + 买码位的 `maScore` 合计为 0。
 *
 * 两个"张数"概念必须分清（melds.ts 的注释里也写了）：
 *   - **物理张数**（`handTileCount`，杠算 4）—— 守恒用；
 *   - **结构张数**（`effectiveHandSize`，一副露固定占 3 个位）—— 手牌数用。
 * 这是因为"杠"占 4 张实体牌但只算一组面子：手里有一个杠的人，物理上比常人多一张牌，
 * 结构上却和别人一样。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { totalCount, type Counts } from '../counts';
import { meldTileCount, type Meld } from '../melds';
import type { RuleConfig } from '../ruleConfig';
import { WALL_SIZE, type Tile } from '../tiles';
import type { HandState } from '../action/hand';
import type { GameState } from './gameState';

/** 结构张数：暗牌 + 摸到的那张 + 每副露 3 个位（杠也占 3 个位）。 */
export function effectiveHandSize(h: HandState): number {
  return totalCount(h.concealed) + (h.drawnTile === null ? 0 : 1) + 3 * h.melds.length;
}

/** 物理张数：暗牌 + 摸到的那张 + 副露实体张数（碰 3、杠 4）。 */
export function physicalHandSize(h: HandState): number {
  let n = totalCount(h.concealed) + (h.drawnTile === null ? 0 : 1);
  for (const meld of h.melds) n += meldTileCount(meld);
  return n;
}

/** 当前阶段下四家各应有多少**结构**张牌；返回 `null` 表示这个阶段不做检查。 */
function expectedHandSizes(state: GameState): number[] | null {
  const seatCount = state.hands.length;
  if (state.phase === 'WAITING_PLAY') {
    return Array.from({ length: seatCount }, (_, seat) => (seat === state.turn ? 14 : 13));
  }
  if (state.phase === 'CLAIM_WINDOW') {
    // 普通点炮窗口与抢杠窗口都是"四家各 13 张"：
    // 出牌者刚打出一张（14→13）；补杠的人把摸到的第 4 张并进副露（结构上仍是 13）。
    return Array.from({ length: seatCount }, () => 13);
  }
  return null;
}

/** 把整局里每一张牌按牌码数出来（牌墙剩余 + 四家 + 牌河）。 */
function tallyAllTiles(state: GameState): Map<Tile, number> {
  const tally = new Map<Tile, number>();
  const add = (tile: Tile, n = 1): void => {
    tally.set(tile, (tally.get(tile) ?? 0) + n);
  };

  for (let i = state.wallPos; i < state.wall.length; i++) add(state.wall[i]);
  for (const hand of state.hands) {
    const concealed: Counts = hand.concealed;
    for (let tile = 0; tile < concealed.length; tile++) {
      if (concealed[tile] > 0) add(tile, concealed[tile]);
    }
    if (hand.drawnTile !== null) add(hand.drawnTile);
    for (const meld of hand.melds as readonly Meld[]) add(meld.tile, meldTileCount(meld));
  }
  for (const pile of state.discards) for (const tile of pile) add(tile);
  // 买码的码牌是"预留"的实体牌：不在牌墙里、也不在任何手里，但必须计入守恒与逐牌上限。
  for (const tile of state.maTiles) add(tile);

  return tally;
}

export function assertInvariants(state: GameState, _cfg: RuleConfig): void {
  // 1) 逐牌上限。先查这条：它比守恒更具体，报出来的牌码直接指向出错的那张牌。
  for (const [tile, n] of tallyAllTiles(state)) {
    if (n > 4) {
      throw new RangeError(`状态不合法：牌码 ${tile} 超过 4 张（实际 ${n} 张）`);
    }
  }

  // 2) 牌张守恒
  let total = state.wall.length - state.wallPos;
  for (const hand of state.hands) total += physicalHandSize(hand);
  for (const pile of state.discards) total += pile.length;
  total += state.maTiles.length;
  if (total !== WALL_SIZE) {
    throw new RangeError(
      `状态不合法：牌张守恒被破坏（牌墙 ${state.wall.length - state.wallPos} + 暗牌副露 + 牌河 + 码牌 ${state.maTiles.length} = ${total}，应为 ${WALL_SIZE}）`,
    );
  }

  // 3) 手牌数符合阶段
  const expected = expectedHandSizes(state);
  if (expected !== null) {
    state.hands.forEach((hand, seat) => {
      const actual = effectiveHandSize(hand);
      if (actual !== expected[seat]) {
        throw new RangeError(
          `状态不合法：手牌数不符合阶段（座位 ${seat} 结构上有 ${actual} 张，${state.phase} 阶段应为 ${expected[seat]} 张）`,
        );
      }
    });
  }

  // 4) 得分零和（跨局累计得分 + 本局杠分台账 + 买码位净得分）
  const sum =
    state.scores.reduce((a, b) => a + b, 0) +
    state.roundGangScore.reduce((a, b) => a + b, 0) +
    state.maScore;
  if (sum !== 0) {
    throw new RangeError(
      `状态不合法：得分不为零（Σ scores + roundGangScore + maScore = ${sum}）`,
    );
  }
}
