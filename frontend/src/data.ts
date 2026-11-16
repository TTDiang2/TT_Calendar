export const COLORING_COLORS = ['#f1f8f4', '#c8e6c9', '#81c784', '#388e3c', '#1b5e20']

// 新建图层时可选的预设颜色（24 色，按色相环递进：红→橙→黄→绿→青→蓝→紫→粉→棕→灰）
export const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#FCD34D',
  '#84CC16', '#22C55E', '#10B981', '#14B8A6', '#06B6D4',
  '#0EA5E9', '#3B82F6', '#3D6BFB', '#6366F1', '#8B5CF6',
  '#A855F7', '#8E24AA', '#EC4899', '#F472B6', '#BE185D',
  '#A16207', '#92400E', '#64748B', '#475569',
]

// 分级图层可选的 5 档调色板（8 套，每套从浅到深递进）。
// 台账 C2（双盲义务）：key 为 ASCII 逻辑键——原中文键（绿/蓝/…）是对象 Identifier，
// 对中文棘轮与 allowlist 双重不可见（「白名单归零 ≠ 中文清零」）；键名不持久化
//（Sidebar 写入 config 的是色值数组），显示名经 i18n 字典 palette.* 映射
//（src/i18n/adapt/labels.ts paletteLabelKey），改键后全仓无中文键残留消费方。
export const GRADED_PALETTES = {
  green: ['#f0fdf4', '#bbf7d0', '#4ade80', '#16a34a', '#14532d'],
  blue: ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'],
  orange: ['#fff7ed', '#fed7aa', '#fb923c', '#ea580c', '#7c2d12'],
  purple: ['#faf5ff', '#e9d5ff', '#c084fc', '#9333ea', '#581c87'],
  red: ['#fef2f2', '#fecaca', '#f87171', '#dc2626', '#7f1d1d'],
  cyan: ['#ecfeff', '#a5f3fc', '#22d3ee', '#0891b2', '#164e63'],
  indigo: ['#eef2ff', '#c7d2fe', '#818cf8', '#4f46e5', '#312e81'],
  gray: ['#f8fafc', '#e2e8f0', '#94a3b8', '#475569', '#1e293b'],
}

// 待办忙度双调色板：predict = 未来（琥珀），done = 过去（钢蓝）
export const TODO_BUSY_PREDICT_COLORS = ['#fef3c7', '#fde68a', '#fbbf24', '#f59e0b', '#b45309']
export const TODO_BUSY_DONE_COLORS    = ['#e0e7ff', '#c7d2fe', '#818cf8', '#4f46e5', '#3730a3']

export type PaletteKey = keyof typeof GRADED_PALETTES
export const PALETTE_KEYS = Object.keys(GRADED_PALETTES) as PaletteKey[]

// 8 套分级调色板的基色相。灰阶单独走低饱和，其余按色相环等距分布。
const PALETTE_HUES: Record<PaletteKey, number> = {
  green: 148, blue: 213, orange: 26, purple: 279,
  red: 0, cyan: 186, indigo: 238, gray: 215,
}

// 主题化的调色板参数：一套配色只描述「饱和度 + 5 档明度」，8 个色相共用，
// 于是任意主题都能长出成套的 8 套渐变，而不是各主题抄一份 Material 色卡。
export interface PaletteTone {
  /** 0–1，颜色饱和度上限（莫兰迪低、装饰艺术高） */
  sat: number
  /** L1 → L5 的明度，0–1 */
  lightness: [number, number, number, number, number]
  /** 色相整体偏移（度），用于让某套配色整体偏暖或偏冷 */
  hueShift?: number
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    hue < 60 ? [c, x, 0] :
    hue < 120 ? [x, c, 0] :
    hue < 180 ? [0, c, x] :
    hue < 240 ? [0, x, c] :
    hue < 300 ? [x, 0, c] : [c, 0, x]
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** 按主题的色调参数生成 8 套 5 档调色板。 */
export function buildPalettes(tone: PaletteTone): Record<PaletteKey, string[]> {
  const out = {} as Record<PaletteKey, string[]>
  for (const key of PALETTE_KEYS) {
    const hue = PALETTE_HUES[key] + (tone.hueShift ?? 0)
    // 灰阶不能有彩度，否则会变脏
    const sat = key === 'gray' ? Math.min(0.1, tone.sat * 0.16) : tone.sat
    out[key] = tone.lightness.map((l) => hslToHex(hue, sat, l))
  }
  return out
}

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
// 颜色优先取调用方传入的主题色阶 ramps，其次 config.predict_colors / config.done_colors，
// 最后回退 TODO_BUSY_*_COLORS（主题解析在 lib/calendar-theme.tsx，保留用户自定义色）。
export function getBusyColors(
  day: { date: string; predict_level: number | null; done_level: number | null },
  todayStr: string,
  config?: { predict_colors?: string[]; done_colors?: string[] },
  ramps?: { predict: string[]; done: string[] },
): { id: string; color: string }[] {
  const predictColors = ramps?.predict ?? config?.predict_colors ?? TODO_BUSY_PREDICT_COLORS
  const doneColors = ramps?.done ?? config?.done_colors ?? TODO_BUSY_DONE_COLORS
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

// 柔和涂色：把原色与固定比例的白混合，整格退成浅色纸底。
// 梯度的可辨识度不靠「混多少白」来调（混多了整片糊、混少了又压文字），
// 而是靠色阶自身的明度分布——见 rebalanceRamp()。两者配合后：
// 底色足够浅、5 档之间有等距明度差、深色字全程可读。
//   dense = true 用于年视图那类十几像素的小格子：色块要更实才看得见。
export function softTint(color: string, opts?: { dense?: boolean }): string {
  const rgb = parseColor(color)
  if (!rgb) return 'rgb(241, 245, 249)'
  const white = opts?.dense ? 0.2 : 0.45
  const mix = rgb.map((v) => Math.round(v * (1 - white) + 255 * white))
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
}

// 把一条手调色阶重新按目标明度分布排列：取末档的色相与饱和度，
// 只重排 5 档的明度。手写色阶常见问题是前两档几乎同色、后两档又断崖，
// 混白之后就彻底看不出梯度；重排后每一档都等距可辨，且整体色系不变。
export function rebalanceRamp(colors: string[], targets: number[]): string[] {
  const last = parseColor(colors[colors.length - 1] ?? '')
  if (!last) return colors
  const [h, sat] = rgbToHsl(last)
  return targets.map((l) => hslToHex(h, sat, l))
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (max === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60
  return [h, Math.min(0.92, s)]
}

// 柔和底色上的文字颜色：选对比度更高的一侧。60% 白混合后所有档位都足够浅，
// 实际恒为近黑字；保留对比度计算是为了用户自定义深色图层时不至于看不清。
export function softTextColor(bg: string): '#111827' | '#ffffff' {
  const rgb = parseColor(bg)
  if (!rgb) return '#111827'
  const bgLum = relativeLuminance(rgb)
  const darkLum = relativeLuminance([17, 24, 39])
  const darkContrast = (Math.max(bgLum, darkLum) + 0.05) / (Math.min(bgLum, darkLum) + 0.05)
  const whiteContrast = 1.05 / (bgLum + 0.05)
  return darkContrast >= whiteContrast ? '#111827' : '#ffffff'
}
