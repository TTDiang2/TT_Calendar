/**
 * 日历主题配色（Taste Pass 02）。
 *
 * 一套主题同时定义三组 5 档色阶与界面强调色：
 *  - predict：未来日期的待办忙度（暖色）
 *  - done：过去日期的已完成量（必须是绿色，用户指定）
 *  - coloring：充实度涂色（与 done 同一组绿，语义都是「完成/充实」）
 *
 * 只改呈现，不写后端、不改用户自定义图层色。忙度设置里若用户已把色阶改成
 * 非旧默认值，则保留用户色；仍是旧默认值（琥珀 / 钢蓝）时跟随主题。
 * 鲜明模式（vivid）与柔和模式（soft）共用同一组色阶，只有填充强度不同。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  buildPalettes,
  COLORING_COLORS,
  GRADED_PALETTES,
  rebalanceRamp,
  TODO_BUSY_DONE_COLORS,
  TODO_BUSY_PREDICT_COLORS,
  type PaletteKey,
} from '../data'

// 5 档的明度分布：暖色（忙度）稍微压深一档，绿色（完成）保持统一。
// 手写色阶常常前两档撞色、后两档断崖，重排成等距后混白也看得出谁更忙。
const PREDICT_L = [0.95, 0.87, 0.78, 0.67, 0.54]
const DONE_L = [0.95, 0.87, 0.77, 0.66, 0.53]
import type { TxKey } from '../i18n'

export type CalendarThemeId = 'classic' | 'morandi' | 'scandinavian' | 'midcentury' | 'artdeco'

export interface CalendarTheme {
  id: CalendarThemeId
  labelKey: TxKey
  /** 预测 / 忙度：L1 → L5 由浅到深 */
  predict: string[]
  /** 已完成：L1 → L5 绿色阶 */
  done: string[]
  /** 充实度涂色：与 done 同一组绿色阶 */
  coloring: string[]
  /** 8 套分级涂色可选的 5 档调色板，跟随主题成套生成 */
  palettes: Record<PaletteKey, string[]>
  /** 外壳：三栏面板（顶栏 / 侧栏 / 右栏）底色 */
  panel: string
  /** 外壳：窗口底色，露在面板之间的缝隙里 */
  shell: string
  /** 外壳：浅填充（hover、输入框、分段控件底） */
  subtle: string
  ink: string
  muted: string
  surface: string
  border: string
  today: string
  weekend: string
  accent: string
  /** 语义色：危险 / 逾期（矩阵「马上做」、今日「复杂」） */
  danger: string
  /** 语义色：警告 / 临近（矩阵「授权做」、今日「中等」） */
  warning: string
  /** 语义色：安全 / 完成（今日「简单」、看板投放区） */
  success: string
  /** 语义色：信息 / 规划（矩阵「计划做」、看板进行中） */
  info: string
  /** 上面四个语义色的「文字版」（已压到 4.5:1），只给小于 14px 的文字用 */
  dangerInk: string
  warningInk: string
  successInk: string
  infoInk: string
}

/** 语义色的「文字版」：往黑压到在给定底色上达到 4.5:1，只用于小字号文字 */
function hexToRgb3(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function relLuminance(hex: string): number {
  const [r, g, b] = hexToRgb3(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a)
  const lb = relLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * 语义色当文字用时会不够黑（莫兰迪/北欧这几套尤其明显，warning 只有 2.7:1）。
 * 这里按「往黑等比混」逐档试探，压到 4.5:1 就停 —— 色相不变，只降明度。
 * 色点、色条、色块仍用原色，所以主题的柔和观感不受影响。
 */
export function inkOn(color: string, bg: string, target = 4.5): string {
  if (contrastRatio(color, bg) >= target) return color
  const [r, g, b] = hexToRgb3(color)
  for (let k = 0.06; k < 1; k += 0.04) {
    const hex = `#${[r, g, b]
      .map((c) => Math.round(c * (1 - k)).toString(16).padStart(2, '0'))
      .join('')}`
    if (contrastRatio(hex, bg) >= target) return hex
  }
  return '#000000'
}

export const CALENDAR_THEMES: Record<CalendarThemeId, CalendarTheme> = {
  classic: {
    id: 'classic',
    labelKey: 'settings.appearance.themeClassic',
    // 经典的 5 档是反复调过的 Material 原色阶，不走 rebalanceRamp 重排：
    // 重排会把最深的 #1b5e20 / #b45309 抬成中等明度，热力图对比直接塌掉。
    predict: [...TODO_BUSY_PREDICT_COLORS],
    done: [...COLORING_COLORS],
    coloring: [...COLORING_COLORS],
    palettes: GRADED_PALETTES,
    panel: '#FFFFFF',
    shell: '#EDEFF3',
    subtle: '#F3F4F6',
    ink: '#111827',
    muted: '#6B7280',
    surface: '#F9FAFB',
    border: '#E5E7EB',
    today: '#2563EB',
    weekend: '#EF4444',
    accent: '#2563EB',
    // 语义色沿用经典 Material 的语汇，但压掉一档饱和，避免整块铺色时抢戏
    danger: '#C2543D',
    warning: '#B4791F',
    success: '#3F7D5C',
    info: '#2563EB',
    dangerInk: inkOn('#C2543D', '#FFFFFF'),
    warningInk: inkOn('#B4791F', '#FFFFFF'),
    successInk: inkOn('#3F7D5C', '#FFFFFF'),
    infoInk: inkOn('#2563EB', '#FFFFFF'),
  },
  morandi: {
    id: 'morandi',
    labelKey: 'settings.appearance.themeMorandi',
    predict: rebalanceRamp(['#F3E8E2', '#E4CDC2', '#CFA99A', '#A97968', '#6F4B3F'], PREDICT_L),
    done: rebalanceRamp(['#EDF1E7', '#D6DEC7', '#B0C09A', '#83986A', '#556B44'], DONE_L),
    coloring: rebalanceRamp(['#EDF1E7', '#D6DEC7', '#B0C09A', '#83986A', '#556B44'], DONE_L),
    palettes: buildPalettes({ sat: 0.24, lightness: [0.95, 0.87, 0.77, 0.64, 0.48] }),
    panel: '#F2E8DD',
    shell: '#E9DED4',
    subtle: '#F0E7DF',
    ink: '#3F3A37',
    muted: '#7A736D',
    surface: '#FDFBF8',
    border: '#E7E0DA',
    today: '#7D96A0',
    weekend: '#B06A5E',
    accent: '#A97968',
    danger: '#A8625A',
    warning: '#A07A45',
    success: '#6E8A62',
    info: '#6C8291',
    dangerInk: inkOn('#A8625A', '#F2E8DD'),
    warningInk: inkOn('#A07A45', '#F2E8DD'),
    successInk: inkOn('#6E8A62', '#F2E8DD'),
    infoInk: inkOn('#6C8291', '#F2E8DD'),
  },
  scandinavian: {
    id: 'scandinavian',
    labelKey: 'settings.appearance.themeScandinavian',
    predict: rebalanceRamp(['#FBF3E3', '#F2DFBC', '#E2C287', '#C79A58', '#8C6533'], PREDICT_L),
    done: rebalanceRamp(['#ECF4EE', '#D0E4D4', '#A4C9AE', '#6D9F7C', '#3E6A4D'], DONE_L),
    coloring: rebalanceRamp(['#ECF4EE', '#D0E4D4', '#A4C9AE', '#6D9F7C', '#3E6A4D'], DONE_L),
    palettes: buildPalettes({ sat: 0.3, lightness: [0.955, 0.885, 0.79, 0.65, 0.47] }),
    panel: '#E9F0F3',
    shell: '#E2EBEF',
    subtle: '#E9EFF2',
    ink: '#24313A',
    muted: '#66757F',
    surface: '#FBFDFD',
    border: '#E1E8EC',
    today: '#4F7F9B',
    weekend: '#B56B52',
    accent: '#C79A58',
    danger: '#B4695A',
    warning: '#B08948',
    success: '#5F8A6E',
    info: '#4F7F9B',
    dangerInk: inkOn('#B4695A', '#E9F0F3'),
    warningInk: inkOn('#B08948', '#E9F0F3'),
    successInk: inkOn('#5F8A6E', '#E9F0F3'),
    infoInk: inkOn('#4F7F9B', '#E9F0F3'),
  },
  midcentury: {
    id: 'midcentury',
    labelKey: 'settings.appearance.themeMidcentury',
    predict: rebalanceRamp(['#FBF0D2', '#F1D98C', '#DFB84D', '#B8872E', '#7A551A'], PREDICT_L),
    done: rebalanceRamp(['#EFF2DB', '#DAE2B2', '#B5C577', '#859A45', '#546428'], DONE_L),
    coloring: rebalanceRamp(['#EFF2DB', '#DAE2B2', '#B5C577', '#859A45', '#546428'], DONE_L),
    palettes: buildPalettes({ sat: 0.42, lightness: [0.945, 0.855, 0.725, 0.56, 0.38], hueShift: -2 }),
    panel: '#F6EBD1',
    shell: '#EDE1C6',
    subtle: '#F2E8D4',
    ink: '#2E2A24',
    muted: '#6F665B',
    surface: '#FFFDF7',
    border: '#E8DFC9',
    today: '#2F7E78',
    weekend: '#B65C3A',
    accent: '#B8872E',
    danger: '#B5563C',
    warning: '#B8872E',
    success: '#7A8C43',
    info: '#4A6E86',
    dangerInk: inkOn('#B5563C', '#F6EBD1'),
    warningInk: inkOn('#B8872E', '#F6EBD1'),
    successInk: inkOn('#7A8C43', '#F6EBD1'),
    infoInk: inkOn('#4A6E86', '#F6EBD1'),
  },
  artdeco: {
    id: 'artdeco',
    labelKey: 'settings.appearance.themeArtdeco',
    predict: rebalanceRamp(['#FBF2D9', '#F0DDA3', '#D9B85E', '#B0862C', '#745516'], PREDICT_L),
    done: rebalanceRamp(['#E5F3EC', '#BFE1CE', '#7BBE9B', '#3C8964', '#1C593D'], DONE_L),
    coloring: rebalanceRamp(['#E5F3EC', '#BFE1CE', '#7BBE9B', '#3C8964', '#1C593D'], DONE_L),
    palettes: buildPalettes({ sat: 0.44, lightness: [0.935, 0.845, 0.705, 0.53, 0.33] }),
    panel: '#F5EBD5',
    shell: '#EBE0C6',
    subtle: '#EFE7D5',
    ink: '#1C2430',
    muted: '#6B6F7A',
    surface: '#FFFBEF',
    border: '#E5DCC8',
    today: '#2E5E8C',
    weekend: '#A3483F',
    accent: '#B58A2E',
    danger: '#A3483F',
    warning: '#B58A2E',
    success: '#5C7A55',
    info: '#2E5E8C',
    dangerInk: inkOn('#A3483F', '#F5EBD5'),
    warningInk: inkOn('#B58A2E', '#F5EBD5'),
    successInk: inkOn('#5C7A55', '#F5EBD5'),
    infoInk: inkOn('#2E5E8C', '#F5EBD5'),
  },
}

export const CALENDAR_THEME_IDS: CalendarThemeId[] = [
  'classic',
  'morandi',
  'scandinavian',
  'midcentury',
  'artdeco',
]

const STORAGE_KEY = 'tt.calendarTheme'

function isThemeId(v: string | null): v is CalendarThemeId {
  return v !== null && (CALENDAR_THEME_IDS as string[]).includes(v)
}

export function readCalendarThemeId(): CalendarThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isThemeId(v) ? v : 'classic'
  } catch {
    return 'classic'
  }
}

export function writeCalendarThemeId(id: CalendarThemeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // localStorage 不可用时仅本次会话生效
  }
}

/** 旧版忙度默认色阶：只有仍是这组值时才让主题接管（保护用户自定义色）。 */
function sameColors(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((c, i) => c.toLowerCase() === b[i]!.toLowerCase())
}

export function resolveBusyRamps(
  theme: CalendarTheme,
  config?: { predict_colors?: string[]; done_colors?: string[] } | null,
): { predict: string[]; done: string[] } {
  const predict =
    config?.predict_colors && !sameColors(config.predict_colors, TODO_BUSY_PREDICT_COLORS)
      ? config.predict_colors
      : theme.predict
  const done =
    config?.done_colors && !sameColors(config.done_colors, TODO_BUSY_DONE_COLORS)
      ? config.done_colors
      : theme.done
  return { predict, done }
}

/** 给主题强调色加透明度（输入为 #rrggbb）。 */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface CalendarThemeContextValue {
  themeId: CalendarThemeId
  theme: CalendarTheme
  setThemeId: (id: CalendarThemeId) => void
}

const CalendarThemeContext = createContext<CalendarThemeContextValue>({
  themeId: 'classic',
  theme: CALENDAR_THEMES.classic,
  setThemeId: () => {},
})

export function CalendarThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<CalendarThemeId>(readCalendarThemeId)

  const setThemeId = useCallback((id: CalendarThemeId) => {
    writeCalendarThemeId(id)
    setThemeIdState(id)
  }, [])

  const theme = CALENDAR_THEMES[themeId]

  useEffect(() => {
    const root = document.documentElement
    root.dataset.calendarTheme = themeId
    root.style.setProperty('--cal-ink', theme.ink)
    root.style.setProperty('--cal-muted', theme.muted)
    root.style.setProperty('--cal-surface', theme.surface)
    root.style.setProperty('--cal-panel', theme.panel)
    root.style.setProperty('--cal-shell', theme.shell)
    root.style.setProperty('--cal-subtle', theme.subtle)
    root.style.setProperty('--cal-border', theme.border)
    root.style.setProperty('--cal-today', theme.today)
    root.style.setProperty('--cal-weekend', theme.weekend)
    root.style.setProperty('--cal-accent', theme.accent)
    // 语义色也进变量表：矩阵/看板/今日/周视图统一取这一组，不再各自硬编码 red-600 之类
    root.style.setProperty('--cal-danger', theme.danger)
    root.style.setProperty('--cal-warning', theme.warning)
    root.style.setProperty('--cal-success', theme.success)
    root.style.setProperty('--cal-info', theme.info)
    root.style.setProperty('--cal-danger-ink', theme.dangerInk)
    root.style.setProperty('--cal-warning-ink', theme.warningInk)
    root.style.setProperty('--cal-success-ink', theme.successInk)
    root.style.setProperty('--cal-info-ink', theme.infoInk)
  }, [themeId, theme])

  const value = useMemo(() => ({ themeId, theme, setThemeId }), [themeId, theme, setThemeId])

  return <CalendarThemeContext.Provider value={value}>{children}</CalendarThemeContext.Provider>
}

export function useCalendarTheme(): CalendarThemeContextValue {
  return useContext(CalendarThemeContext)
}
