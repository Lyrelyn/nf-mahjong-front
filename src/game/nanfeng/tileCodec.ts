// 牌编码适配层：南丰引擎内部用整数牌码（与 nf-mahjong 旧项目、后端 Python 同一套），
// 前端 UI / 表现层 / 契约用 'm1'..'s9' + 'east'/'south'/'west'/'north'/'red'/'green'/'white' 字符串。
//
// 编码约定（旧项目 spec「Global Constraints」，后端 app/core/nanfeng/tiles.py 一致）：
//   万 11..19 / 条 21..29 / 筒 31..39 / 风 41..44（东南西北）/ 箭 51..53（中发白）
//
// **转换只在这一层发生**：引擎之外不得出现整数牌码，引擎之内不得出现字符串牌。
// 前端三色命名是 m(万)/p(筒)/s(条)，与南丰的 万/条/筒 顺序不同，映射见下表，不要按顺序硬套。
import type { HonorTile, TileType } from '../core/contracts/types'

/** 万 → m */
const WAN_SUIT: readonly TileType[] = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']
/** 条 → s */
const TIAO_SUIT: readonly TileType[] = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']
/** 筒 → p */
const TONG_SUIT: readonly TileType[] = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']

/** 风 41..44：东南西北 */
const WIND_TILES: readonly HonorTile[] = ['east', 'south', 'west', 'north']
/** 箭 51..53：中发白（注意顺序是 中/发/白，不是 中/白/发） */
const DRAGON_TILES: readonly HonorTile[] = ['red', 'green', 'white']

/** counts 数组长度：下标即牌码；0..10 与 54.. 不使用（与旧项目 COUNT_SIZE 一致）。 */
export const COUNT_SIZE = 54

function suitTile(suit: readonly TileType[], index: number, label: string): TileType {
  const tile = suit[index]
  if (tile === undefined) throw new RangeError(`${label} 点数越界：${index + 1}`)
  return tile
}

/**
 * 前端字符串牌 → 整数牌码。非法牌直接抛错，不静默返回哨兵值
 * （静默值会在判胡里变成"一张不存在的牌"，比崩溃更难查）。
 */
export function toCode(tile: TileType): number {
  const suited = /^([mps])([1-9])$/.exec(tile)
  if (suited) {
    const rank = Number(suited[2])
    if (suited[1] === 'm') return 10 + rank
    if (suited[1] === 's') return 20 + rank
    return 30 + rank
  }
  const wind = WIND_TILES.indexOf(tile as HonorTile)
  if (wind >= 0) return 41 + wind
  const dragon = DRAGON_TILES.indexOf(tile as HonorTile)
  if (dragon >= 0) return 51 + dragon
  throw new RangeError(`非法牌：${tile}`)
}

/** 整数牌码 → 前端字符串牌。越界牌码抛错。 */
export function fromCode(code: number): TileType {
  if (!Number.isInteger(code)) throw new RangeError(`牌码必须是整数：${code}`)
  if (code >= 11 && code <= 19) return suitTile(WAN_SUIT, code - 11, '万')
  if (code >= 21 && code <= 29) return suitTile(TIAO_SUIT, code - 21, '条')
  if (code >= 31 && code <= 39) return suitTile(TONG_SUIT, code - 31, '筒')
  if (code >= 41 && code <= 44) return WIND_TILES[code - 41]!
  if (code >= 51 && code <= 53) return DRAGON_TILES[code - 51]!
  throw new RangeError(`非法牌码：${code}`)
}

export const toCodes = (tiles: readonly TileType[]): number[] => tiles.map(toCode)
export const fromCodes = (codes: readonly number[]): TileType[] => codes.map(fromCode)

/** 整数牌码的有效性判断（与旧项目 isValidTile 同口径，用于解码前的边界校验）。 */
export function isValidCode(code: number): boolean {
  if (!Number.isInteger(code)) return false
  return (code >= 11 && code <= 19)
    || (code >= 21 && code <= 29)
    || (code >= 31 && code <= 39)
    || (code >= 41 && code <= 44)
    || (code >= 51 && code <= 53)
}
