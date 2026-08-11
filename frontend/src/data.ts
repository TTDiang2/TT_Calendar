export const COLORING_COLORS = ['#f1f8f4', '#c8e6c9', '#81c784', '#388e3c', '#1b5e20']

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
