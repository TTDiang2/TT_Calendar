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
import { COLORING_COLORS, TODO_BUSY_DONE_COLORS, TODO_BUSY_PREDICT_COLORS } from '../data'
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
  ink: string
  muted: string
  surface: string
  border: string
  today: string
  weekend: string
  accent: string
}

export const CALENDAR_THEMES: Record<CalendarThemeId, CalendarTheme> = {
  classic: {
    id: 'classic',
    labelKey: 'settings.appearance.themeClassic',
    predict: [...TODO_BUSY_PREDICT_COLORS],
    done: [...COLORING_COLORS],
    coloring: [...COLORING_COLORS],
    ink: '#111827',
    muted: '#6B7280',
    surface: '#F9FAFB',
    border: '#E5E7EB',
    today: '#2563EB',
    weekend: '#EF4444',
    accent: '#2563EB',
  },
  morandi: {
    id: 'morandi',
    labelKey: 'settings.appearance.themeMorandi',
    predict: ['#F3E8E2', '#E4CDC2', '#CFA99A', '#A97968', '#6F4B3F'],
    done: ['#EDF1E7', '#D6DEC7', '#B0C09A', '#83986A', '#556B44'],
    coloring: ['#EDF1E7', '#D6DEC7', '#B0C09A', '#83986A', '#556B44'],
    ink: '#3F3A37',
    muted: '#7A736D',
    surface: '#FAF7F4',
    border: '#E7E0DA',
    today: '#7D96A0',
    weekend: '#B06A5E',
    accent: '#A97968',
  },
  scandinavian: {
    id: 'scandinavian',
    labelKey: 'settings.appearance.themeScandinavian',
    predict: ['#FBF3E3', '#F2DFBC', '#E2C287', '#C79A58', '#8C6533'],
    done: ['#ECF4EE', '#D0E4D4', '#A4C9AE', '#6D9F7C', '#3E6A4D'],
    coloring: ['#ECF4EE', '#D0E4D4', '#A4C9AE', '#6D9F7C', '#3E6A4D'],
    ink: '#24313A',
    muted: '#66757F',
    surface: '#F8FAFB',
    border: '#E1E8EC',
    today: '#4F7F9B',
    weekend: '#B56B52',
    accent: '#C79A58',
  },
  midcentury: {
    id: 'midcentury',
    labelKey: 'settings.appearance.themeMidcentury',
    predict: ['#FBF0D2', '#F1D98C', '#DFB84D', '#B8872E', '#7A551A'],
    done: ['#EFF2DB', '#DAE2B2', '#B5C577', '#859A45', '#546428'],
    coloring: ['#EFF2DB', '#DAE2B2', '#B5C577', '#859A45', '#546428'],
    ink: '#2E2A24',
    muted: '#6F665B',
    surface: '#FCF8EF',
    border: '#E8DFC9',
    today: '#2F7E78',
    weekend: '#B65C3A',
    accent: '#B8872E',
  },
  artdeco: {
    id: 'artdeco',
    labelKey: 'settings.appearance.themeArtdeco',
    predict: ['#FBF2D9', '#F0DDA3', '#D9B85E', '#B0862C', '#745516'],
    done: ['#E5F3EC', '#BFE1CE', '#7BBE9B', '#3C8964', '#1C593D'],
    coloring: ['#E5F3EC', '#BFE1CE', '#7BBE9B', '#3C8964', '#1C593D'],
    ink: '#1C2430',
    muted: '#6B6F7A',
    surface: '#FBF8F0',
    border: '#E5DCC8',
    today: '#2E5E8C',
    weekend: '#A3483F',
    accent: '#B58A2E',
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
    root.style.setProperty('--cal-border', theme.border)
    root.style.setProperty('--cal-today', theme.today)
    root.style.setProperty('--cal-weekend', theme.weekend)
    root.style.setProperty('--cal-accent', theme.accent)
  }, [themeId, theme])

  const value = useMemo(() => ({ themeId, theme, setThemeId }), [themeId, theme, setThemeId])

  return <CalendarThemeContext.Provider value={value}>{children}</CalendarThemeContext.Provider>
}

export function useCalendarTheme(): CalendarThemeContextValue {
  return useContext(CalendarThemeContext)
}
