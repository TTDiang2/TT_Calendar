export const COLORING_COLORS = ['#f1f8f4', '#c8e6c9', '#81c784', '#388e3c', '#1b5e20']

// 新建图层时可选的预设颜色（24 色，按色相环递进：红→橙→黄→绿→青→蓝→紫→粉→棕→灰）
export const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#FCD34D',
  '#84CC16', '#22C55E', '#10B981', '#14B8A6', '#06B6D4',
  '#0EA5E9', '#3B82F6', '#3D6BFB', '#6366F1', '#8B5CF6',
  '#A855F7', '#8E24AA', '#EC4899', '#F472B6', '#BE185D',
  '#A16207', '#92400E', '#64748B', '#475569',
]

// 分级图层可选的 5 档调色板（8 套，每套从浅到深递进）
export const GRADED_PALETTES = {
  绿: ['#f0fdf4', '#bbf7d0', '#4ade80', '#16a34a', '#14532d'],
  蓝: ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'],
  橙: ['#fff7ed', '#fed7aa', '#fb923c', '#ea580c', '#7c2d12'],
  紫: ['#faf5ff', '#e9d5ff', '#c084fc', '#9333ea', '#581c87'],
  红: ['#fef2f2', '#fecaca', '#f87171', '#dc2626', '#7f1d1d'],
  青: ['#ecfeff', '#a5f3fc', '#22d3ee', '#0891b2', '#164e63'],
  靛: ['#eef2ff', '#c7d2fe', '#818cf8', '#4f46e5', '#312e81'],
  灰: ['#f8fafc', '#e2e8f0', '#94a3b8', '#475569', '#1e293b'],
}

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

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 生成 [start, end] 闭区间内的所有日期（'YYYY-MM-DD'）。
 * 多日日程要按天展开写入（涂色/事件），或计算跨天天数时用。
 * end 早于 start 或为空时退化成单日 [start]。
 */
export function dateRange(start: string, end?: string | null): string[] {
  const from = parseDateStr(start)
  if (!end || end <= start) return [start]
  const to = parseDateStr(end)
  const out: string[] = []
  const cur = new Date(from)
  // 上限 366 天：防止误填年份（如 2099）时把循环打爆，静默截断
  for (let i = 0; i < 366 && cur <= to; i++) {
    out.push(toISODate(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

export function daysBetween(start: string, end: string): number {
  const a = parseDateStr(start).getTime()
  const b = parseDateStr(end).getTime()
  return Math.round((b - a) / 86_400_000) + 1
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
