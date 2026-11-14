// 牌码 → 中文牌名。只用于界面显示，不参与任何判定。
import type { Tile } from './tiles'

const RANK_TEXT = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const
const WIND_TEXT = ['东', '南', '西', '北'] as const
const DRAGON_TEXT = ['中', '发', '白'] as const

/** 11..19 万、21..29 条、31..39 筒、41..44 风、51..53 箭。 */
export function tileText(tile: Tile): string {
  if (tile >= 11 && tile <= 19) return `${RANK_TEXT[tile % 10]}万`
  if (tile >= 21 && tile <= 29) return `${RANK_TEXT[tile % 10]}条`
  if (tile >= 31 && tile <= 39) return `${RANK_TEXT[tile % 10]}筒`
  if (tile >= 41 && tile <= 44) return WIND_TEXT[tile - 41] ?? '风'
  if (tile >= 51 && tile <= 53) return DRAGON_TEXT[tile - 51] ?? '箭'
  return '?'
}

/** 副露的中文摘要，例如 `碰 三万`、`暗杠 东风`。 */
export function meldText(kind: string, tile: Tile): string {
  const name = tileText(tile)
  if (kind === 'PENG') return `碰 ${name}`
  if (kind === 'MING_GANG') return `明杠 ${name}`
  if (kind === 'AN_GANG') return `暗杠 ${name}`
  if (kind === 'BU_GANG') return `补杠 ${name}`
  return name
}

/** 座位相对本家的称呼（0 就是本家）。 */
export function seatText(seat: number, humanSeat: number, seatCount = 4): string {
  if (seat === humanSeat) return '本家'
  const distance = (seat - humanSeat + seatCount) % seatCount
  if (distance === 1) return '下家'
  if (distance === 2) return '对家'
  return '上家'
}
