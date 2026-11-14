// 移植自 nf-mahjong/tests/helpers/fixtures.ts（只搬 core 相关部分；联机相关夹具已剔除）
/**
 * 共享测试夹具（计划「共享测试夹具（tests/helpers/）」表）。
 *
 * 所有任务复用这里的名字，**不在各任务里重复定义或自行发明**。
 *
 * 两类夹具：
 *   1. **手牌夹具**（`handOf` / `canPengHand` / …）：只造 `HandState`，13 张（点炮窗口那一刻的形态）。
 *   2. **牌局夹具**（`craftedRound` / `playToDiscard` / …）：造完整 `GameState`。需要精确控制某家手牌时
 *      用 `craftedRound`，**没写的座位自动填"谁也惹不起"的杂牌**（见 `JUNK` 的说明）。
 */

import { addTile, createHand, type HandState } from '../action/hand';
import { countsOf } from '../counts';
import { meldTileCount, type Meld } from '../melds';
import { createRng, shuffleWall } from '../prng';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from '../ruleConfig';
import { applyAction } from '../state/apply';
import { startRound, type GameState } from '../state/gameState';
import { fullWall, type Tile } from '../tiles';

// ---------------------------------------------------------------------------
// 手牌夹具
// ---------------------------------------------------------------------------

/** 用一串牌码造手牌（都进 `concealed`，不设 `drawnTile`）。 */
export function handOf(tiles: readonly Tile[]): HandState {
  let h = createHand();
  for (const t of tiles) h = addTile(h, t);
  return h;
}

/**
 * 13 张，手里 2 张 11 → **能碰 11**。
 * 刻意混花色且并进 11 后也成不了结构：11×3 之外全是单张，配不出将，也不是十三烂/七对/假胡。
 */
export function canPengHand(): HandState {
  return handOf([11, 11, 13, 15, 19, 21, 24, 27, 31, 34, 37, 41, 43]);
}

/** 13 张，手里 3 张 11 → **能碰也能明杠**。 */
export function canPengGangHand(): HandState {
  return handOf([11, 11, 11, 13, 15, 19, 21, 24, 27, 31, 34, 37, 41]);
}

/**
 * 13 张，并进一张 **11 即胡**：
 * `11-12-13` + `21-22-23` + `31×3` + `41×3` + `11,11` 将。
 */
export function canHuHand(): HandState {
  return handOf([11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 41, 11]);
}

/**
 * 13 张，并进一张 **11 即胡**，且手里**一张 11 都没有** ——
 * 给"点炮 / 抢杠胡"用：需要精确控制谁能在 11 上胡时，不能让胡牌方占掉那几张 11。
 *
 * 两个变体用**互不相交的牌码**，所以可以让两家同时胡同一张 11（一炮多响用例）。
 */
const RON_WINNER_HANDS: readonly (readonly Tile[])[] = [
  [12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 41, 19, 19],
  [12, 13, 24, 25, 26, 32, 32, 32, 51, 51, 51, 29, 29],
];

export function ronWinnerHand(variant = 0): Tile[] {
  return [...RON_WINNER_HANDS[variant % RON_WINNER_HANDS.length]];
}

/** 抢杠胡用的那一手（= `ronWinnerHand(0)`）。 */
export function qiangGangHuHand(): HandState {
  return handOf(ronWinnerHand(0));
}

/** 13 张，自摸 11 即胡（`11,11` 将 + `11-12-13` + 三组刻子）。 */
export function zimoReady(seat = 1): GameState {
  return craftedRound({
    turn: seat,
    hands: seatHands(seat, {
      concealed: [11, 11, 12, 13, 21, 22, 23, 31, 31, 31, 41, 41, 41],
      drawnTile: 11,
    }),
  });
}

/** 座位 `discardSeat` 打出 `tile`，`winnerSeats` 里的每一家都能在它上面胡 → 点炮窗口。 */
export function ronReady(
  tile: Tile = 11,
  winnerSeats: readonly number[] = [1],
  discardSeat = 0,
): GameState {
  const extra: Record<number, CraftedHandSpec> = {};
  winnerSeats.forEach((seat, i) => {
    extra[seat] = { concealed: ronWinnerHand(i) };
  });
  const s = craftedRound({
    turn: discardSeat,
    hands: seatHands(
      discardSeat,
      { concealed: junkTail(discardSeat, 13), drawnTile: tile },
      extra,
    ),
  });
  return applyAction(s, { type: 'DISCARD', seat: discardSeat, tile, reqId: 1 }, s.cfg, 1).state;
}


// ---------------------------------------------------------------------------
// 牌局夹具
// ---------------------------------------------------------------------------

export const SEATS = ['a', 'b', 'c', 'd'] as const;

/** `startRound` 的入参：每次调用都造**新的 rng**（rng 有状态，共享一个会得到不同牌墙）。 */
export function startBase(over: Partial<Parameters<typeof startRound>[0]> = {}) {
  return {
    seats: [...SEATS],
    cfg: DEFAULT_RULE_CONFIG,
    rng: createRng(7),
    round: 1,
    hostId: 'a',
    epoch: 1,
    dealer: 0,
    ...over,
  };
}

export interface CraftedHandSpec {
  concealed: readonly Tile[];
  melds?: readonly Meld[];
  drawnTile?: Tile | null;
}

export interface CraftedRoundSpec {
  /** 四家；写 `null` 表示"这家自动填杂牌"。 */
  hands: readonly (CraftedHandSpec | null)[];
  /** 座位 peer id；默认 `SEATS`。要与被测 host 的座位表一致，否则它的 `seatOf` 认不出人。 */
  seats?: readonly string[];
  /** 轮到谁。默认 0。 */
  turn?: number;
  /** 庄家。默认等于 `turn`。 */
  dealer?: number;
  hostSeat?: number;
  round?: number;
  epoch?: number;
  wallSeed?: number;
  cfg?: RuleConfig;
}

/**
 * 按**指定的手牌**造一个开局状态；牌墙 = 136 张里没被用掉的那些（洗过）。
 *
 * 比"随机发牌再碰运气"可控得多：需要某家手里有 3 张 11 时就直写 3 张 11。
 * 会校验"每种牌不超过 4 张"，写错牌立刻报错，而不是造出一个假状态混进测试。
 */
export function craftedRound(spec: CraftedRoundSpec): GameState {
  const cfg = spec.cfg ?? DEFAULT_RULE_CONFIG;
  const turn = spec.turn ?? 0;
  const dealer = spec.dealer ?? turn;

  const used = new Map<Tile, number>();
  const reserve = (t: Tile, n = 1): void => {
    const total = (used.get(t) ?? 0) + n;
    if (total > 4) throw new Error(`夹具造出了非法牌局：牌码 ${t} 共 ${total} 张（上限 4）`);
    used.set(t, total);
  };

  const hands: HandState[] = [];

  for (let seat = 0; seat < 4; seat++) {
    const s = spec.hands[seat];
    if (s) {
      for (const t of s.concealed) reserve(t);
      if (s.drawnTile) reserve(s.drawnTile);
      for (const m of s.melds ?? []) reserve(m.tile, meldTileCount(m));
      hands.push({
        concealed: countsOf(s.concealed),
        melds: [...(s.melds ?? [])],
        drawnTile: s.drawnTile ?? null,
        justPeng: false,
      });
    } else {
      hands.push(createHand());
    }
  }

  // 杂牌：每手内不重复，且只用牌墙里还剩的牌
  const junk = allocateJunk(used);
  for (let seat = 0; seat < 4; seat++) {
    if (spec.hands[seat]) continue;
    const dealt = seat === turn ? junk[seat].slice(0, 14) : junk[seat].slice(0, 13);
    let h = createHand();
    for (const t of dealt.slice(0, 13)) {
      reserve(t); // 发出去的杂牌必须从牌墙里扣掉，否则同一张牌会被算两次
      h = addTile(h, t);
    }
    if (seat === turn) {
      reserve(dealt[13]);
      h = { ...h, drawnTile: dealt[13] };
    }
    hands[seat] = h;
  }

  const wall = shuffleWall(buildRest(used), createRng(spec.wallSeed ?? 99));

  return {
    phase: 'WAITING_PLAY',
    round: spec.round ?? 1,
    dealer,
    turn,
    lastSettle: null,
    lastOutcome: null,
    seats: [...(spec.seats ?? SEATS)],
    wall,
    wallPos: 0,
    hands,
    discards: [[], [], [], []],
    scores: [0, 0, 0, 0],
    // 夹具默认不买码：码牌为空、买码位累计 0、没有杠分流水（要测买码的用例自己塞）
    maTiles: [],
    maScore: 0,
    roundGangScore: [0, 0, 0, 0],
    roundGangFlows: [],
    lastDiscard: null,
    drawnFromGang: false,
    claim: null,
    seq: 0,
    epoch: spec.epoch ?? 1,
    hostId: (spec.seats ?? SEATS)[spec.hostSeat ?? 0],
    hostSeat: spec.hostSeat ?? 0,
    actionLog: [],
    cfg,
  };
}

/** 按 round-robin 发杂牌：保证每手内不重复、每种牌总数不超过 4，且**绝不含 11**。 */
function allocateJunk(reserved: ReadonlyMap<Tile, number>): Tile[][] {
  // 11 是全部夹具的"触发牌"：杂牌手里一旦有 11 就可能碰/杠/胡，夹具就不再是"零响应"了。
  const pool = buildRest(reserved).filter((t) => t !== 11);
  const hands: Tile[][] = [[], [], [], []];
  const seen: Set<Tile>[] = [new Set(), new Set(), new Set(), new Set()];
  const want = 14; // 每家最多 13 张杂牌 + 1 张摸到的
  let guard = 0;
  while (pool.length > 0 && guard++ < 5000) {
    let progressed = false;
    for (let seat = 0; seat < 4; seat++) {
      if (hands[seat].length >= want) continue;
      const idx = pool.findIndex((t) => !seen[seat].has(t));
      if (idx < 0) continue;
      const t = pool.splice(idx, 1)[0];
      hands[seat].push(t);
      seen[seat].add(t);
      progressed = true;
    }
    if (!progressed) break;
  }
  return hands;
}

/** 136 张里扣掉 `reserved` 之后剩下的牌（多重集）。 */
function buildRest(reserved: ReadonlyMap<Tile, number>): Tile[] {
  const left = new Map(reserved);
  const rest: Tile[] = [];
  for (const t of fullWall()) {
    const n = left.get(t) ?? 0;
    if (n > 0) left.set(t, n - 1);
    else rest.push(t);
  }
  return rest;
}

/** 一个"零响应"的杂牌局：座位 `turn` 手里 13 张杂牌 + 摸到 11。 */
export function playToDiscard(turn = 0): GameState {
  return craftedRound({
    turn,
    dealer: turn,
    hands: [{ concealed: [11, ...junkTail(turn, 12)], drawnTile: 11 }, null, null, null],
  });
}

/**
 * 牌墙抽干（剩下的牌当作已经被打掉，塞进座位 0 的牌河）。
 *
 * 不能只把 `wallPos` 推到末尾 —— 那样那些牌就凭空消失了，守恒会先报错，
 * 荒庄这条路径反而测不到。
 */
export function withWallAlmostEmpty(s: GameState): GameState {
  const leftover = s.wall.slice(s.wallPos);
  const discards = s.discards.map((pile, seat) => (seat === 0 ? [...pile, ...leftover] : pile));
  return { ...s, wall: s.wall.slice(0, s.wallPos), discards };
}

/**
 * 故意造一个**只破坏牌张守恒**的状态：从牌墙里抽走一张（谁也没拿到）。
 *
 * 为什么是"抽走"而不是"多塞一张"：合法状态里每个牌码恰好 4 张，多塞一张必然同时触发
 * "不得超过 4 张"，而那条检查排在守恒之前 —— 断言的报错就不确定了。抽走一张则只会踩守恒。
 */
export function corruptState(): GameState {
  const s = playToDiscard(0);
  if (s.wall.length === 0) throw new Error('夹具：牌墙为空，没法抽走一张来破坏守恒');
  return { ...s, wall: s.wall.slice(1) };
}

/** 轮到 `seat`，手里 4 张 `tile` → 可以暗杠。 */
export function anGangReady(seat = 1, tile: Tile = 11): GameState {
  const junk = junkHand(seat);
  return craftedRound({
    turn: seat,
    hands: seatHands(seat, {
      concealed: [tile, tile, tile, tile, ...junk.slice(0, 9)],
      drawnTile: junk[9],
    }),
  });
}

/** 座位 `discardSeat` 打出 `tile`（第 4 张），`gangSeat` 手里 3 张 → 明杠窗口。 */
export function mingGangReady(tile: Tile = 11, gangSeat = 1, discardSeat = 0): GameState {
  const s = craftedRound({
    turn: discardSeat,
    hands: seatHands(discardSeat, { concealed: junkTail(discardSeat, 13), drawnTile: tile }, {
      [gangSeat]: { concealed: [tile, tile, tile, ...junkTail(gangSeat, 10)] },
    }),
  });
  return applyAction(s, { type: 'DISCARD', seat: discardSeat, tile, reqId: 1 }, s.cfg, 1).state;
}

/**
 * 轮到 `seat`：碰过 `tile` + 刚摸到第 4 张 → 可以补杠。
 *
 * `robberSeat` 非空时，那家的手牌**正好能在 `tile` 上抢杠胡**（手里一张 `tile` 都没有，
 * 靠 `11-12-13` 凑）；为 `null` 时四家都是杂牌，抢杠窗口无人可胡。
 */
export function buGangReady(seat = 1, tile: Tile = 11, robberSeat: number | null = 2): GameState {
  const meld: Meld = { kind: 'PENG', tile, fromSeat: 2 };
  return craftedRound({
    turn: seat,
    hands: seatHands(
      seat,
      { concealed: junkTail(seat, 10), melds: [meld], drawnTile: tile },
      robberSeat === null ? {} : { [robberSeat]: { concealed: ronWinnerHand(0) } },
    ),
  });
}

/** 造"四家"数组，只覆盖指定座位，其余为 `null`（自动杂牌）。 */
function seatHands(
  primarySeat: number,
  primary: CraftedHandSpec,
  extra: Record<number, CraftedHandSpec> = {},
): readonly (CraftedHandSpec | null)[] {
  const out: (CraftedHandSpec | null)[] = [null, null, null, null];
  out[primarySeat] = primary;
  for (const key of Object.keys(extra)) out[Number(key)] = extra[Number(key)];
  return out;
}

/** 取该座位杂牌的前 `n` 张（`junkHand` 的简写）。 */
function junkTail(seat: number, n: number): Tile[] {
  return junkHand(seat).slice(0, n);
}

/**
 * 第 `i` 手杂牌：跨花色、同花色内间隔 ≥3、互不重复，且**不含 11**。
 *
 * - 每张牌在一手里只出现一次 → 没有刻子；间隔 ≥3 → 没有顺子 → **拆不出任何结构**；
 * - 跨花色 → **不是假胡**；
 * - 并进一张 11 后要么万子里 11 与 12 相邻、要么数牌凑到 10 张（每花色最多 3 张，不可能）
 *   → **也不可能被 11 点炮胡**。
 *
 * 所以"其余座位用杂牌"就等价于"这些家不会响应任何出牌"，夹具因此完全确定。
 */
const JUNK_DEAL: readonly (readonly Tile[])[] = (() => {
  const codes: Tile[] = [];
  for (const base of [10, 20, 30]) for (const r of [2, 5, 8]) codes.push(base + r);
  codes.push(41, 42, 51, 52, 43, 53, 44);

  const hands: Tile[][] = [[], [], [], []];
  let cursor = 0;
  for (const code of codes) {
    for (let copy = 0; copy < 4; copy++) {
      hands[cursor % 4].push(code);
      cursor++;
    }
  }
  return hands;
})();

export function junkHand(i: number): Tile[] {
  return [...JUNK_DEAL[i % 4]].slice(0, 13);
}
