/**
 * 日历视图的「一天长什么样」统一口径。
 *
 * 月格（DayCell）与周列（WeekDayColumn）要展示同一批东西：要染哪几种底色、
 * 哪些事件可见、右边该出哪几个色点、日程怎么分成全天/定时/延续三段。
 * 这些规则原本只长在 DayCell 里，周视图复用 DayCell 就必然把整格底色带过去；
 * 拆到这里以后两个视图各自负责版式，规则本身只有一份。
 *
 * 纯函数，不读 hook：主题和忙度配置由调用方传进来。
 */
import type { CalEvent, Day, DayMark, Layer, ScheduleItem } from '../types'
import { getBusyColors, todayStr } from '../data'
import type { CalendarTheme } from './calendar-theme'
import { resolveBusyRamps } from './calendar-theme'

/** 一层底色：id 用来做交叉淡出的 composition key，color 是满色原值 */
export interface ColorLayer {
  id: string
  color: string
}

type BusyConfig = { predict_colors?: string[]; done_colors?: string[] } | null | undefined

/**
 * 当天需要染的底色层，按绘制顺序（先画的在下）。
 * important 渐变底 → 充实度 → 节假日 → 待办忙度 → 自定义涂色。
 */
export function colorLayersOf(day: Day, layers: Layer[], theme: CalendarTheme, busyConfig?: BusyConfig): ColorLayer[] {
  const byId = new Map(layers.map((l) => [l.layer_id, l]))
  const out: ColorLayer[] = []
  if (byId.get('important')?.enabled && day.gradient_bg && day.gradient_bg.toLowerCase() !== '#ffffff') {
    out.push({ id: 'important', color: day.gradient_bg })
  }
  if (byId.get('coloring')?.enabled && day.coloring_level != null) {
    out.push({ id: 'coloring', color: theme.coloring[day.coloring_level] })
  }
  if (byId.get('holiday')?.enabled && day.holiday?.name) {
    out.push({ id: 'holiday', color: byId.get('holiday')!.color ?? '#8E24AA' })
  }
  for (const b of getBusyColors(day, todayStr(), busyConfig ?? undefined, resolveBusyRamps(theme, busyConfig))) {
    if (byId.get(b.id)?.enabled) out.push({ id: b.id, color: b.color })
  }
  if (day.custom_bg?.color) {
    out.push({ id: 'custom', color: day.custom_bg.color })
  }
  return out
}

/**
 * 可见事件：important / schedule 图层始终显示（开关只控染色），其余按开关过滤。
 * 排序沿用 sort_key，保证同一天内多次渲染顺序稳定。
 */
export function visibleEventsOf(day: Day, layers: Layer[]): CalEvent[] {
  const enabled = new Set(layers.filter((l) => l.enabled).map((l) => l.layer_id))
  return Object.entries(day.events_by_layer)
    .filter(([lid]) => lid === 'important' || lid === 'schedule' || enabled.has(lid))
    .flatMap(([, evs]) => evs)
    .sort((a, b) => a.sort_key - b.sort_key)
}

/** 日期角上的色点：每个有事件的图层一个，最多 5 个（去重同色） */
export function dotsOf(day: Day, layers: Layer[], visibleEvents: CalEvent[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const lid of Object.keys(day.events_by_layer)) {
    const layer = layers.find((l) => l.layer_id === lid)
    if (!layer?.enabled && lid !== 'important') continue
    const c = layer?.color ?? '#9ca3af'
    if (!seen.has(c) && visibleEvents.some((e) => e.layer_id === lid)) {
      seen.add(c)
      out.push(c)
    }
  }
  // 日程类型点点图层：按图层 config.category 匹配当日 schedule_items 的 category
  const items = day.schedule_items ?? []
  if (items.length > 0) {
    const catSet = new Set(items.map((i) => i.category ?? 'work'))
    for (const layer of layers) {
      if (layer.kind !== 'dot' || !layer.enabled) continue
      const cat = (layer.config as Record<string, unknown>)?.category as string | undefined
      if (cat && catSet.has(cat) && layer.color && !seen.has(layer.color)) {
        seen.add(layer.color)
        out.push(layer.color)
      }
    }
  }
  return out.slice(0, 5)
}

export interface ScheduleGroups {
  /** 有开始时间的日程，按时间升序 */
  timed: ScheduleItem[]
  /** 没有开始时间的日程（全天） */
  allDay: ScheduleItem[]
  /** 多日日程的续天（span_index > 1），只画延续条 */
  continuations: ScheduleItem[]
  /** 多日日程的首天（span_index === 1） */
  multiDayHeads: ScheduleItem[]
}

/** 把一天的日程拆成「定时 / 全天 / 延续」三组，周列和日议程都吃这一份 */
export function scheduleGroupsOf(day: Day): ScheduleGroups {
  const items = [...(day.schedule_items ?? [])].sort((a, b) => {
    const at = a.start_time ?? '00:00'
    const bt = b.start_time ?? '00:00'
    if (at !== bt) return at.localeCompare(bt)
    return (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })
  const continuations = items.filter((i) => (i.span_index ?? 1) > 1)
  const heads = items.filter((i) => (i.span_index ?? 1) === 1)
  return {
    timed: heads.filter((i) => !!i.start_time),
    allDay: heads.filter((i) => !i.start_time),
    continuations,
    multiDayHeads: heads.filter((i) => (i.span_total ?? 1) > 1),
  }
}

/** 当天的单色涂色标记（非 graded），日视图书脊用 */
export function solidMarksOf(day: Day): DayMark[] {
  return (day.marks ?? []).filter((mk) => mk.mode !== 'graded')
}
