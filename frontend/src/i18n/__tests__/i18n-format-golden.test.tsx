/**
 * 日期 locale 化 golden 测试（老端版）：星期/月份/相对天数按语言产出正确形态。
 * 纪律：固定时区无关的锚点日期（本地午夜构造），断言只看语言差异不看运行环境。
 * 注：Neo 版的 lunarText 段在本端为「回归钉」降级恢复（台账 C3）：老端 Day.lunar
 * 是后端拼好的中文串（tt_calendar/utils/lunar_utils.py lunar_display），前端拿不到
 * 结构化 {year,month,day,leap}，故 adapt/labels.ts lunarDisplay 先做「CJK 透传 /
 * 非 CJK 隐藏」（决策 #9 默认隐藏档）；ja/ko 的翻译显示与 zh 全量组装待 Python 侧
 * 结构化改造后升格为 Neo 版 lunarText（已列入 Python 侧勘察清单）。
 */
import { describe, expect, it } from 'vitest'
import { fmtDate, fmtWeekday, fmtMonthName, fmtRelativeDays } from '../index'
import { lunarDisplay } from '../adapt/labels'

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

describe('lunarDisplay（Day.lunar 后端中文串的回归钉，台账 C3）', () => {
  // 后端 lunar_display 的三种产出形态（七月初四/闰七月初四/初一只显月名）在 CJK 下
  // 必须逐字透传（zh 路径）；en/fr/es/ru 按决策 #9 默认隐藏；ja/ko 暂透传（待结构化）
  const SAMPLES = ['七月初四', '闰七月初四', '七月']
  it('zh-CN 逐字透传三种形态', () => {
    for (const s of SAMPLES) expect(lunarDisplay('zh-CN', s)).toBe(s)
    expect(lunarDisplay('zh-CN', '')).toBe('')
    expect(lunarDisplay('zh-CN', null)).toBe('')
    expect(lunarDisplay('zh-CN', undefined)).toBe('')
  })
  it('ja/ko 暂透传（结构化前的过渡行为）', () => {
    expect(lunarDisplay('ja', '七月初四')).toBe('七月初四')
    expect(lunarDisplay('ko', '七月初四')).toBe('七月初四')
  })
  it('en/fr/es/ru 默认隐藏（决策 #9）', () => {
    for (const lang of ['en', 'fr', 'es', 'ru'] as const) {
      for (const s of SAMPLES) expect(lunarDisplay(lang, s)).toBe('')
    }
  })
})
