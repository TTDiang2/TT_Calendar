/**
 * Intl 格式化器（日期/时间/数字/相对天数），按「locale + 选项」缓存。
 * 纪律（智者评审）：所有 Intl 构造必须走这里，组件里禁止散写 new Intl.*——
 * 每次渲染新建 DateTimeFormat 的开销在大网格（42 格×每次重渲染）会放大。
 * 日期 pattern 永不作为 t() 翻译串，一律用选项产出各语言正确形态。
 */
import type { Lang } from './core'

const dtfCache = new Map<string, Intl.DateTimeFormat>()

export function fmtDate(lang: Lang, date: Date, options: Intl.DateTimeFormatOptions): string {
  const key = `${lang}|${JSON.stringify(options)}`
  let f = dtfCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(lang, options)
    dtfCache.set(key, f)
  }
  return f.format(date)
}

/** 星期名（'一'/'周一'/'星期一' 由 width 控制；注意 ru/es 的 short 偏长，UI 要给宽度容忍）。 */
export function fmtWeekday(lang: Lang, date: Date, width: 'short' | 'long' | 'narrow' = 'short'): string {
  return fmtDate(lang, date, { weekday: width })
}

/** 月份名（'1月'/'January'/'1月'——各语言自动）。 */
export function fmtMonthName(lang: Lang, date: Date, width: 'short' | 'long' | 'numeric' = 'long'): string {
  return fmtDate(lang, date, { month: width })
}

const nfCache = new Map<Lang, Intl.NumberFormat>()

export function fmtNumber(lang: Lang, n: number): string {
  let f = nfCache.get(lang)
  if (!f) {
    f = new Intl.NumberFormat(lang)
    nfCache.set(lang, f)
  }
  return f.format(n)
}

const rtfCache = new Map<Lang, Intl.RelativeTimeFormat>()

/**
 * 相对天数（「3 天后 / in 3 days / через 3 дня / 3日後」）。
 * 复数与介词由 Intl 处理，禁止为这组词手写字典。
 */
export function fmtRelativeDays(lang: Lang, days: number): string {
  let f = rtfCache.get(lang)
  if (!f) {
    f = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
    rtfCache.set(lang, f)
  }
  return f.format(days, 'day')
}
