// 移植自 nf-mahjong/assets/scripts/core/ruleConfig.ts（逻辑未改动）
/**
 * 规则配置：南丰麻将的全部可调数值集中在这里。
 *
 * 每个数值都来自 spec 或规则文档；Task 0 的 R-01~R-08 / R-10 与 Q-01~Q-06 已逐条确认，
 * 下文带「R-xx / Q-xx」注释的项就是确认结果。**尚未确认的只有一处**：规则文档计分表的
 * 38 行组合值（Task 18 会整理成对照表请牌友过目，落在 score.override 里）。
 *
 * 本文件属于引擎禁区（spec §3.3）：不得 import Cocos、不得使用 Math.random / Date.now / IO。
 */

import { FAN_TAG_ID, tagKey, type FanTag } from './fanTags';
import { isMaCount, type MaCount } from './score/ma';

export interface RuleConfig {
  /** 牌张构成。R-01 已确认 136 张（万条筒 1-9 各 4 张 + 东南西北 + 中发白，无花牌）。 */
  tileSet: 'FULL_136';

  hu: {
    /** 假胡（全同一花色 / 全字牌，不需成结构）。R-03 确认存在，自摸与点炮都可以。 */
    jiaHu: { enabled: boolean; allowRon: boolean };
    qiDui: { enabled: boolean };
    shiSanLan: { enabled: boolean };
    /** 字牌顺子（南丰特色，5 种模式）。关掉后退化为标准刻子判定。 */
    wordStraight: { enabled: boolean };
  };

  score: {
    /** 1 炮 = 1 分（已确认）。 */
    baseScore: number;
    /** 0 表示不封顶。**2026-10-06 改为 8**：手牌炮数封顶 8，只有杠分能突破（杠分在封顶之后并入）。 */
    cap: number;
    /**
     * 自摸是否翻倍。**Q-01 确认为 false** —— 自摸只是三家各付、单价与点炮相同。
     * 保留开关是为了以后想改成翻倍时不用动计分主干。
     */
    zimoDouble: boolean;
    /** 杠上开花加炮（已确认 4）。 */
    gangShangKaiHua: number;
    /**
     * 杠分（Q-02，规则文档只提了"杠分"一词没给数字）：
     *   - 直杠（MING_GANG）：点杠那一家**单独**付 mingGang 分；
     *   - 补杠（BU_GANG）/ 暗杠（AN_GANG）：其余三家**各**付 buGang / anGang 分。
     * **开杠即时入账**，独立于胡牌分 —— 荒庄时开过的杠照样算。补杠的 +3 必须等抢杠窗口
     * 关闭后才入账（被抢杠则本次不计），这是 Task 16 的一条明确约束。
     */
    gang: { mingGang: number; buGang: number; anGang: number };
    /**
     * 荒庄（R-08，规则文档只出现过"烧庄分"这个词）：庄家赔每家 dealerPaysEach 分，
     * 共 3 分。**不看听牌与否** —— 所以不需要听牌判定。
     */
    huangZhuang: { dealerPaysEach: number };
    /** 非线性组合的例外覆盖表，键由 fanTags.tagKey 生成。 */
    override: Record<string, number>;
  };

  claim: {
    /** 鸣牌窗口时长（spec §6.2）。 */
    windowMs: number;
    /** 自己回合出牌超时（spec §11）。 */
    discardTimeoutMs: number;
    /**
     * 一炮多响（Q-05）：true = 多家同时胡都算，放炮者分别付给每家；false = 只取最近一家。
     */
    allowMultipleHu: boolean;
  };

  /** 暗杠是否需要翻牌明示。 */
  anGangRevealTile: boolean;

  /**
   * 买码 / 码牌（R-09 已确认）：0 = 不买码，1/2/4 = 开局从牌墙末尾预留几张码牌给第 5 个
   * 参与者（买码位）。买码位**复制被指向座位这一局的每一笔现金流**，所以它是零和的第五方。
   * 口径与推导见 `docs/superpowers/specs/2026-11-08-nanfeng-ma-design.md`。
   */
  buyCode: { count: MaCount };
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  tileSet: 'FULL_136',
  hu: {
    jiaHu: { enabled: true, allowRon: true },
    qiDui: { enabled: true },
    shiSanLan: { enabled: true },
    wordStraight: { enabled: true },
  },
  score: {
    baseScore: 1,
    cap: 8,
    zimoDouble: false,
    gangShangKaiHua: 4,
    gang: { mingGang: 2, buGang: 1, anGang: 2 },
    huangZhuang: { dealerPaysEach: 1 },
    override: {},
  },
  claim: { windowMs: 15000, discardTimeoutMs: 20000, allowMultipleHu: true },
  anGangRevealTile: true,
  buyCode: { count: 0 },
};

/**
 * 配置自检：数值不合法立即抛错，不要带病开局。
 *
 * score.override 的键必须能被 tagKey 原样重建（标签名拼错、顺序写反都在启动时直接失败）。
 * 这条校验就是规则文档里"分表键启动校验"的落地。
 */
export function validateRuleConfig(cfg: RuleConfig): void {
  const fail = (msg: string): never => {
    throw new RangeError(`规则配置非法：${msg}`);
  };
  if (cfg.score.baseScore < 1) fail('score.baseScore 必须 >= 1');
  if (cfg.score.cap < 0) fail('score.cap 不能为负（0 表示不封顶）');
  if (cfg.score.gangShangKaiHua < 0) fail('score.gangShangKaiHua 不能为负');
  const { mingGang, buGang, anGang } = cfg.score.gang;
  if (mingGang < 0 || buGang < 0 || anGang < 0) fail('score.gang 的分值不能为负');
  if (cfg.score.huangZhuang.dealerPaysEach < 0) fail('score.huangZhuang.dealerPaysEach 不能为负');
  if (cfg.claim.windowMs <= 0) fail('claim.windowMs 必须为正');
  if (cfg.claim.discardTimeoutMs <= 0) fail('claim.discardTimeoutMs 必须为正');
  if (!isMaCount(cfg.buyCode.count)) {
    // 码牌张数是产品口径（R-09）：0 不买码；1/2/4 是牌桌上真实会选的三种档位。
    fail(`buyCode.count 只能是 0/1/2/4，收到 ${cfg.buyCode.count}`);
  }

  for (const key of Object.keys(cfg.score.override)) {
    const parts = key.split('+') as FanTag[];
    for (const part of parts) {
      if (!(part in FAN_TAG_ID)) fail(`score.override 的键 "${key}" 含未知标签 "${part}"`);
    }
    const canonical = tagKey(parts);
    if (canonical !== key) {
      fail(`score.override 的键 "${key}" 顺序不正确，应为 "${canonical}"`);
    }
  }
}
