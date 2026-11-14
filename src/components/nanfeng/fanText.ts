// 番型标签的中文名（只用于界面显示）。
//
// 放在 UI 层而不是引擎目录：`src/game/nanfeng/**` 是纯净层，展示文案不属于规则。
import type { FanTag } from '../../game/nanfeng/fanTags'

const LABELS: Record<FanTag, string> = {
  PING_HU: '平胡',
  PENG_PENG_HU: '碰碰胡',
  PENG_PENG_HU_DAN_DIAO: '碰碰胡单调',
  QI_DUI: '七对',
  SHI_SAN_LAN: '十三烂',
  QI_XING_SHI_SAN_LAN: '七星十三烂',
  QING_YI_SE_ZHEN: '清一色·真',
  QING_YI_SE_JIA: '清一色·假',
  ZI_YI_SE_ZHEN: '字一色·真',
  ZI_YI_SE_JIA: '字一色·假',
  SI_GUI_YI: '四归一',
  BA_GUI_YI: '八归一',
  SHI_ER_GUI_YI: '十二归一',
  ZI_MO: '自摸',
  GANG_SHANG_KAI_HUA: '杠上开花',
  QIANG_GANG_HU: '抢杠胡',
}

export function fanText(tags: readonly FanTag[]): string {
  return tags.map((tag) => LABELS[tag] ?? tag).join(' + ')
}
