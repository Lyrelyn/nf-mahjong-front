// 移植自 nf-mahjong/tests/core/rules-conformance.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';
import { DEFAULT_RULE_CONFIG, validateRuleConfig } from './ruleConfig';
import { countGuiYi } from './hu/guiYi';
import { requiresSelfDraw } from './hu/shiSanLan';
import { countsOf } from './counts';
import { meldTileCount, type Meld } from './melds';
import { settleRound } from './score/settle';
import { QI_XING_SCORE, STRUCTURE_SCORE, scoreOfTags } from './score/scoreTable';
import { fullWall } from './tiles';
import { nextRoundSeating } from './state/gameState';
import { startRound } from './state/gameState';
import { startBase } from './testSupport/fixtures';

/**
 * 规则确认结论（`docs/rules-confirmed.md` 的 R-01 ~ R-11）与实现的**口径一致性**。
 *
 * 这个文件存在的理由只有一条：那份文档是**唯一**的规则权威，而"文档说一致"这句话会腐烂 ——
 * 改一个 `ruleConfig` 里的数字，文档不会自己跟着改。所以把可机械核对的那几条**锁在这里**：
 * 谁改了实现，谁就得同时改这条用例、并且去看一眼文档。
 *
 * 不在这里重复"行为怎么算"的用例（那些在 `settle.test.ts` / `shiSanLan.test.ts` / `tiles.test.ts` 里），
 * 这里只做**文档 ↔ 代码的对照**：数值、开关、以及"某个状态根本不存在"这类结构事实。
 *
 * 一个已经抓到的真问题见文件末尾的 `R-05 / R-11` 那组 —— 文档的汇总表里两行自相矛盾。
 */
const cfg = DEFAULT_RULE_CONFIG;

const PENG = (tile: number): Meld => ({ kind: 'PENG', tile, fromSeat: 0 });
const GANG = (kind: Meld['kind'], tile: number): Meld => ({ kind, tile, fromSeat: null });

describe('R-01 牌张：136 张、有字牌、无花牌', () => {
  it('整副 136 张、34 种，字牌（东南西北中发白）在，花牌不在', () => {
    const wall = fullWall();
    expect(wall).toHaveLength(136);
    expect(new Set(wall).size).toBe(34);
    // 字牌 41..44（东南西北）+ 51..53（中发白）
    for (const tile of [41, 42, 43, 44, 51, 52, 53]) {
      expect(wall.filter((t) => t === tile), `牌码 ${tile}`).toHaveLength(4);
    }
    // 花牌（规则文档里编到 61+）一张都不该在牌墙里
    expect(wall.some((t) => t >= 61)).toBe(false);
  });

  it('配置里也写着 FULL_136（不是"代码恰好凑够了 136"）', () => {
    expect(cfg.tileSet).toBe('FULL_136');
  });
});

describe('R-02 坐庄与 5 人轮换：四种结果各自谁坐庄、谁下场', () => {
  const state = () => ({ ...startRound(startBase()), dealer: 1 });

  it('庄家胡（含自摸）→ 庄家连庄，**对家**下场', () => {
    expect(nextRoundSeating(state(), { kind: 'HU', winners: [{ seat: 1, zimo: true }], loserSeat: null })).toEqual(
      { dealer: 1, sittingOut: 3 },
    );
  });

  it('别人**点炮**胡 → 胡牌者坐庄，**放炮者**下场', () => {
    expect(
      nextRoundSeating(state(), { kind: 'HU', winners: [{ seat: 2, zimo: false }], loserSeat: 0 }),
    ).toEqual({ dealer: 2, sittingOut: 0 });
  });

  it('别人**自摸**胡 → 胡牌者坐庄，自摸者的**对家**下场（这一条是原设计漏的，R-02 补的）', () => {
    expect(nextRoundSeating(state(), { kind: 'HU', winners: [{ seat: 2, zimo: true }], loserSeat: null })).toEqual(
      { dealer: 2, sittingOut: 0 },
    );
  });

  it('荒庄 → 庄家的**对家**坐庄，**庄家**下场', () => {
    expect(nextRoundSeating(state(), { kind: 'HUANG_ZHUANG' })).toEqual({ dealer: 3, sittingOut: 1 });
  });

  it('庄家付款**不加倍**：荒庄是庄家赔每家 1 分（共 3 分），不是 2 分', () => {
    expect(cfg.score.huangZhuang.dealerPaysEach).toBe(1);
    const settled = settleRound({ ...startRound(startBase()), dealer: 0 }, { kind: 'HUANG_ZHUANG' }, cfg);
    expect(settled.deltas).toEqual([-3, 1, 1, 1]);
  });
});

describe('R-03 假胡算胡，自摸与点炮都能胡', () => {
  it('开关是开着的，而且**点炮路径**没有关掉（`allowRon`）', () => {
    expect(cfg.hu.jiaHu.enabled).toBe(true);
    expect(cfg.hu.jiaHu.allowRon).toBe(true);
  });

  it('四个牌型开关都是开的（假胡/七对/十三烂/字牌顺）—— 关掉任何一个都等于改了规则', () => {
    expect(cfg.hu.qiDui.enabled).toBe(true);
    expect(cfg.hu.shiSanLan.enabled).toBe(true);
    expect(cfg.hu.wordStraight.enabled).toBe(true);
  });
});

describe('R-04 + R-07 归一：4 张全归你就算，**杠也算**，补杠之后不归零', () => {
  it('碰 3 + 暗 1 = 四归一（这是最容易漏的一条：副露里的牌也要数）', () => {
    expect(countGuiYi(countsOf([11]), [PENG(11)])).toBe(1);
  });

  it('三种杠都按 4 张折算（明杠/暗杠/补杠），而不是 3 张', () => {
    for (const kind of ['MING_GANG', 'AN_GANG', 'BU_GANG'] as const) {
      expect(meldTileCount(GANG(kind, 21)), kind).toBe(4);
      expect(countGuiYi(countsOf([]), [GANG(kind, 21)]), kind).toBe(1);
    }
  });

  it('碰 3 张再补成杠：归一**还在**（"做了个合法动作反而掉分"这条已经改了）', () => {
    // 补杠前：碰在副露里、手里没有第 4 张 → 3 张，不算归一
    expect(countGuiYi(countsOf([]), [PENG(31)])).toBe(0);
    // 补杠后：副露变成 4 张 → 归一
    expect(countGuiYi(countsOf([]), [GANG('BU_GANG', 31)])).toBe(1);
  });
});

describe('R-05 十三烂：合法性与炮数是**两件事**', () => {
  /** 十三烂的手牌：数牌按 1/4/7 取，字牌取前 n 种。 */
  const lan = (words: number): number[] => {
    const numberTiles: number[] = [];
    for (const suit of [1, 2, 3]) {
      for (const rank of [1, 4, 7]) {
        if (numberTiles.length < 14 - words) numberTiles.push(suit * 10 + rank);
      }
    }
    const wordPool = [41, 42, 43, 44, 51, 52, 53];
    return [...numberTiles, ...wordPool.slice(0, words)];
  };

  it('13 张时字牌 5 或 6 种 → **只能自摸**（点炮路径必须直接拒胡）', () => {
    expect(requiresSelfDraw(countsOf(lan(5)))).toBe(true);
    expect(requiresSelfDraw(countsOf(lan(6)))).toBe(true);
  });

  it('七星（7 种字牌）→ 点炮也能胡', () => {
    expect(requiresSelfDraw(countsOf(lan(7)))).toBe(false);
  });

  it('**炮数取 `QI_XING_SCORE`（自摸 4 / 点炮 2）** —— 不是文档汇总表 R-05 行里那个"3 炮"', () => {
    // 来源：同一份文档的 R-11（第二轮计分）与 M6-5 改动行："七星 5/3 → 4/2"。
    // R-05 那一行的"降到 3 炮"是**改动之前的**数值，没能跟上（见文件末尾的对照）。
    expect(QI_XING_SCORE).toEqual({ zimo: 4, ron: 2 });
    expect(scoreOfTags(new Set(['QI_XING_SHI_SAN_LAN']), cfg, { zimo: true }).score).toBe(4);
    expect(scoreOfTags(new Set(['QI_XING_SHI_SAN_LAN']), cfg, { zimo: false }).score).toBe(2);
  });

  it('普通十三烂（5/6 种字牌）自摸是 3 炮，与 R-05 的"5 张 3 炮"一致', () => {
    expect(scoreOfTags(new Set(['SHI_SAN_LAN']), cfg, { zimo: true }).score).toBe(3);
  });
});

describe('R-06 漏碰 / 漏胡：**这两条限制不存在**，所以状态里也不该有它们的影子', () => {
  it('牌局状态里没有任何"漏过什么"的账（Task 13 因此整条取消）', () => {
    const keys = Object.keys(startRound(startBase()));
    for (const forbidden of ['forgot', 'forgotten', 'passed', 'missed', 'banned']) {
      expect(keys.filter((k) => k.toLowerCase().includes(forbidden)), forbidden).toEqual([]);
    }
  });

  it('配置里也没有"禁碰/禁胡"这类开关（加了就等于把 R-06 改了）', () => {
    const json = JSON.stringify(cfg).toLowerCase();
    for (const forbidden of ['forget', 'ban', 'missed']) {
      expect(json.includes(forbidden), forbidden).toBe(false);
    }
  });
});

describe('R-08 荒庄：庄家赔每家 1 分，不看听牌', () => {
  it('deltas 与牌型无关（没有"听牌"这个输入）', () => {
    const settled = settleRound({ ...startRound(startBase()), dealer: 2 }, { kind: 'HUANG_ZHUANG' }, cfg);
    expect(settled.deltas).toEqual([1, 1, -3, 1]);
    expect(settled.detail).toEqual([]); // 荒庄没有番型明细
  });
});

describe('R-11 第二轮计分：封顶 8、只有杠能突破', () => {
  it('封顶是 8，而且**只有结算那一层**取 min（计分表给的是封顶前的原始分）', () => {
    expect(cfg.score.cap).toBe(8);
    // 清一色真在表里是 10，落到 8 是 cap 的功劳 —— 所以计分表不能自己取 min
    expect(scoreOfTags(new Set(['PING_HU', 'QING_YI_SE_ZHEN']), cfg, { zimo: false }).score).toBeGreaterThan(
      cfg.score.cap,
    );
  });

  it('碰碰胡 4、碰碰胡单调 8（后者正好吃满封顶）', () => {
    expect(STRUCTURE_SCORE.PENG_PENG_HU).toBe(4);
    expect(STRUCTURE_SCORE.PENG_PENG_HU_DAN_DIAO).toBe(8);
    expect(STRUCTURE_SCORE.PENG_PENG_HU_DAN_DIAO).toBe(cfg.score.cap);
  });

  it('买码（R-09，2026-11 牌友确认并落地）：张数 0/1/2/4，买码位算零和的第五方', () => {
    expect(cfg.buyCode.count).toBe(0); // 默认不买码 = 普通 4 人局
    expect(() => validateRuleConfig({ ...cfg, buyCode: { count: 3 as never } })).toThrow(/buyCode/);
    // 五家零和：不管码牌翻出什么，`Σ 四家 + 买码位` 都必须为 0（详见 score/ma.test.ts）
    const state = startRound(startBase({ cfg: { ...cfg, buyCode: { count: 2 } } }));
    const settled = settleRound(
      state,
      {
        kind: 'HU',
        winners: [{ seat: state.dealer, zimo: true, tags: ['PING_HU'] }],
        loserSeat: null,
      },
      state.cfg,
    );
    expect(settled.maDetail).toHaveLength(2);
    const total = settled.deltas.reduce((a, b) => a + b, 0) + settled.maDelta;
    expect(total).toBe(0);
  });
});

// R-10（口令已取消、只有 6 位房号）原本断言的是 @net/messages 的 REFUSE_REASONS 表里没有任何
// 与口令有关的错误码。传输层一期不移植，该用例随 @net/messages 一起移出。
// 这里**不留空 describe**：Vitest 对空 suite 会报 "No test found in suite" 并计为失败。

