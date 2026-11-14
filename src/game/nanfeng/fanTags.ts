// 移植自 nf-mahjong/assets/scripts/core/fanTags.ts（逻辑未改动）
/**
 * 牌型标签与其稳定 id。
 *
 * S-06 修正：规则文档原本用"FanType 枚举声明顺序"做组合键，任何人重排枚举都会静默击穿整张计分表。
 * 这里给每个标签一个**显式稳定 id**，tagKey 按 id 升序生成组合键。
 *
 * id 分段遵循规则文档计分表的书写顺序（这也是 canonicalKey 的契约）：
 *   10-19 结构型 → 20-29 一色型 → 30-39 归一系列 → 40-49 事件型
 * 因此 `ZI_YI_SE_ZHEN+SI_GUI_YI` 是正确键，而字典序的 `SI_GUI_YI+ZI_YI_SE_ZHEN` 会让整张表失配。
 *
 * 本文件属于引擎禁区（spec §3.3）。
 */

export type FanTag =
  // 结构型
  | 'PING_HU'
  | 'PENG_PENG_HU'
  /** 碰碰胡且**胡的那张牌配成将**（听单钓）。2026-10-06 新增，8 炮。 */
  | 'PENG_PENG_HU_DAN_DIAO'
  | 'QI_DUI'
  | 'SHI_SAN_LAN'
  | 'QI_XING_SHI_SAN_LAN'
  // 一色型
  | 'QING_YI_SE_ZHEN'
  | 'QING_YI_SE_JIA'
  | 'ZI_YI_SE_ZHEN'
  | 'ZI_YI_SE_JIA'
  // 归一系列
  | 'SI_GUI_YI'
  | 'BA_GUI_YI'
  | 'SHI_ER_GUI_YI'
  // 事件型
  | 'ZI_MO'
  | 'GANG_SHANG_KAI_HUA'
  | 'QIANG_GANG_HU';

export const FAN_TAG_ID: Record<FanTag, number> = {
  PING_HU: 10,
  PENG_PENG_HU: 11,
  QI_DUI: 12,
  SHI_SAN_LAN: 13,
  QI_XING_SHI_SAN_LAN: 14,
  // 15 是结构型段里剩下的空位。**新标签一律往后取号**，绝不重排已有 id
  // （重排会让已存在的 score.override 键静默改指到别的标签）。
  PENG_PENG_HU_DAN_DIAO: 15,

  QING_YI_SE_ZHEN: 20,
  QING_YI_SE_JIA: 21,
  ZI_YI_SE_ZHEN: 22,
  ZI_YI_SE_JIA: 23,

  SI_GUI_YI: 30,
  BA_GUI_YI: 31,
  SHI_ER_GUI_YI: 32,

  ZI_MO: 40,
  GANG_SHANG_KAI_HUA: 41,
  // 42 / 43 曾是天胡 / 地胡，Q-03 确认南丰麻将没有这两个牌型 —— id 空出来但**不复用**
  // （复用会让已有的 score.override 键静默改指到别的标签）。
  QIANG_GANG_HU: 44,
};

/** 全部标签，顺序即 tagKey 的排序结果。 */
export const ALL_FAN_TAGS: readonly FanTag[] = (Object.keys(FAN_TAG_ID) as FanTag[]).sort(
  (a, b) => FAN_TAG_ID[a] - FAN_TAG_ID[b],
);

/** 组合键：去重后按稳定 id 升序，以 '+' 连接。 */
export function tagKey(tags: Iterable<FanTag>): string {
  // **`Array.from` 而不是 `[...new Set(tags)]`**：Cocos 的 H5 转译在 loose 模式下把
  // `[...iterable]` 编译成 `[].concat(iterable)`，于是这里得到的是 `[Set]` ——
  // 排序退化成对单元素数组排序，`join('+')` 出来的是 **`"[object Set]"`**。
  // 后果：`score.override` 按组合键查表**永远命中不了**（每一手牌都是同一个键），
  // 而这在单测与 sim 里都看不出来（它们跑的是现代目标，真展开）。
  // 构建产物里实测过 `[].concat(new Set(tags))`，所以这不是理论风险。
  const ids = Array.from(new Set(tags)).sort((a, b) => FAN_TAG_ID[a] - FAN_TAG_ID[b]);
  return ids.join('+');
}
