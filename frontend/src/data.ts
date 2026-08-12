export const COLORING_COLORS = ['#f1f8f4', '#c8e6c9', '#81c784', '#388e3c', '#1b5e20']

// 待办忙度双调色板：predict = 未来（琥珀），done = 过去（钢蓝）
export const TODO_BUSY_PREDICT_COLORS = ['#fef3c7', '#fde68a', '#fbbf24', '#f59e0b', '#b45309']
export const TODO_BUSY_DONE_COLORS    = ['#e0e7ff', '#c7d2fe', '#818cf8', '#4f46e5', '#3730a3']

// 解析 'YYYY-MM-DD' 为本地 date（避开 toISOString 的 UTC 偏移问题）
export function parseDateStr(s: string): Date {
  const { y, m, d } = parseDate(s)
  return new Date(y, m - 1, d)
}

export function todayStr(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

// 给 day + today + config（可选），返回当日应展示的忙度图层颜色数组：
//   过去日期返回 done 色；今天双层（done 在下、predict 在上）；未来返回 predict 色
// 颜色从 config.predict_colors / config.done_colors 取，缺省走 TODO_BUSY_*_COLORS
export function getBusyColors(
  day: { date: string; predict_level: number | null; done_level: number | null },
  todayStr: string,
  config?: { predict_colors?: string[]; done_colors?: string[] },
): { id: string; color: string }[] {
  const predictColors = config?.predict_colors ?? TODO_BUSY_PREDICT_COLORS
  const doneColors = config?.done_colors ?? TODO_BUSY_DONE_COLORS
  const isPast = day.date < todayStr
  const isToday = day.date === todayStr
  const out: { id: string; color: string }[] = []
  if (isPast) {
    if (day.done_level != null && day.done_level >= 0 && day.done_level < 5) {
      out.push({ id: 'todo_done', color: doneColors[day.done_level] })
    }
    return out
  }
  if (isToday) {
    if (day.predict_level != null && day.predict_level >= 0 && day.predict_level < 5) {
      out.push({ id: 'todo', color: predictColors[day.predict_level] })
    }
    if (day.done_level != null && day.done_level >= 0 && day.done_level < 5) {
      out.push({ id: 'todo_done', color: doneColors[day.done_level] })
    }
    return out
  }
  if (day.predict_level != null && day.predict_level >= 0 && day.predict_level < 5) {
    out.push({ id: 'todo', color: predictColors[day.predict_level] })
  }
  return out
}

export function parseDate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}

export function shiftMonthKey(key: string, delta: number): string {
  const { y, m } = parseDate(key + '-01')
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${total % 12 + 1}`
}

export function shiftYearKey(key: string, delta: number): string {
  const { y, m } = parseDate(key + '-01')
  return `${y + delta}-${m}`
}

// 把 CSS 颜色 (#rgb / #rrggbb / rgb()) 转成 RGB 三元组，失败返回 null
function parseColor(c: string): [number, number, number] | null {
  const s = c.trim()
  let m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) {
    const h = m[1]!
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
  }
  m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) {
    return [parseInt(m[1]!.slice(0, 2), 16), parseInt(m[1]!.slice(2, 4), 16), parseInt(m[1]!.slice(4, 6), 16)]
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return null
}

// WCAG 相对亮度：https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

// 背景色 → 该用黑字还是白字（WCAG 对比度阈值 4.5）
export function pickContrastColor(bg: string): '#ffffff' | '#1f2937' {
  const rgb = parseColor(bg)
  if (!rgb) return '#1f2937'
  return relativeLuminance(rgb) > 0.45 ? '#1f2937' : '#ffffff'
}
