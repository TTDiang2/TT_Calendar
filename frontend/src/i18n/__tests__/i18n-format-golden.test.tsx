/**
 * 日期 locale 化 golden 测试（老端版）：星期/月份/相对天数按语言产出正确形态。
 * 纪律：固定时区无关的锚点日期（本地午夜构造），断言只看语言差异不看运行环境。
 * 注：Neo 版的 lunarText 段依赖 Neo 特有 adapt/labels + contracts——老端在 A2 建立
 * 老端版显示层映射后恢复该段（手册 §5.2 农历数值信息 → 显示层组装）。
 */
import { describe, expect, it } from 'vitest'
import { fmtDate, fmtWeekday, fmtMonthName, fmtRelativeDays } from '../index'

// 2026-10-03 是周六（本地时区构造，避免 UTC 偏移翻转日期）
const SAT = new Date(2026, 9, 3)

describe('fmtWeekday / fmtMonthName', () => {
  it('周六在 8 种语言下的 short 形态', () => {
    expect(fmtWeekday('zh-CN', SAT, 'short')).toBe('周六')
    expect(fmtWeekday('en', SAT, 'short')).toBe('Sat')
    expect(fmtWeekday('ja', SAT, 'short')).toBe('土')
    expect(fmtWeekday('ko', SAT, 'short')).toBe('토')
    expect(fmtWeekday('ru', SAT, 'short')).toBe('сб')
    // fr/es 只断言非空且不含中文（full-ICU 下格式可能因 ICU 版本微调）
    expect(fmtWeekday('fr', SAT, 'short')).not.toMatch(/[\u4e00-\u9fff]/)
    expect(fmtWeekday('es', SAT, 'short')).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('月份名：zh 独立月名用汉字（CLDR），en 全名', () => {
    // 独立月份名走 CLDR standalone 形态：zh 是「十月」（组合日期里仍是「10月」，见下一用例）
    expect(fmtMonthName('zh-CN', SAT, 'long')).toBe('十月')
    expect(fmtMonthName('en', SAT, 'long')).toBe('October')
  })

  it('日期 skeleton：各语言字段顺序自动正确', () => {
    // zh: 2026年10月3日；en: October 3, 2026（断言包含关键片段而非精确串，防 ICU 波动）
    expect(fmtDate('zh-CN', SAT, { year: 'numeric', month: 'long', day: 'numeric' })).toMatch(/2026/)
    expect(fmtDate('zh-CN', SAT, { year: 'numeric', month: 'long', day: 'numeric' })).toMatch(/10月/)
    expect(fmtDate('en', SAT, { year: 'numeric', month: 'long', day: 'numeric' })).toMatch(/October/)
  })
})

describe('fmtRelativeDays（复数/介词由 Intl 承担）', () => {
  it('zh/en/ru 的「N 天后」', () => {
    expect(fmtRelativeDays('zh-CN', 3)).toBe('3天后')
    expect(fmtRelativeDays('en', 3)).toBe('in 3 days')
    expect(fmtRelativeDays('en', -1)).toBe('yesterday')
    expect(fmtRelativeDays('ru', 3)).toMatch(/3/)
  })
})
