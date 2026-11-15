// 对应后端 app/core/nanfeng/hu/plain_hu.py（R-12 平胡不能点炮）
/**
 * 纯平胡判定。
 *
 * R-12（2026-11 变更）：**平胡不能胡别人的牌**（点炮 / 抢杠），只能自摸。
 * 其余牌型一律照常 —— 规则只针对"牌型标签里恰好只有一个 PING_HU"这手牌。
 *
 * 为什么单独成模块而不是写在 `pengGang.ts` 里：
 *   1. 判定口径必须与后端逐字一致（两边引擎各自算合法性，分叉就是"单机能胡、联机拒胡"）；
 *   2. **事件型标签不是牌型**。`ZI_MO` / `GANG_SHANG_KAI_HUA` / `QIANG_GANG_HU` 是在判胡之后
 *      由结算/窗口追加的，判"这是什么牌"时必须先剔掉 —— 否则一手平胡抢杠（标签是
 *      `PING_HU + QIANG_GANG_HU`）会被算成"不是平胡"，从抢杠口子溜过去。
 *      `judgeHu` 现在不产出事件标签，但这里不依赖调用方的自觉：传进来的标签自行过滤。
 */
import { FAN_TAG_ID, type FanTag } from '../fanTags'

/** 事件型标签的 id 从 40 起（见 `fanTags.ts` 的分段约定）。 */
const EVENT_TAG_MIN_ID = 40

/** 这个标签是不是"事件型"（自摸 / 杠上开花 / 抢杠胡），而不是牌型。 */
export function isEventTag(tag: FanTag): boolean {
  return FAN_TAG_ID[tag] >= EVENT_TAG_MIN_ID
}

/** 只留牌型标签（剔掉事件型），用于"这是什么牌"一类判定与计分口径的对齐。 */
export function patternTags(tags: Iterable<FanTag>): Set<FanTag> {
  const patterns = new Set<FanTag>()
  for (const tag of tags) if (!isEventTag(tag)) patterns.add(tag)
  return patterns
}

/**
 * 纯平胡：剔掉事件型标签后，牌型标签**恰好只剩** `PING_HU`。
 *
 * 带任何加成（碰碰胡 / 七对 / 十三烂 / 七星 / 一色 / 归一 / 假胡）都不算平胡，照常可以点炮。
 */
export function isPlainHu(tags: Iterable<FanTag>): boolean {
  const patterns = patternTags(tags)
  return patterns.size === 1 && patterns.has('PING_HU')
}
