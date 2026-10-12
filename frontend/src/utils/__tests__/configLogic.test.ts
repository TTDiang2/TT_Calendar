import { describe, expect, it } from 'vitest'
import { configChanged, setNumberAtPath } from '../configLogic'

interface Cfg {
  weights: { complexity: { high: number; medium: number; low: number } }
  thresholds: number[]
}

const base = (): Cfg => ({
  weights: { complexity: { high: 2, medium: 1.5, low: 1 } },
  thresholds: [0, 3, 8, 15, 25],
})

describe('setNumberAtPath', () => {
  it('按路径写入嵌套数值', () => {
    const out = setNumberAtPath(base(), ['weights', 'complexity', 'high'], '9')
    expect(out.weights.complexity.high).toBe(9)
    expect(out.weights.complexity.low).toBe(1)
  })

  it('写入数组下标', () => {
    const out = setNumberAtPath(base(), ['thresholds', 2], '11')
    expect(out.thresholds).toEqual([0, 3, 11, 15, 25])
  })

  it('不修改入参', () => {
    const before = base()
    setNumberAtPath(before, ['weights', 'complexity', 'low'], '99')
    expect(before.weights.complexity.low).toBe(1)
  })

  it('非法数字返回原引用（供调用方跳过 setState）', () => {
    const before = base()
    // 输入框被清空时 raw 是空串——Number('') 是 0，不是 NaN，故单独断言
    expect(setNumberAtPath(before, ['weights', 'complexity', 'low'], 'abc')).toBe(before)
    expect(setNumberAtPath(before, ['weights', 'complexity', 'low'], 'x1')).toBe(before)
  })

  it('空串会被转成 0 —— 调用方须自行拦住', () => {
    // 这是 Number('') 的语义，不是笔误。记录下来是因为它决定了输入框清空时的行为：
    // 若不想把 0 写进去，调用方要先判断 raw.trim() === ''
    const out = setNumberAtPath(base(), ['weights', 'complexity', 'low'], '')
    expect(out.weights.complexity.low).toBe(0)
  })

  it('接受合法的小数与负数', () => {
    const out = setNumberAtPath(base(), ['weights', 'complexity', 'medium'], '2.25')
    expect(out.weights.complexity.medium).toBe(2.25)
    const neg = setNumberAtPath(base(), ['thresholds', 0], '-5')
    expect(neg.thresholds[0]).toBe(-5)
  })

  it('路径指向不存在的层级时抛错，而不是悄悄造出结构', () => {
    expect(() => setNumberAtPath(base(), ['不存在', 'x'], '1')).toThrow()
  })

  it('单元素路径写入顶层键', () => {
    const out = setNumberAtPath({ a: 1 }, ['a'], '7')
    expect(out.a).toBe(7)
  })
})

describe('configChanged', () => {
  it('键序相同则视为未变更', () => {
    expect(configChanged({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(false)
  })

  it('值不同则视为已变更', () => {
    expect(configChanged({ a: 1 }, { a: 2 })).toBe(true)
  })

  it('键序不同视为已变更（保守，宁可多报脏）', () => {
    expect(configChanged({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })

  it('数组顺序不同视为已变更', () => {
    expect(configChanged({ t: [1, 2] }, { t: [2, 1] })).toBe(true)
  })
})