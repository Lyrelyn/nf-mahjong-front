import { describe, expect, it } from 'vitest'
import { COUNT_SIZE, fromCode, fromCodes, isValidCode, toCode, toCodes } from './tileCodec'
import { TILE_TYPES } from '../core/rules/tiles'

describe('南丰牌码适配层', () => {
  it('34 种牌全部可往返转换，且互不重复', () => {
    expect(TILE_TYPES).toHaveLength(34)
    const codes = TILE_TYPES.map(toCode)
    expect(new Set(codes).size).toBe(34)
    expect(fromCodes(codes)).toEqual(TILE_TYPES)
  })

  it('三色映射按南丰的 万/条/筒 顺序，不按前端字母顺序硬套', () => {
    // 前端 m=万 / p=筒 / s=条；南丰是 万 11 / 条 21 / 筒 31
    expect(toCode('m1')).toBe(11)
    expect(toCode('m9')).toBe(19)
    expect(toCode('s1')).toBe(21) // 条 → 21，不是 31
    expect(toCode('s9')).toBe(29)
    expect(toCode('p1')).toBe(31) // 筒 → 31
    expect(toCode('p9')).toBe(39)
  })

  it('字牌按 东南西北 41..44、中发白 51..53 编码', () => {
    expect(toCode('east')).toBe(41)
    expect(toCode('north')).toBe(44)
    expect(toCode('red')).toBe(51)   // 中
    expect(toCode('green')).toBe(52) // 发
    expect(toCode('white')).toBe(53) // 白
  })

  it('所有编码都落在 counts 数组范围内', () => {
    for (const tile of TILE_TYPES) {
      const code = toCode(tile)
      expect(code).toBeGreaterThan(0)
      expect(code).toBeLessThan(COUNT_SIZE)
      expect(isValidCode(code)).toBe(true)
    }
  })

  it('非法输入抛错而不是静默返回哨兵值', () => {
    expect(() => toCode('z9' as never)).toThrow(RangeError)
    expect(() => toCode('white ' as never)).toThrow(RangeError)
    expect(() => fromCode(10)).toThrow(RangeError)
    expect(() => fromCode(40)).toThrow(RangeError)
    expect(() => fromCode(45)).toThrow(RangeError)
    expect(() => fromCode(54)).toThrow(RangeError)
    expect(() => fromCode(11.5)).toThrow(RangeError)
    expect(isValidCode(20)).toBe(false)
    expect(isValidCode(50)).toBe(false)
  })
})
