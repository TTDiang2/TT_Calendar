/**
 * 日历涂色样式（Taste Pass 01）。
 *
 * soft：降低饱和度的热力填充（默认）。vivid：保留旧版整格高饱和填充。
 * 只影响月/周网格的呈现，不改任何图层颜色或后端数据；
 * 用户自定义的色值仍原样参与混色，深浅档位保持不变。
 */
export type CalendarColorStyle = 'soft' | 'vivid'

const STORAGE_KEY = 'tt.calendarColorStyle'

export function readCalendarColorStyle(): CalendarColorStyle {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'vivid' ? 'vivid' : 'soft'
  } catch {
    return 'soft'
  }
}

export function writeCalendarColorStyle(style: CalendarColorStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, style)
  } catch {
    // localStorage 不可用时仅本次会话生效
  }
}
