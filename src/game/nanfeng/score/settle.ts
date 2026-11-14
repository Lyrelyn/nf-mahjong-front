// 移植自 nf-mahjong/assets/scripts/core/score/settle.ts（另加买码，口径见 score/ma.ts 与设计文档）
/**
 * 单局结算：把 `RoundOutcome` 变成四家"净得分"（外加买码位的净额），并**硬校验五家零和**。
 *
 * ```
 * 炮数     = scoreOfTags(tags, cfg, { zimo }).score + (杠上开花 ? 4 : 0)
 * 单家实付 = 炮数 × (自摸且 zimoDouble ? 2 : 1)      // Q-01 之后 zimoDouble 默认 false
 *          → cap > 0 时再取 min(实付, cap)
 * 点炮：放炮者分别付给**每个**赢家（Q-05 一炮多响）
 * 自摸：其余三家各付一份（自摸不可能多响）
 * 荒庄：庄家赔每家 1 分（共 3 分），不看听牌（R-08）
 * ```
 *
 * **杠分不在这一层重算**：开杠时已经把净额记进 `state.roundGangScore`（补杠要等抢杠窗口关闭）。
 * 这里只把它并进来 —— 所以荒庄时已经开过的杠照样算（Q-02），而自摸/点炮的胡牌分
 * 与杠分是两笔独立收支。
 *
 * ## 买码（R-09，第 5 个参与者）
 *
 * 码牌指向的那个座位，买码位**复制他的每一笔现金流**：他收多少买家也收多少（同样的付款方出），
 * 他付多少买家也付多少（同样的收款方收）。多张码牌指向同一人就叠加，指向不同人各算各的
 * （可能互相抵消）。所以这一层除了四家 `deltas`，还要产出 `maDelta` 与每张码牌的明细。
 *
 * 实现上刻意**按笔复制**而不是"复制净得分"：两者在「明杠只由点杠者付」这种不对称收支上
 * 结果不同，而口径是"跟着被买的人走"。为此每笔现金流的流向都要留 —— 胡牌分在这里现算，
 * 杠分的流向由状态机的 `roundGangFlows` 记下来。
 *
 * 任何路径都以 `Σ deltas + maDelta === 0` 结尾；不满足直接抛异常，**不做静默修正**
 * （spec §12.4 的不变量 3）。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import type { FanTag } from '../fanTags';
import type { RuleConfig } from '../ruleConfig';
import type { GangFlow, GameState, RoundOutcome } from '../state/gameState';
import type { Tile } from '../tiles';
import { maTargets } from './ma';
import { scoreOfTags } from './scoreTable';

/** 一家赢家这一局的账目明细，给结算面板直接渲染。 */
export interface FanDetail {
  seat: number;
  tags: FanTag[];
  zimo: boolean;
  gangShang: boolean;
  /** 牌型炮数（不含杠上开花的 +4）。 */
  fan: number;
  /** 单家实付（封顶之后）。 */
  unit: number;
  /** 这家这一局从胡牌上收入多少（自摸 = 3×unit，点炮 = unit）。 */
  income: number;
}

/** 一张码牌的结算明细。 */
export interface MaDetail {
  /** 翻开的码牌。 */
  tile: Tile;
  /** 它指向的打牌座位（0..3）。 */
  seat: number;
  /** 这张码牌给买码位带来的净额（正 = 收，负 = 付）。 */
  delta: number;
}

export interface SettleResult {
  /** 四家的本局净得分（含杠分与买码带来的额外收付）。 */
  deltas: number[];
  detail: FanDetail[];
  /** 买码位本局净额（没买码时恒为 0）。 */
  maDelta: number;
  /** 每张码牌的明细（按翻开顺序）。 */
  maDetail: MaDetail[];
}

export function settleRound(
  state: GameState,
  outcome: RoundOutcome,
  cfg: RuleConfig,
): SettleResult {
  const seatCount = state.hands.length;
  const deltas = Array.from({ length: seatCount }, () => 0);
  const detail: FanDetail[] = [];
  /** 本局全部现金流：胡牌分 + 杠分。买码要按笔复制它。 */
  const flows: GangFlow[] = [];

  if (outcome.kind === 'HUANG_ZHUANG') {
    const each = cfg.score.huangZhuang.dealerPaysEach;
    deltas[state.dealer] -= each * (seatCount - 1);
    for (let seat = 0; seat < seatCount; seat++) {
      if (seat !== state.dealer) {
        deltas[seat] += each;
        flows.push({ payer: state.dealer, payee: seat, amount: each });
      }
    }
  } else {
    for (const winner of outcome.winners) {
      const tags = new Set<FanTag>(winner.tags ?? []);
      const gangShang = winner.gangShang === true;
      const fan =
        scoreOfTags(tags, cfg, { zimo: winner.zimo }).score +
        (gangShang ? cfg.score.gangShangKaiHua : 0);

      const doubled = winner.zimo && cfg.score.zimoDouble ? 2 : 1;
      let unit = fan * doubled;
      if (cfg.score.cap > 0) unit = Math.min(unit, cfg.score.cap);

      let income: number;
      if (winner.zimo) {
        // 自摸：其余三家各付一份
        income = unit * (seatCount - 1);
        for (let seat = 0; seat < seatCount; seat++) {
          if (seat !== winner.seat) {
            deltas[seat] -= unit;
            flows.push({ payer: seat, payee: winner.seat, amount: unit });
          }
        }
      } else {
        if (outcome.loserSeat === null) {
          throw new Error('结算失败：点炮胡必须给出放炮者（loserSeat）');
        }
        income = unit;
        deltas[outcome.loserSeat] -= unit;
        flows.push({ payer: outcome.loserSeat, payee: winner.seat, amount: unit });
      }
      deltas[winner.seat] += income;

      detail.push({
        seat: winner.seat,
        tags: Array.from(tags),
        zimo: winner.zimo,
        gangShang,
        fan,
        unit,
        income,
      });
    }
  }

  // 杠分并入（独立于胡牌分；荒庄也保留），其现金流由状态机记账
  for (let seat = 0; seat < seatCount; seat++) deltas[seat] += state.roundGangScore[seat];
  flows.push(...state.roundGangFlows);

  // 买码：逐笔复制被指向座位的现金流
  const targets = maTargets(state.maTiles, state.dealer);
  const maDetail: MaDetail[] = [];
  let maDelta = 0;
  state.maTiles.forEach((tile, index) => {
    const target = targets[index] ?? 0;
    let tileDelta = 0;
    for (const flow of flows) {
      if (flow.payer !== target && flow.payee !== target) continue;
      // 复制这一笔：原收付方不变，另一端换成买码位
      if (flow.payer === target) {
        // 他付 → 买码位也付给同一个收款方
        tileDelta -= flow.amount;
        deltas[flow.payee] += flow.amount;
      } else {
        // 他收 → 买码位也从同一个付款方收
        tileDelta += flow.amount;
        deltas[flow.payer] -= flow.amount;
      }
    }
    maDelta += tileDelta;
    maDetail.push({ tile, seat: target, delta: tileDelta });
  });

  const total = deltas.reduce((a, b) => a + b, 0) + maDelta;
  if (total !== 0) {
    throw new RangeError(
      `结算失败：零和被破坏（Σ 四家 + 买码 = ${total}）—— 这是账目 bug，不做静默修正。`
        + `检查本局杠分台账 ${JSON.stringify(state.roundGangScore)} 与码牌 ${JSON.stringify(state.maTiles)}`,
    );
  }

  return { deltas, detail, maDelta, maDetail };
}
