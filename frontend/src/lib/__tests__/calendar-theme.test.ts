import { afterEach, describe, expect, it } from 'vitest'
import { TODO_BUSY_DONE_COLORS, TODO_BUSY_PREDICT_COLORS } from '../../data'
import {
  CALENDAR_THEMES,
  CALENDAR_THEME_IDS,
  readCalendarThemeId,
  resolveBusyRamps,
  withAlpha,
  writeCalendarThemeId,
} from '../calendar-theme'

afterEach(() => {
  localStorage.clear()
})

describe('calendar themes', () => {
  it('each theme defines five-step warm, green done, and green coloring ramps', () => {
    for (const id of CALENDAR_THEME_IDS) {
      const theme = CALENDAR_THEMES[id]
      expect(theme.predict, id).toHaveLength(5)
      expect(theme.done, id).toHaveLength(5)
      expect(theme.coloring, id).toHaveLength(5)
      for (const c of [...theme.predict, ...theme.done, ...theme.coloring, theme.today, theme.weekend, theme.accent, theme.border]) {
        expect(c, `${id} ${c}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('done and coloring stay the same green ramp so the completed view reads green', () => {
    for (const id of CALENDAR_THEME_IDS) {
      expect(CALENDAR_THEMES[id].done, id).toEqual(CALENDAR_THEMES[id].coloring)
    }
  })

  it('legacy default busy colors yield to the theme ramps', () => {
    const theme = CALENDAR_THEMES.morandi
    const ramps = resolveBusyRamps(theme, {
      predict_colors: TODO_BUSY_PREDICT_COLORS.map((c) => c.toUpperCase()),
      done_colors: TODO_BUSY_DONE_COLORS.map((c) => c.toUpperCase()),
    })
    expect(ramps.predict).toBe(theme.predict)
    expect(ramps.done).toBe(theme.done)
  })

  it('custom busy colors are preserved', () => {
    const theme = CALENDAR_THEMES.artdeco
    const custom = ['#111111', '#222222', '#333333', '#444444', '#555555']
    const ramps = resolveBusyRamps(theme, { predict_colors: custom, done_colors: custom })
    expect(ramps.predict).toBe(custom)
    expect(ramps.done).toBe(custom)
  })

  it('persists the chosen theme and falls back to classic', () => {
    expect(readCalendarThemeId()).toBe('classic')
    writeCalendarThemeId('midcentury')
    expect(readCalendarThemeId()).toBe('midcentury')
    localStorage.setItem('tt.calendarTheme', 'not-a-theme')
    expect(readCalendarThemeId()).toBe('classic')
  })

  it('withAlpha only rewrites six-digit hex', () => {
    expect(withAlpha('#2563EB', 0.35)).toBe('rgba(37, 99, 235, 0.35)')
    expect(withAlpha('#abc', 0.5)).toBe('#abc')
  })
})
