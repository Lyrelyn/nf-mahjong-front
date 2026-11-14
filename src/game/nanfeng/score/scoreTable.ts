// 移植自 nf-mahjong/assets/scripts/core/score/scoreTable.ts（逻辑未改动）
/**
 * 分层计分（修正 S-01 / S-06 的落地）。
 *
 * 规则文档原本用一张 38 行的"组合键 → 炮数"枚举表，值是作者**直接列出**的、无法由基础分推导
 * （例如"七对 + 清一色真胡 = 21"）。Task 0 与牌友确认后，**放弃那张表**，改为分层相加：
 *
 * ```
 * 炮数 = 结构型分(取最高) + 一色加成 + 归一加成 + 事件加成
 * ```
 *
 * 每一层内部的规则：
 *   - **结构型（取最高）**：平胡 1 / 十三烂 3 / 碰碰胡 4 / 碰碰胡单调 8 / 七对 8；七星分档
 *     自摸 4、其他 2。**假胡没有结构分（0）** —— 这一条正是"清一色假胡 = 4"成立的原因。
 *   - **一色加成（取最高）**：清一色真 10 / 假 4，字一色真 20 / 假 11。清一色与字一色不可能同时
 *     成立（一个要求全数牌同花色、一个要求全字牌），所以取最高等价于取唯一。
 *     真胡时它是**加成**：平胡 1 + 清一色真 10 = **11**、平胡 1 + 字一色真 20 = **21**
 *     —— 这两个是**封顶前**的原始分，最终得分见下面那段。
 *   - **归一加成（取最高）**：四 3 / 八 5 / 十二 9；个数唯一，所以取最高等价于取唯一。
 *   - **事件加成（相加）**：杠上开花 +4；抢杠胡本身 0 分（分数来自牌型）。
 *
 * `cfg.score.override` 仍然保留：命中 `tagKey` 的组合直接返回覆盖值，用于以后再遇到非线性玩法。
 * **2026-10-06 改规：手牌炮数封顶 8，只有杠能突破。** 本函数返回的仍然是**封顶前的原始分**，
 * `cap` 在结算那一层作用（`score/settle.ts` 里 `Math.min(unit, cap)`），而且**杠分是在封顶之后
 * 才并入** `deltas` 的 —— 所以"只有杠能突破封顶"不需要额外代码，它是既有结构的自然结果。
 * 于是：清一色真 / 字一色真假 最终都落到 8；碰碰胡单调 8 正好吃满封顶；清一色假 4 与七星 4/2
 * 都在封顶线以内、不受影响。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

import { tagKey, type FanTag } from '../fanTags';
import type { RuleConfig } from '../ruleConfig';

/** 结构型基础分（互斥，取最高）。 */
export const STRUCTURE_SCORE: Record<string, number> = {
  PING_HU: 1,
  SHI_SAN_LAN: 3,
  PENG_PENG_HU: 4,
  /** 碰碰胡 + 单钓将。2026-10-06 新增；8 正好等于封顶，所以它天然吃满。 */
  PENG_PENG_HU_DAN_DIAO: 8,
  QI_DUI: 8,
};

/** 七星十三烂的两档炮数（2026-10-06 改为自摸 4 / 其他 2，原 5/3）。 */
export const QI_XING_SCORE = { zimo: 4, ron: 2 } as const;

/** 一色加成（真胡时叠加在结构分上；假胡没有结构分，所以它就是全部）。 */
export const COLOR_BONUS: Record<string, number> = {
  QING_YI_SE_ZHEN: 10,
  /** 2026-10-06 改为 4（原 6）—— 假胡很容易凑一色，压下来。 */
  QING_YI_SE_JIA: 4,
  ZI_YI_SE_ZHEN: 20,
  ZI_YI_SE_JIA: 11,
};

/** 归一加成（互斥，取最高）。 */
export const GUI_YI_BONUS: Record<string, number> = {
  SI_GUI_YI: 3,
  BA_GUI_YI: 5,
  SHI_ER_GUI_YI: 9,
};

/** 事件加成（相加）。 */
export const EVENT_BONUS: Record<string, number> = {
  GANG_SHANG_KAI_HUA: 4,
  QIANG_GANG_HU: 0,
};

export interface ScoreResult {
  score: number;
  /** 没有在分层表里定义的标签。**正常路径必须为空数组**（留字段是为了以后加规则时能报出来）。 */
  unmapped: FanTag[];
}

function maxIn(table: Record<string, number>, tags: ReadonlySet<FanTag>): number {
  let best = 0;
  for (const [tag, value] of Object.entries(table)) {
    if (tags.has(tag as FanTag)) best = Math.max(best, value);
  }
  return best;
}

export function scoreOfTags(
  tags: ReadonlySet<FanTag>,
  cfg: RuleConfig,
  opts: { zimo?: boolean } = {},
): ScoreResult {
  const overridden = cfg.score.override[tagKey(tags)];
  if (overridden !== undefined) return { score: overridden, unmapped: [] };

  const structure =
    tags.has('QI_XING_SHI_SAN_LAN')
      ? Math.max(
          maxIn(STRUCTURE_SCORE, tags),
          opts.zimo === true ? QI_XING_SCORE.zimo : QI_XING_SCORE.ron,
        )
      : maxIn(STRUCTURE_SCORE, tags);

  const color = maxIn(COLOR_BONUS, tags);
  const guiYi = maxIn(GUI_YI_BONUS, tags);

  let event = 0;
  for (const [tag, value] of Object.entries(EVENT_BONUS)) {
    if (tags.has(tag as FanTag)) event += value;
  }

  const known = new Set<string>([
    ...Object.keys(STRUCTURE_SCORE),
    ...Object.keys(COLOR_BONUS),
    ...Object.keys(GUI_YI_BONUS),
    ...Object.keys(EVENT_BONUS),
    'QI_XING_SHI_SAN_LAN',
    // 自摸不由标签表达（RoundWinner.zimo），但万一被塞进来也不该算"未定义"
    'ZI_MO',
  ]);
  const unmapped = Array.from(tags).filter((tag) => !known.has(tag));

  return { score: structure + color + guiYi + event, unmapped };
}
