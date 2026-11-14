// 移植自 nf-mahjong/sim/randomAgent.ts（逻辑未改动）
/**
 * 无头随机对局（fuzz）：不需要网络、不需要 UI，却能覆盖绝大部分规则 bug。
 *
 * 策略：每个决策点从**该阶段该座位真正合法的动作**里随机挑一个（含 `PASS`），一路跑到底。
 * 每次 `applyAction` 内部都会断言全局不变量（Task 17），所以"跑不崩"本身就等于"不变量恒成立"。
 *
 * **完全确定性**：所有随机都来自注入的 `Rng`，同一个 seed 一定跑出同一局 —— fuzz 挂了就把 seed
 * 抄进用例复现。
 *
 * 本文件不在 `assets/scripts/core/**` 里（不是引擎代码），但同样不碰时钟与全局随机。
 */

import { canAnGang, canBuGang, canHuSelf } from '../action/pengGang';
import type { PlayerAction } from '../action/options';
import { createRng, type Rng } from '../prng';
import { tagKey } from '../fanTags';
import type { Counts } from '../counts';
import type { RuleConfig } from '../ruleConfig';
import { applyAction } from '../state/apply';
import {
  nextRoundSeating,
  startRound,
  type GameState,
  type RoundOutcome,
} from '../state/gameState';
import type { Tile } from '../tiles';

const SEATS = ['a', 'b', 'c', 'd'] as const;
const HOST_SEAT = 0;
/** 一局最多走多少步；超了就是死循环，宁可报错也不要挂住。 */
const MAX_STEPS_PER_ROUND = 3000;
/** 时间推进的步长（毫秒）。引擎不看时钟，`now` 只用来算窗口截止时间。 */
const STEP_MS = 100;

export interface GameSummary {
  rounds: number;
  ok: true;
  /** 结局摘要（局数 / 分数 / 动作数 / 胡与荒庄次数），用来验证"同一 seed 完全一致"。 */
  digest: string;
}

export interface Stats {
  hu: number;
  huangZhuang: number;
  rounds: number;
}

interface SimResult extends Stats {
  digest: string;
}

/**
 * 这张牌是不是"孤张"：手里只 1 张，而且同花色左右两格内都没有邻牌。
 *
 * 字牌只看张数 —— 单张字牌既不能成顺也不能成刻，一律算孤张。
 */
function isIsolated(concealed: Counts, tile: Tile): boolean {
  if (concealed[tile] > 1) return false;
  if (tile >= 41) return true;
  const base = Math.floor(tile / 10) * 10;
  const rank = tile % 10;
  for (let delta = -2; delta <= 2; delta++) {
    if (delta === 0) continue;
    const neighbour = rank + delta;
    if (neighbour < 1 || neighbour > 9) continue;
    if (concealed[base + neighbour] > 0) return false;
  }
  return true;
}

/** 在给定的状态上挑一个合法动作；没有合法动作时返回 `null`。 */
export function chooseAction(
  state: GameState,
  cfg: RuleConfig,
  rng: Rng,
  now: number,
): PlayerAction | null {
  if (state.phase === 'CLAIM_WINDOW') {
    const claim = state.claim;
    if (claim === null) return null;
    const seat = claim.pending[Math.floor(rng.next() * claim.pending.length)];
    const options = claim.options.get(seat) ?? [];
    if (options.length === 0) return null;
    const pick = options[Math.floor(rng.next() * options.length)];
    return {
      type: pick.type,
      seat,
      tile: pick.type === 'PASS' ? null : claim.triggerTile,
      reqId: now,
    };
  }

  if (state.phase !== 'WAITING_PLAY') return null;

  const seat = state.turn;
  const hand = state.hands[seat];
  const candidates: PlayerAction[] = [];

  if (canHuSelf(hand, cfg)) candidates.push({ type: 'HU', seat, tile: null, reqId: now });

  const probed: Tile[] = [];
  for (let tile = 0; tile < hand.concealed.length; tile++) {
    if (hand.concealed[tile] > 0) probed.push(tile);
  }
  if (hand.drawnTile !== null) probed.push(hand.drawnTile);
  for (const tile of probed) {
    if (canAnGang(hand, tile, cfg, true)) {
      candidates.push({ type: 'AN_GANG', seat, tile, reqId: now });
    }
    if (canBuGang(hand, tile, cfg, true)) {
      candidates.push({ type: 'BU_GANG', seat, tile, reqId: now });
    }
  }

  // 出牌：手里任意一张都合法，但**优先打孤张**。
  //
  // 为什么要有这个偏好：纯随机出牌几乎不可能成牌，实测胡 1% / 荒庄 99% —— 那样 fuzz 只压得实
  // "荒庄"一条路，判胡 → 计分 → 结算整条路径几乎没被覆盖。优先打孤张会保留对子与搭子，
  // 胡牌率抬到两位数百分比，Phase 4 才算真的"实用检查点"。
  const held: Tile[] = [];
  for (let tile = 0; tile < hand.concealed.length; tile++) {
    for (let k = 0; k < hand.concealed[tile]; k++) held.push(tile);
  }
  if (hand.drawnTile !== null) held.push(hand.drawnTile);

  const isolated = held.filter((tile) => isIsolated(hand.concealed, tile));
  const pool = isolated.length > 0 ? isolated : held;
  if (pool.length > 0) {
    candidates.push({
      type: 'DISCARD',
      seat,
      tile: pool[Math.floor(rng.next() * pool.length)],
      reqId: now,
    });
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng.next() * candidates.length)];
}

/** 跑完一局，返回终局状态与本局结局（结局用来算下一局谁坐庄）。 */
function playRound(
  initial: GameState,
  cfg: RuleConfig,
  rng: Rng,
  startAt: number,
): { state: GameState; outcome: RoundOutcome; steps: number; now: number } {
  let state = initial;
  let now = startAt;
  let steps = 0;

  while (steps < MAX_STEPS_PER_ROUND) {
    const action = chooseAction(state, cfg, rng, now);
    if (action === null) {
      throw new Error(`无合法动作可走：phase=${state.phase}，turn=${state.turn}`);
    }
    const result = applyAction(state, action, cfg, now);
    state = result.state;
    steps += 1;
    now += STEP_MS;

    const ending = result.events.find(
      (e) => e.type === 'HU' || e.type === 'QIANG_GANG_HU' || e.type === 'HUANG_ZHUANG',
    );
    if (ending === undefined) continue;

    if (ending.type === 'HUANG_ZHUANG') {
      return { state, outcome: { kind: 'HUANG_ZHUANG' }, steps, now };
    }
    if (ending.type === 'HU') {
      return {
        state,
        outcome: { kind: 'HU', winners: ending.winners, loserSeat: ending.loserSeat },
        steps,
        now,
      };
    }
    // 抢杠胡：补杠那一家是唯一付款方（Q-02）
    return {
      state,
      outcome: { kind: 'HU', winners: ending.winners, loserSeat: ending.gangSeat },
      steps,
      now,
    };
  }

  throw new Error(`一局步数超过 ${MAX_STEPS_PER_ROUND} —— 疑似死循环：phase=${state.phase}`);
}

function simulate(seed: number, cfg: RuleConfig, maxRounds: number, seenTags?: Set<string>): SimResult {
  const rng = createRng(seed);
  let dealer = HOST_SEAT; // Q-06：第一局房主坐庄
  let state = startRound({
    seats: [...SEATS],
    dealer,
    cfg,
    rng,
    round: 1,
    hostId: SEATS[HOST_SEAT],
    epoch: 1,
  });

  let hu = 0;
  let huangZhuang = 0;
  let steps = 0;
  let now = 1000;
  let rounds = 1;

  for (let index = 0; index < maxRounds; index++) {
    const played = playRound(state, cfg, rng, now);
    state = played.state;
    steps += played.steps;
    now = played.now;
    rounds = index + 1;
    if (played.outcome.kind === 'HUANG_ZHUANG') huangZhuang += 1;
    else hu += 1;

    // 记下这一局出现过的番型标签组合。**这是"计分表的可达/不可达标注对不对"的唯一实测依据**
    // —— 那一列原来是手写判断，没有任何东西核对过它。
    if (seenTags !== undefined) {
      for (const detail of state.lastSettle?.detail ?? []) {
        if (detail.tags.length > 0) seenTags.add(tagKey(detail.tags));
      }
    }

    if (index === maxRounds - 1) break;
    const seating = nextRoundSeating(state, played.outcome);
    dealer = seating.dealer;
    state = startRound({
      seats: [...SEATS],
      dealer,
      cfg,
      rng,
      round: rounds + 1,
      hostId: SEATS[HOST_SEAT],
      epoch: 1,
    });
  }

  return {
    hu,
    huangZhuang,
    rounds,
    digest: `rounds=${rounds} hu=${hu} hz=${huangZhuang} steps=${steps} scores=${state.scores.join(',')}`,
  };
}

/** 跑一局（默认 3 圈）。同一 seed 的结果必须完全一致。 */
export function runOneGame(seed: number, cfg: RuleConfig, maxRounds = 3): GameSummary {
  const r = simulate(seed, cfg, maxRounds);
  return { rounds: r.rounds, ok: true, digest: r.digest };
}

/**
 * 跑 `n` 局，统计失败局数与**第一个失败**（带 seed，方便直接复现）。
 * 不抛异常 —— fuzz 的价值在于"跑完再报告"，而不是在第一个失败上停住。
 */
export function runManyGames(
  n: number,
  cfg: RuleConfig,
  maxRounds = 3,
): { games: number; failed: number; firstFailure: unknown } {
  let failed = 0;
  let firstFailure: unknown = null;
  for (let seed = 1; seed <= n; seed++) {
    try {
      simulate(seed, cfg, maxRounds);
    } catch (error) {
      failed += 1;
      if (firstFailure === null) {
        firstFailure = { seed, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  return { games: n, failed, firstFailure };
}

/** 统计覆盖率：胡了多少次、荒庄多少次 —— 用来确认 fuzz 不是在空转。 */
export function runStats(n: number, cfg: RuleConfig, maxRounds = 1): Stats {
  let hu = 0;
  let huangZhuang = 0;
  let rounds = 0;
  for (let seed = 1; seed <= n; seed++) {
    const r = simulate(seed, cfg, maxRounds);
    hu += r.hu;
    huangZhuang += r.huangZhuang;
    rounds += r.rounds;
  }
  return { hu, huangZhuang, rounds };
}

/**
 * 跑 `n` 局，收集**每一种出现过的番型标签组合**（`tagKey` 口径，去重）。
 *
 * 用途：核对 `docs/score-table-review.md` 的"可达性"那一列。它原来是手写的五条论断、
 * 没有任何东西核对过 —— 于是"文档说这组标签不可能同时出现，而判胡主干恰恰会产出它"这种
 * 矛盾可以一直躺着。有了这个函数就能拿真局去撞：**产出的每一个键都必须落在标了"可达"的行上**。
 *
 * `keys` 是排序过的（稳定输出，便于 diff 与写入报告）。
 */
export function runTagKeys(
  n: number,
  cfg: RuleConfig,
  maxRounds = 1,
): { keys: string[]; hu: number; huangZhuang: number } {
  const seen = new Set<string>();
  let hu = 0;
  let huangZhuang = 0;
  for (let seed = 1; seed <= n; seed++) {
    const r = simulate(seed, cfg, maxRounds, seen);
    hu += r.hu;
    huangZhuang += r.huangZhuang;
  }
  return { keys: [...seen].sort(), hu, huangZhuang };
}
