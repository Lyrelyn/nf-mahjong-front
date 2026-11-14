// 移植自 nf-mahjong/assets/scripts/core/state/gameState.ts（逻辑未改动）
/**
 * 牌局状态：`GameState` 是**唯一真相**，只存在于 host（裁判）进程里。
 *
 * 时间与随机数都由参数注入（spec §3.3）：`startRound` 收一个 `Rng`，`applyAction` 收一个 `now`。
 * 这个文件不 import 任何 Cocos / IO / 时间 API。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { addTile, createHand, type HandState } from '../action/hand';
import type { ActionOption, ActionType } from '../action/options';
import type { FanTag } from '../fanTags';
import type { Meld } from '../melds';
import { shuffleWall, type Rng } from '../prng';
import { validateRuleConfig, type RuleConfig } from '../ruleConfig';
import type { SettleResult } from '../score/settle';
import { fullWall, type Tile } from '../tiles';
import type { Phase } from './phase';

/** 一个鸣牌窗口。`gangSeat` 非空表示这是**抢杠窗口**（只允许 HU / PASS）。 */
export interface ClaimState {
  /** 出牌者；抢杠窗口里是补杠那一家。 */
  triggerSeat: number;
  triggerTile: Tile;
  /** 补杠的那一家；普通点炮窗口为 `null`。 */
  gangSeat: number | null;
  /** 还没响应的座位。 */
  pending: number[];
  options: Map<number, ActionOption[]>;
  responses: Map<number, ActionType>;
  deadlineAt: number;
}

/** 一笔杠分现金流：付款方座位 → 收款方座位，金额。买码要"按笔复制"，所以必须留流向。 */
export interface GangFlow {
  payer: number;
  payee: number;
  amount: number;
}

export interface GameState {
  phase: Phase;
  round: number;
  dealer: number;
  /** 当前该谁出牌。 */
  turn: number;
  /** 每个座位的 peer id。房间层的昵称/准备状态不在这里（那是 `ROOM_STATE` 的事）。 */
  seats: string[];
  /** **还没被摸走**的牌墙（发牌时已经抽掉了庄家的第 14 张）。 */
  wall: Tile[];
  /** 已经从这个牌墙里摸走了几张。`wallPos >= wall.length` 就是荒庄。 */
  wallPos: number;
  hands: HandState[];
  discards: Tile[][];
  /** 跨局累计得分。 */
  scores: number[];
  /**
   * 本局预留的码牌（洗牌后牌墙**末尾** N 张，R-09）。
   *
   * 它们不参与发牌也不参与摸牌 —— 所以本局牌墙比常局少 N 张、荒庄提前 N 张。
   * **局中不公开**（谁也不知道买的是谁），结算时才按顺序翻开。
   */
  maTiles: Tile[];
  /** 买码位（第 5 个参与者）的**跨局累计**净得分。与 `scores` 一起构成五家零和。 */
  maScore: number;
  /** **本局**杠分净额，开杠即时入账、荒庄也保留（Q-02）。 */
  roundGangScore: number[];
  /**
   * 本局杠分的**现金流**（付款方, 收款方, 金额）。
   *
   * 与 `roundGangScore` 同源写入，但要单独留：买码是"按笔复制被指向座位的每一笔钱"，
   * 而明杠只由点杠者付 —— 只有净额是还原不出"谁付给谁"的（`score/settle.ts` 的买码段要用）。
   */
  roundGangFlows: GangFlow[];
  lastDiscard: { seat: number; tile: Tile } | null;
  /**
   * 本局的结算结果；还没结算时为 `null`。
   *
   * 放这里而**不是** host 的内存字段：房主迁移要用公开信息重建状态（`assembleState`），
   * 只活在 host 进程里的数据一换房主就没了，而结算面板要靠它显示番型明细。
   */
  lastSettle: SettleResult | null;
  /**
   * 本局的**胜负结果**（谁胡的、自摸还是点炮、放炮的是谁）；还没结算时为 `null`。
   *
   * 与 `lastSettle` 是两件事，都必须留着：`lastSettle` 是**账**（各家净得分 + 番型），
   * 这里的是**因**（谁赢谁输）。下一局谁坐庄、谁下场（`nextRoundSeating`）要的是后者 ——
   * 而"放炮的是谁"这一条在 `FanDetail` 里**根本没有**，光看账推不出来。
   */
  lastOutcome: RoundOutcome | null;
  /** 刚摸到的那张是不是杠后补的牌（决定"杠上开花"）。 */
  drawnFromGang: boolean;
  claim: ClaimState | null;
  /** 只由 host 递增；一次客户端动作 +1（随之而来的摸牌不额外加）。 */
  seq: number;
  epoch: number;
  hostId: string;
  /** 裁判所在座位。**与 `hostId` 一起决定"轮空者不能当裁判"的那条规则**（C-9）。 */
  hostSeat: number;
  actionLog: { seq: number; type: ActionType | 'DEAL' | 'DRAW'; seat: number; tile: Tile | null }[];
  /** 本局开局时用的规则配置 —— 重放必须用同一份，所以它是牌局身份的一部分。 */
  cfg: RuleConfig;
}

/** 一个赢家。`tags` 是判胡标签（已并入杠上开花 / 抢杠这类事件标签）。 */
export interface RoundWinner {
  seat: number;
  zimo: boolean;
  gangShang?: boolean;
  qiangGang?: boolean;
  tags?: FanTag[];
}

export type RoundOutcome =
  | { kind: 'HU'; winners: readonly RoundWinner[]; loserSeat: number | null }
  | { kind: 'HUANG_ZHUANG' };

/**
 * 拷一份胜负结果。
 *
 * 需要它是因为 `winners[].tags` 是数组：`{...roundOutcome}` 只拷一层，投影出去的那份还指着
 * 权威状态里的同一个数组 —— 客户端或表现层动一下就把牌局的记录改了。
 */
export function cloneOutcome(outcome: RoundOutcome): RoundOutcome {
  if (outcome.kind === 'HUANG_ZHUANG') return { kind: 'HUANG_ZHUANG' };
  return {
    kind: 'HU',
    loserSeat: outcome.loserSeat,
    winners: outcome.winners.map((winner) => ({
      ...winner,
      tags: winner.tags === undefined ? undefined : Array.from(winner.tags),
    })),
  };
}

export interface StartRoundOptions {
  /** 每个座位的 peer id。 */
  seats: readonly string[];
  dealer: number;
  cfg: RuleConfig;
  rng: Rng;
  round: number;
  hostId: string;
  epoch: number;
}

/** 手里的全部暗牌：`concealed` 并入刚摸到的那张。 */
export function handCountsOf(h: HandState): Uint8Array {
  if (h.drawnTile === null) return h.concealed;
  const c = h.concealed.slice();
  c[h.drawnTile] += 1;
  return c;
}

/**
 * 开局：洗牌 → 每家 13 张 → 庄家多摸一张（放在 `drawnTile` 上，不进 `concealed`）。
 *
 * `wall` 里留下的是**还没被摸走**的 83 张，`wallPos` 从 0 开始 —— 所以"剩余张数"就是
 * `wall.length - wallPos`，荒庄判定也只是一次比较。
 *
 * 第一局的 `dealer` 由调用方传 `hostSeat`（Q-06：房主坐庄）；之后用 `nextRoundSeating`。
 */
export function startRound(opts: StartRoundOptions): GameState {
  const { seats, dealer, cfg, rng, round, hostId, epoch } = opts;

  validateRuleConfig(cfg);
  if (seats.length !== 4) throw new RangeError(`座位数必须是 4，收到 ${seats.length}`);
  if (dealer < 0 || dealer >= seats.length) throw new RangeError(`庄家座位越界：${dealer}`);
  const hostSeat = seats.indexOf(hostId);
  if (hostSeat < 0) throw new RangeError(`hostId "${hostId}" 不在座位表里`);

  const shuffled = shuffleWall(fullWall(), rng);

  // 买码（R-09）：洗牌后把**牌墙末尾** N 张留作码牌 —— 不参与发牌也不参与摸牌，
  // 所以本局牌墙少 N 张、荒庄提前 N 张，而且任何人都不可能摸到它们。
  const maCount = cfg.buyCode.count;
  const maTiles = maCount > 0 ? shuffled.slice(shuffled.length - maCount) : [];
  const dealPool = maTiles.length > 0 ? shuffled.slice(0, shuffled.length - maTiles.length) : shuffled;

  const hands: HandState[] = [];
  let cursor = 0;
  for (let seat = 0; seat < seats.length; seat++) {
    let h = createHand();
    for (let i = 0; i < 13; i++) h = addTile(h, dealPool[cursor++]);
    hands.push(h);
  }
  hands[dealer] = { ...hands[dealer], drawnTile: dealPool[cursor++] };
  const wall = dealPool.slice(cursor);

  return {
    phase: 'WAITING_PLAY',
    round,
    dealer,
    turn: dealer,
    seats: [...seats],
    wall,
    wallPos: 0,
    hands,
    discards: seats.map(() => []),
    scores: seats.map(() => 0),
    maTiles,
    maScore: 0,
    roundGangScore: seats.map(() => 0),
    roundGangFlows: [],
    lastDiscard: null,
    lastSettle: null,
    lastOutcome: null,
    drawnFromGang: false,
    claim: null,
    seq: 0,
    epoch,
    hostId,
    hostSeat,
    actionLog: [],
    cfg,
  };
}

/**
 * 大厅：**还没开局**的那一段时间。
 *
 * 为什么不能直接拿 `startRound` 顶替：它硬要求恰好 4 个座位（房主要能在座位表里定位到自己），
 * 而"等人到齐"这个阶段座位表**本来就不满**。而 `phase` 里早就有 `'LOBBY'` 了 ——
 * `LEGAL_ACTIONS.LOBBY` 是空表（所有动作被拒）、`tick` 在 LOBBY 下什么都不做、
 * `failMigration` 也用它表达"本局作废"。所以大厅不需要新的状态机，只需要一个
 * **一副牌都还没发**的开局状态。
 *
 * `round` 是 0：一局都没开过。面板靠它显示"第几局"。
 */
export function startLobby(opts: {
  seats: readonly string[];
  hostId: string;
  cfg: RuleConfig;
  epoch: number;
}): GameState {
  const { seats, hostId, cfg, epoch } = opts;

  validateRuleConfig(cfg);
  if (seats.length === 0) throw new RangeError('大厅至少要有一个座位（房主自己）');
  const hostSeat = seats.indexOf(hostId);
  if (hostSeat < 0) throw new RangeError(`房主 "${hostId}" 不在座位表里`);

  return {
    phase: 'LOBBY',
    round: 0,
    dealer: 0,
    turn: 0,
    seats: [...seats],
    // 整副牌原封不动躺在牌墙里，所以守恒天然成立（见 invariants.ts 第 2 条）。
    wall: fullWall(),
    wallPos: 0,
    hands: seats.map(() => createHand()),
    discards: seats.map(() => []),
    scores: seats.map(() => 0),
    maTiles: [],
    maScore: 0,
    roundGangScore: seats.map(() => 0),
    roundGangFlows: [],
    lastDiscard: null,
    lastSettle: null,
    lastOutcome: null,
    drawnFromGang: false,
    claim: null,
    seq: 0,
    epoch,
    hostId,
    hostSeat,
    actionLog: [],
    cfg,
  };
}

/**
 * 本局结束后谁坐庄、谁下场买码（R-02 / C-9）。
 *
 * | 本局结果 | 下局庄家 | 下场的人 |
 * |---|---|---|
 * | 庄家胡（含自摸） | 庄家连庄 | 庄家的**对家** |
 * | 别人**点炮**胡 | **胡牌者**坐庄 | **放炮者** |
 * | 别人**自摸**胡 | **胡牌者**坐庄 | 自摸者的**对家** |
 * | 荒庄 | 庄家的**对家** | **庄家** |
 *
 * 第三行是原设计漏掉的一种情形 —— R-02 的表只写了"庄家自摸 / 别人点炮 / 流局"三种，
 * 少了"非庄家自摸"（**没有放炮者**）。是 Task 20 的 fuzz 把它撞出来的：胡牌率一抬到 28%，
 * 立刻有 30/200 局走到这条路上抛异常。补法直接沿用牌友的原话"自摸对家下场"，
 * 即**自摸者的对家**下场（庄家自摸时它也等价于"庄家的对家"）。
 *
 * 用 `zimo` 区分"自摸"与"点炮忘了给放炮者"：`zimo: false` 且 `loserSeat === null` 属编程错误，直接抛。
 *
 * 多家同时胡时取 `winners` 的第一家 —— `arbitrate` 已按"距放炮者顺时针距离"升序返回，
 * 所以就是离放炮者最近的那家。（规则文档写作"逆时针最近胡牌者"，而本设计里座位号递增即
 * 出牌方向，两种说法方向相反；按"距离升序第一位"落地，已列入待牌友过目的清单。）
 *
 * **调用方注意**：若 `sittingOut === state.hostSeat`，必须在下一局开局前先完成房主迁移
 * —— 轮空者下局要回来打，让他当裁判等于把四家手牌送给他看。
 */
export function nextRoundSeating(
  state: GameState,
  outcome: RoundOutcome,
): { dealer: number; sittingOut: number } {
  const seatCount = state.hands.length;
  const opposite = (seat: number): number => (seat + seatCount / 2) % seatCount;

  if (outcome.kind === 'HUANG_ZHUANG') {
    return { dealer: opposite(state.dealer), sittingOut: state.dealer };
  }

  if (outcome.winners.some((w) => w.seat === state.dealer)) {
    return { dealer: state.dealer, sittingOut: opposite(state.dealer) };
  }
  if (outcome.winners.length === 0) {
    throw new Error('胡牌结果里没有赢家');
  }

  const winner = outcome.winners[0];
  if (outcome.loserSeat !== null) {
    return { dealer: winner.seat, sittingOut: outcome.loserSeat };
  }
  if (outcome.winners.every((w) => w.zimo)) {
    // 自摸（没有放炮者）：自摸者的对家下场
    return { dealer: winner.seat, sittingOut: opposite(winner.seat) };
  }
  throw new Error('点炮胡必须给出放炮者（loserSeat），否则无法定下一个庄家与下场的人');
}

export type { Meld };
