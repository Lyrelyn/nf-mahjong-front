// 移植自 nf-mahjong/assets/scripts/core/state/apply.ts（逻辑未改动）
/**
 * `applyAction`：状态机的唯一入口。纯函数 —— 返回**新的** `GameState` 与一串事件，
 * 绝不改动传入的状态（所以"算完发现不合法就整个丢掉"是安全的）。
 *
 * 三条贯穿全文件的约定：
 *   1. **先校验再变状态**：阶段、座位、动作合法性任一不满足就抛错，不产生半成品状态。
 *   2. **摸牌必须显式判定荒庄**：`wallPos >= wall.length` → `SETTLING` + `HUANG_ZHUANG` 事件。
 *      绝不靠"下家摸不到牌抛异常"来兜底（那会变成死循环或崩溃）。
 *   3. **杠分即时入账**：直杠/暗杠当场记账；**补杠要等抢杠窗口关闭**才记（被抢则一分不计）。
 *      `roundGangScore` 自身永远零和。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { addMeld, addTile, removeTile, type HandState } from '../action/hand';
import { arbitrate } from '../action/arbiter';
import {
  ACTION_PRIORITY,
  collectOptions,
  type ActionOption,
  type PlayerAction,
} from '../action/options';
import { canAnGang, canBuGang, canHuRon, canHuSelf } from '../action/pengGang';
import { judgeHu } from '../hu/huJudge';
import { isPengPengHuDanDiao } from '../hu/decompose';
import { settleRound, type FanDetail, type MaDetail } from '../score/settle';
import type { FanTag } from '../fanTags';
import type { Meld, MeldKind } from '../melds';
import type { RuleConfig } from '../ruleConfig';
import type { Tile } from '../tiles';
import {
  cloneOutcome,
  handCountsOf,
  type ClaimState,
  type GangFlow,
  type GameState,
  type RoundOutcome,
  type RoundWinner,
} from './gameState';
import { assertInvariants } from './invariants';
import { LEGAL_ACTIONS, type Phase } from './phase';

export type GameEvent =
  | { type: 'DRAW'; seat: number; tile: Tile }
  | { type: 'DISCARD'; seat: number; tile: Tile }
  | { type: 'PENG'; seat: number; tile: Tile }
  | { type: 'GANG'; seat: number; gangKind: MeldKind; tile: Tile }
  | { type: 'HU'; winners: RoundWinner[]; loserSeat: number | null }
  | { type: 'QIANG_GANG_HU'; winners: RoundWinner[]; gangSeat: number }
  | { type: 'SETTLE'; deltas: number[]; detail: FanDetail[]; maDelta: number; maDetail: MaDetail[] }
  | { type: 'HUANG_ZHUANG' };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

function fail(msg: string): never {
  throw new Error(msg);
}

function assertPhase(state: GameState, phase: Phase): void {
  if (state.phase !== phase) {
    const legal = LEGAL_ACTIONS[state.phase];
    fail(
      `阶段 ${state.phase} 不接受该动作（要求 ${phase}；当前阶段合法动作：${legal.length ? legal.join('、') : '无'}）`,
    );
  }
}

function assertTurn(state: GameState, seat: number): void {
  if (seat !== state.turn) fail(`不是你的回合：现在轮到座位 ${state.turn}，收到座位 ${seat}`);
}

function setHand(state: GameState, seat: number, hand: HandState): GameState {
  const hands = state.hands.slice();
  hands[seat] = hand;
  return { ...state, hands };
}

/** 记录一次 host 内部推进（摸牌等）：**不**递增 seq，沿用当前 seq。 */
function logInternal(
  state: GameState,
  entry: { type: 'DEAL' | 'DRAW'; seat: number; tile: Tile | null },
): GameState {
  return {
    ...state,
    actionLog: [...state.actionLog, { seq: state.seq, ...entry }],
  };
}

/** 接受一次客户端动作：seq +1，动作入日志。 */
function acceptAction(state: GameState, action: PlayerAction): GameState {
  const seq = state.seq + 1;
  return {
    ...state,
    seq,
    actionLog: [...state.actionLog, { seq, type: action.type, seat: action.seat, tile: action.tile }],
  };
}

/**
 * 结算并把结果落进累计分，**同时把明细存进 `lastSettle`**。
 *
 * `deltas` 里已经含了本局杠分，所以落账后必须**把本局台账清零** —— 否则同一笔杠分会被算两次，
 * 而且 `Σ(scores + roundGangScore) === 0` 这条不变量立刻就不成立了。
 *
 * 存进状态的那一份是**拷贝**：事件里的数组也交给调用方，两边共用同一个引用的话，
 * 谁改一下都会让另一边的账目跟着变。
 */
function settleInto(
  state: GameState,
  outcome: RoundOutcome,
  cfg: RuleConfig,
): { state: GameState; deltas: number[]; detail: FanDetail[]; maDelta: number; maDetail: MaDetail[] } {
  const { deltas, detail, maDelta, maDetail } = settleRound(state, outcome, cfg);
  return {
    state: {
      ...state,
      scores: state.scores.map((v, i) => v + deltas[i]),
      // 杠分与买码的流水都已并进 deltas / maDelta，台账清零，否则会被算两次
      roundGangScore: state.roundGangScore.map(() => 0),
      roundGangFlows: [],
      maScore: state.maScore + maDelta,
      lastSettle: {
        deltas: [...deltas],
        detail: detail.map((d) => ({ ...d, tags: [...d.tags] })),
        maDelta,
        maDetail: maDetail.map((d) => ({ ...d })),
      },
      // 胜负结果与账目一起留下：下一局谁坐庄、谁下场要的是"因"而不是"账"，
      // 而"放炮的是谁"在 FanDetail 里根本没有。
      lastOutcome: cloneOutcome(outcome),
    },
    deltas,
    detail,
    maDelta,
    maDetail,
  };
}

/**
 * 给 `seat` 摸一张；牌墙空了就是荒庄。`fromGang` 决定"杠上开花"。
 *
 * **手里已经有一张摸到的牌时必须先把它并进 `concealed`**：开杠之后补牌就属于这种情况
 * （杠吃掉的是暗牌，原来的摸牌还在手上）。直接覆盖 `drawnTile` 会凭空少一张牌、破坏守恒。
 */
function drawFor(
  state: GameState,
  seat: number,
  cfg: RuleConfig,
  events: GameEvent[],
  fromGang: boolean,
): ApplyResult {
  if (state.wallPos >= state.wall.length) {
    const settled = settleInto(
      { ...state, phase: 'SETTLING', claim: null, drawnFromGang: false },
      { kind: 'HUANG_ZHUANG' },
      cfg,
    );
    return {
      state: settled.state,
      events: [
        ...events,
        { type: 'HUANG_ZHUANG' },
        { type: 'SETTLE', deltas: settled.deltas, detail: settled.detail, maDelta: settled.maDelta, maDetail: settled.maDetail },
      ],
    };
  }
  const tile = state.wall[state.wallPos];
  const hand = state.hands[seat];
  const base: HandState =
    hand.drawnTile === null ? hand : addTile({ ...hand, drawnTile: null }, hand.drawnTile);

  const advanced: GameState = {
    ...state,
    wallPos: state.wallPos + 1,
    phase: 'WAITING_PLAY',
    turn: seat,
    claim: null,
    drawnFromGang: fromGang,
  };
  const next = setHand(advanced, seat, { ...base, drawnTile: tile, justPeng: false });
  return {
    state: logInternal(next, { type: 'DRAW', seat, tile }),
    events: [...events, { type: 'DRAW', seat, tile }],
  };
}

/** 出牌后无人响应（或窗口全过）→ 下家摸牌。 */
function advanceTurn(state: GameState, cfg: RuleConfig, events: GameEvent[]): ApplyResult {
  const next = (state.turn + 1) % state.hands.length;
  return drawFor({ ...state, turn: next }, next, cfg, events, false);
}

/** 从牌河末尾拿走刚被打出的那张（碰/明杠把它变成了副露，不能既算牌河又算副露）。 */
function takeFromDiscards(
  discards: readonly Tile[][],
  seat: number,
  tile: Tile,
): Tile[][] {
  const pile = discards[seat];
  if (pile.length === 0 || pile[pile.length - 1] !== tile) {
    fail(`牌河里没有可被拿走的那张 ${tile}（座位 ${seat}）`);
  }
  return discards.map((p, i) => (i === seat ? p.slice(0, -1) : p));
}

// ---------------------------------------------------------------------------
// 自己回合的动作
// ---------------------------------------------------------------------------

function applyDiscard(
  state: GameState,
  action: PlayerAction,
  cfg: RuleConfig,
  now: number,
): ApplyResult {
  assertPhase(state, 'WAITING_PLAY');
  assertTurn(state, action.seat);
  const tile = action.tile;
  if (tile === null) fail('出牌必须带 tile');

  const hand = state.hands[action.seat];
  if (hand.concealed[tile] + (hand.drawnTile === tile ? 1 : 0) === 0) {
    fail(`手牌里没有 ${tile} 这张牌，不能打出`);
  }

  let next: HandState =
    hand.drawnTile === tile ? { ...hand, drawnTile: null } : removeTile(hand, tile);
  next = { ...next, justPeng: false };

  const discards = state.discards.map((pile, seat) =>
    seat === action.seat ? [...pile, tile] : pile,
  );
  const s = acceptAction(
    setHand(
      {
        ...state,
        discards,
        lastDiscard: { seat: action.seat, tile },
        drawnFromGang: false,
      },
      action.seat,
      next,
    ),
    action,
  );

  const events: GameEvent[] = [{ type: 'DISCARD', seat: action.seat, tile }];

  const options = collectOptions(action.seat, tile, s.hands, cfg, null);
  if (options.size === 0) return advanceTurn(s, cfg, events);

  const claim: ClaimState = {
    triggerSeat: action.seat,
    triggerTile: tile,
    gangSeat: null,
    pending: Array.from(options.keys()),
    options,
    responses: new Map(),
    deadlineAt: now + cfg.claim.windowMs,
  };
  return { state: { ...s, phase: 'CLAIM_WINDOW', claim }, events };
}

/**
 * 三家各付的杠分现金流（暗杠 / 补杠）：其余每家各付 `amount` 给 `seat`。
 *
 * 与 `roundGangScore` **同源写入**：净额给账，流向给买码（明杠是不对称收支，净额还原不出流向）。
 */
function threeWayGangFlows(state: GameState, seat: number, amount: number): GangFlow[] {
  const flows: GangFlow[] = [];
  for (let payer = 0; payer < state.hands.length; payer++) {
    if (payer !== seat) flows.push({ payer, payee: seat, amount });
  }
  return flows;
}

function applyAnGang(state: GameState, action: PlayerAction, cfg: RuleConfig): ApplyResult {
  assertPhase(state, 'WAITING_PLAY');
  assertTurn(state, action.seat);
  const tile = action.tile;
  if (tile === null) fail('杠必须带 tile');

  const hand = state.hands[action.seat];
  if (!canAnGang(hand, tile, cfg, true)) {
    fail(`座位 ${action.seat} 不能暗杠 ${tile}（手里需要正好 4 张）`);
  }

  let next = hand;
  for (let i = 0; i < 4; i++) next = removeTile(next, tile);
  next = addMeld(next, { kind: 'AN_GANG', tile, fromSeat: null });

  const each = cfg.score.gang.anGang;
  const roundGangScore = state.roundGangScore.map((v, i) =>
    i === action.seat ? v + 3 * each : v - each,
  );
  const roundGangFlows = [...state.roundGangFlows, ...threeWayGangFlows(state, action.seat, each)];
  const s = acceptAction(
    setHand({ ...state, roundGangScore, roundGangFlows }, action.seat, next),
    action,
  );
  return drawFor(s, action.seat, cfg, [{ type: 'GANG', seat: action.seat, gangKind: 'AN_GANG', tile }], true);
}

function applyBuGang(
  state: GameState,
  action: PlayerAction,
  cfg: RuleConfig,
  now: number,
): ApplyResult {
  assertPhase(state, 'WAITING_PLAY');
  assertTurn(state, action.seat);
  const tile = action.tile;
  if (tile === null) fail('杠必须带 tile');

  const hand = state.hands[action.seat];
  if (!canBuGang(hand, tile, cfg, true)) {
    fail(`座位 ${action.seat} 不能补杠 ${tile}（要碰过这张、手里还有第 4 张，且本巡没刚碰过）`);
  }

  const melds: Meld[] = hand.melds.map((m) =>
    m.kind === 'PENG' && m.tile === tile ? { kind: 'BU_GANG', tile, fromSeat: null } : m,
  );
  let next: HandState = { ...hand, melds };
  next = next.drawnTile === tile ? { ...next, drawnTile: null } : removeTile(next, tile);

  const s = acceptAction(setHand(state, action.seat, next), action);
  const events: GameEvent[] = [
    { type: 'GANG', seat: action.seat, gangKind: 'BU_GANG', tile },
  ];

  const options = qiangGangOptions(s, action.seat, tile, cfg);
  if (options.size === 0) {
    // 没人能抢 → 立刻入账，然后照常补一张（杠吃掉一张手牌，所以要补回来）
    const credited = creditBuGangScore(s, action.seat, cfg);
    return drawFor(credited, action.seat, cfg, events, true);
  }

  const claim: ClaimState = {
    triggerSeat: action.seat,
    triggerTile: tile,
    gangSeat: action.seat,
    pending: Array.from(options.keys()),
    options,
    responses: new Map(),
    deadlineAt: now + cfg.claim.windowMs,
  };
  return { state: { ...s, phase: 'CLAIM_WINDOW', claim, turn: action.seat }, events };
}

/**
 * 补杠入账：三家各付 `buGang`，开杠者 +3×。
 *
 * **只记账**，不动阶段 —— 入账与"补一张"是两件事，被抢杠时前者要撤销、后者压根不发生。
 */
function creditBuGangScore(state: GameState, seat: number, cfg: RuleConfig): GameState {
  const each = cfg.score.gang.buGang;
  const roundGangScore = state.roundGangScore.map((v, i) =>
    i === seat ? v + 3 * each : v - each,
  );
  const roundGangFlows = [...state.roundGangFlows, ...threeWayGangFlows(state, seat, each)];
  return { ...state, roundGangScore, roundGangFlows, claim: null, turn: seat };
}

/** 抢杠窗口只允许"胡"与"过"，所以不能复用 `collectOptions`（那会给出碰/明杠）。 */
function qiangGangOptions(
  state: GameState,
  gangSeat: number,
  tile: Tile,
  cfg: RuleConfig,
): Map<number, ActionOption[]> {
  const result = new Map<number, ActionOption[]>();
  const seatCount = state.hands.length;
  for (let distance = 1; distance < seatCount; distance++) {
    const seat = (gangSeat + distance) % seatCount;
    if (!canHuRon(state.hands[seat], tile, cfg)) continue;
    result.set(seat, [
      { type: 'HU', priority: ACTION_PRIORITY.HU, distance, tile, huPreview: null },
      { type: 'PASS', priority: ACTION_PRIORITY.PASS, distance, tile: null, huPreview: null },
    ]);
  }
  return result;
}

function applyZimo(state: GameState, action: PlayerAction, cfg: RuleConfig): ApplyResult {
  assertPhase(state, 'WAITING_PLAY');
  assertTurn(state, action.seat);

  const hand = state.hands[action.seat];
  if (!canHuSelf(hand, cfg)) fail(`座位 ${action.seat} 的手牌按自摸不成胡`);

  const gangShang = state.drawnFromGang;
  const counts = handCountsOf(hand);
  const tags: FanTag[] = [...judgeHu(counts, hand.melds, cfg).tags];
  // 单钓将取决于"胡的是哪张"，而 judgeHu 只看到成牌形，所以标签在这里补
  // （同一个 14 张形既可能是单钓来的、也可能是对倒来的）。
  if (hand.drawnTile !== null && isPengPengHuDanDiao(counts, hand.melds.length, hand.drawnTile)) {
    tags.push('PENG_PENG_HU_DAN_DIAO');
  }
  if (gangShang) tags.push('GANG_SHANG_KAI_HUA');

  const winner: RoundWinner = {
    seat: action.seat,
    zimo: true,
    gangShang,
    qiangGang: false,
    tags,
  };
  const outcome: RoundOutcome = {
    kind: 'HU',
    winners: [winner],
    loserSeat: null,
  };
  const s = acceptAction({ ...state, phase: 'SETTLING', claim: null, drawnFromGang: false }, action);
  const settled = settleInto(s, outcome, cfg);
  return {
    state: settled.state,
    events: [
      { type: 'HU', winners: [winner], loserSeat: null },
      { type: 'SETTLE', deltas: settled.deltas, detail: settled.detail, maDelta: settled.maDelta, maDetail: settled.maDetail },
    ],
  };
}

// ---------------------------------------------------------------------------
// 鸣牌窗口内的响应
// ---------------------------------------------------------------------------

function applyClaimResponse(
  state: GameState,
  action: PlayerAction,
  cfg: RuleConfig,
): ApplyResult {
  const claim = state.claim;
  if (claim === null) fail('内部错误：CLAIM_WINDOW 阶段却没有 claim');

  if (!claim.pending.includes(action.seat)) {
    fail(`座位 ${action.seat} 不在鸣牌窗口内（待响应：${claim.pending.join('、') || '无'}）`);
  }
  const allowed = (claim.options.get(action.seat) ?? []).map((o) => o.type);
  if (!allowed.includes(action.type)) {
    fail(`座位 ${action.seat} 不能执行 ${action.type}（可选：${allowed.join('、') || '无'}）`);
  }
  if (action.tile !== null && action.tile !== claim.triggerTile) {
    fail(`窗口内只能针对 ${claim.triggerTile} 行动，收到 ${action.tile}`);
  }

  const responses = new Map(claim.responses);
  responses.set(action.seat, action.type);
  const pending = claim.pending.filter((s) => s !== action.seat);

  const s = acceptAction({ ...state, claim: { ...claim, responses, pending } }, action);
  if (pending.length > 0) return { state: s, events: [] };
  return resolveClaim(s, cfg);
}

function resolveClaim(state: GameState, cfg: RuleConfig): ApplyResult {
  const claim = state.claim;
  if (claim === null) fail('内部错误：resolveClaim 时 claim 为空');

  const outcome = arbitrate(claim.triggerSeat, claim.responses, cfg);
  const huWinners = outcome.winners.filter((w) => w.type === 'HU');

  if (huWinners.length > 0) {
    const isQiangGang = claim.gangSeat !== null;
    const winners: RoundWinner[] = huWinners.map((w) => ({
      seat: w.seat,
      zimo: false,
      gangShang: false,
      qiangGang: isQiangGang,
      tags: ronTags(state, w.seat, claim.triggerTile, cfg, isQiangGang),
    }));
    const outcome: RoundOutcome = isQiangGang
      ? { kind: 'HU', winners, loserSeat: claim.gangSeat }
      : { kind: 'HU', winners, loserSeat: claim.triggerSeat };
    const settled = settleInto({ ...state, phase: 'SETTLING', claim: null }, outcome, cfg);
    return {
      state: settled.state,
      events: [
        isQiangGang && claim.gangSeat !== null
          ? { type: 'QIANG_GANG_HU', winners, gangSeat: claim.gangSeat }
          : { type: 'HU', winners, loserSeat: claim.triggerSeat },
        { type: 'SETTLE', deltas: settled.deltas, detail: settled.detail, maDelta: settled.maDelta, maDetail: settled.maDetail },
      ],
    };
  }

  const winner = outcome.winners[0];
  if (winner === undefined) {
    // 这张牌没人要
    if (claim.gangSeat !== null) {
      // 抢杠窗口关闭且没人抢 → 补杠成立：入账 + 补一张
      const credited = creditBuGangScore(state, claim.gangSeat, cfg);
      return drawFor(credited, claim.gangSeat, cfg, [], true);
    }
    return advanceTurn({ ...state, claim: null }, cfg, []);
  }
  if (winner.type === 'PENG') return applyClaimPeng(state, winner.seat);
  if (winner.type === 'MING_GANG') return applyClaimMingGang(state, winner.seat, cfg);
  return fail(`仲裁给出了无法处理的赢家类型：${winner.type}`);
}

function applyClaimPeng(state: GameState, seat: number): ApplyResult {
  const claim = state.claim;
  if (claim === null) fail('内部错误：碰的时候 claim 为空');

  const hand = state.hands[seat];
  let next = removeTile(removeTile(hand, claim.triggerTile), claim.triggerTile);
  next = addMeld(next, { kind: 'PENG', tile: claim.triggerTile, fromSeat: claim.triggerSeat });
  next = { ...next, justPeng: true };

  const s = setHand(
    {
      ...state,
      claim: null,
      phase: 'WAITING_PLAY',
      turn: seat,
      discards: takeFromDiscards(state.discards, claim.triggerSeat, claim.triggerTile),
      lastDiscard: null,
      drawnFromGang: false,
    },
    seat,
    next,
  );
  return { state: s, events: [{ type: 'PENG', seat, tile: claim.triggerTile }] };
}

function applyClaimMingGang(state: GameState, seat: number, cfg: RuleConfig): ApplyResult {
  const claim = state.claim;
  if (claim === null) fail('内部错误：明杠的时候 claim 为空');

  const hand = state.hands[seat];
  let next = hand;
  for (let i = 0; i < 3; i++) next = removeTile(next, claim.triggerTile);
  next = addMeld(next, { kind: 'MING_GANG', tile: claim.triggerTile, fromSeat: claim.triggerSeat });

  const each = cfg.score.gang.mingGang;
  const roundGangScore = state.roundGangScore.map((v, i) =>
    i === seat ? v + each : i === claim.triggerSeat ? v - each : v,
  );
  // 直杠是**不对称**收支：只由点杠者付，所以流向必须单独记（买码按笔复制要用）。
  const roundGangFlows = [
    ...state.roundGangFlows,
    { payer: claim.triggerSeat, payee: seat, amount: each },
  ];

  const s = setHand(
    {
      ...state,
      claim: null,
      turn: seat,
      roundGangScore,
      roundGangFlows,
      discards: takeFromDiscards(state.discards, claim.triggerSeat, claim.triggerTile),
      lastDiscard: null,
    },
    seat,
    next,
  );
  return drawFor(
    s,
    seat,
    cfg,
    [{ type: 'GANG', seat, gangKind: 'MING_GANG', tile: claim.triggerTile }],
    true,
  );
}

/**
 * 点炮/抢杠胡的标签：把赢的那张并进手牌再判，再补上事件标签。
 *
 * **2026-10-06 修 bug**：这里原来只写了 `{ ...hand, drawnTile: null }`，从没把 `tile` 并进去 ——
 * 于是 13 张的听牌手永远凑不满 14 张，`judgeHu` 一律返回空标签集，**点炮胡全都按 0 炮结算**。
 * 旧测试要么手工喂 tag、要么只断言阶段，所以一直没暴露。现在按注释说的做：先把可能留着的
 * `drawnTile` 折进暗牌，再并上胡牌张，得到真正的 14 张。
 *
 * **不自摸就没有 `ZI_MO`** —— 自摸与否由 `RoundWinner.zimo` 这个标记表达，
 * 计分侧用同一个标记决定"三家各付"（Q-01 之后自摸不翻倍，所以它不产生额外分值）。
 */
function ronTags(
  state: GameState,
  seat: number,
  tile: Tile,
  cfg: RuleConfig,
  qiangGang: boolean,
): FanTag[] {
  const hand = state.hands[seat];
  const folded =
    hand.drawnTile === null ? hand : addTile({ ...hand, drawnTile: null }, hand.drawnTile);
  const counts = addTile(folded, tile).concealed;
  const tags: FanTag[] = [...judgeHu(counts, folded.melds, cfg).tags];
  if (isPengPengHuDanDiao(counts, folded.melds.length, tile)) {
    tags.push('PENG_PENG_HU_DAN_DIAO');
  }
  if (qiangGang) tags.push('QIANG_GANG_HU');
  return tags;
}

/**
 * 唯一入口。`now` 是 host 的时间（毫秒）—— 引擎自己不看时钟，窗口截止时间由它推出来。
 *
 * **在变换前后各断言一次不变量**：入口这次挡住"喂进来的已经是坏状态"（迁移拼装、反序列化、
 * 或某个上游 bug），出口这次保证"我这次变换没把状态搞坏"。放在这一个地方，就等于覆盖了
 * 内部所有 return 点，不必在每个分支里各写一遍。
 */
export function applyAction(
  state: GameState,
  action: PlayerAction,
  cfg: RuleConfig,
  now: number,
): ApplyResult {
  assertInvariants(state, cfg);
  const result = applyUnchecked(state, action, cfg, now);
  assertInvariants(result.state, cfg);
  return result;
}

function applyUnchecked(
  state: GameState,
  action: PlayerAction,
  cfg: RuleConfig,
  now: number,
): ApplyResult {
  if (state.phase === 'CLAIM_WINDOW') return applyClaimResponse(state, action, cfg);

  switch (action.type) {
    case 'DISCARD':
      return applyDiscard(state, action, cfg, now);
    case 'AN_GANG':
      return applyAnGang(state, action, cfg);
    case 'BU_GANG':
      return applyBuGang(state, action, cfg, now);
    case 'HU':
      return applyZimo(state, action, cfg);
    default: {
      const legal = LEGAL_ACTIONS[state.phase];
      return fail(
        `阶段 ${state.phase} 不接受动作 ${action.type}（合法动作：${legal.length ? legal.join('、') : '无'}）`,
      );
    }
  }
}
