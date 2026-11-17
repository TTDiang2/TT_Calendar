import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { CalendarRange, ChevronDown, ChevronRight } from 'lucide-react'
import type { Todo, TodoList } from '../../types'
import { ganttRange, labelOf, STATUS_KEYS, todayStr, type GanttRange } from '../../utils/todoLogic'
import { fmtMonthName, fmtWeekday, useLang, useT, type TxKey } from '../../i18n'
import { layerLabel } from '../../i18n/adapt/layerLabel'
import { useCalendarTheme, withAlpha } from '../../lib/calendar-theme'

interface Props {
  todos: Todo[]
  lists: TodoList[]
  selectedTodoId: string | null
  onSelect: (id: string) => void
}

type Scale = '2w' | '1m' | '3m'

const SCALES: { id: Scale; labelKey: TxKey; days: number }[] = [
  { id: '2w', labelKey: 'todoboards.gantt.scale2w', days: 14 },
  { id: '1m', labelKey: 'todoboards.gantt.scale1m', days: 30 },
  { id: '3m', labelKey: 'todoboards.gantt.scale3m', days: 90 },
]
const SCALE_KEY = 'tt.ganttScale'
const LABEL_W = 252
const ROW_H = 38
const GROUP_H = 30
const HEAD_H = 58
const BAR_H = 20
const DAY = 86400000

function dayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y!, m! - 1, d!) / DAY)
}

/** 从 UTC 日序号还原「本地日历日期」，避免 UTC+8 下日期整体错一天。 */
function dateAt(index: number): Date {
  const d = new Date(index * DAY)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function formatMD(date: string): string {
  const [, m, d] = date.split('-')
  return `${m}/${d}`
}

/** 里程碑跨年时带上年份，避免 01/01 被读成本年。 */
function formatMilestone(date: string, today: string): string {
  if (date.slice(0, 4) === today.slice(0, 4)) return formatMD(date)
  return date.replace(/-/g, '/')
}

/** 跨年区间带上年份，避免 07/29 → 01/01 看起来像同一年。 */
function formatRange(start: string, end: string): string {
  if (start.slice(0, 4) === end.slice(0, 4)) return `${formatMD(start)} → ${formatMD(end)}`
  return `${start.replace(/-/g, '/')} → ${end.replace(/-/g, '/')}`
}

function readScale(): Scale {
  if (typeof localStorage === 'undefined') return '1m'
  const saved = localStorage.getItem(SCALE_KEY)
  return saved === '2w' || saved === '1m' || saved === '3m' ? saved : '1m'
}

interface Row {
  todo: Todo
  range: GanttRange
}

interface Group {
  listId: string
  name: string
  rows: Row[]
  firstStart: number
}

export function TodoGanttView({ todos, lists, selectedTodoId, onSelect }: Props) {
  const t = useT()
  const lang = useLang()
  const { theme } = useCalendarTheme()
  const today = todayStr()
  const todayIdx = dayIndex(today)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(0)
  const [scale, setScale] = useState<Scale>(readScale)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showUnscheduled, setShowUnscheduled] = useState(false)
  const [scrollLeft, setScrollLeft] = useState(0)
  const lastScrollKey = useRef('')

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setViewW(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { groups, unscheduled, scheduledCount } = useMemo(() => {
    const all = todos.map((todo) => ({ todo, range: ganttRange(todo, today) }))
    const scheduled = all.filter((row) => row.range.scheduled)
    const unscheduledRows = all.filter((row) => !row.range.scheduled)
    const map = new Map<string, Group>()
    const names = new Map(lists.map((l) => [l.id, layerLabel(l, t)]))

    for (const row of scheduled) {
      const listId = row.todo.list_id
      let group = map.get(listId)
      if (!group) {
        group = { listId, name: names.get(listId) ?? listId, rows: [], firstStart: dayIndex(row.range.start!) }
        map.set(listId, group)
      }
      group.rows.push(row)
      group.firstStart = Math.min(group.firstStart, dayIndex(row.range.start!))
    }

    const built = Array.from(map.values())
      .map((group) => ({
        ...group,
        rows: group.rows.sort(
          (a, b) =>
            dayIndex(a.range.start!) - dayIndex(b.range.start!) ||
            a.todo.title.localeCompare(b.todo.title, lang),
        ),
      }))
      .sort((a, b) => a.firstStart - b.firstStart || a.name.localeCompare(b.name, lang))

    return { groups: built, unscheduled: unscheduledRows, scheduledCount: scheduled.length }
  }, [todos, lists, t, today, lang])

  const scaleDays = SCALES.find((s) => s.id === scale)?.days ?? 30
  const dayW = viewW > LABEL_W + 80 ? Math.max((viewW - LABEL_W) / scaleDays, 3) : 24

  const geo = useMemo(() => {
    if (scheduledCount === 0) {
      const t0 = todayIdx - 10
      return { t0, totalDays: 31, laneW: 31 * dayW, todayX: 10 * dayW, contentH: 0 }
    }
    const starts = groups.flatMap((g) => g.rows.map((r) => dayIndex(r.range.start!)))
    const ends = groups.flatMap((g) => g.rows.map((r) => dayIndex(r.range.end!)))
    const t0 = Math.min(todayIdx - 7, ...starts)
    const t1 = Math.max(todayIdx + 21, ...ends)
    const totalDays = t1 - t0 + 1
    const contentH = groups.reduce(
      (sum, g) => sum + GROUP_H + (collapsed.has(g.listId) ? 0 : g.rows.length * ROW_H),
      0,
    )
    return { t0, totalDays, laneW: totalDays * dayW, todayX: (todayIdx - t0) * dayW, contentH }
  }, [groups, scheduledCount, todayIdx, dayW, collapsed])

  useEffect(() => {
    if (scheduledCount === 0 || viewW === 0) return
    const key = `${scale}:${geo.t0}:${geo.totalDays}:${viewW}`
    if (lastScrollKey.current === key) return
    const el = scrollRef.current
    if (!el) return
    lastScrollKey.current = key
    const viewport = Math.max(viewW - LABEL_W, 1)
    const target = geo.todayX + dayW / 2 - viewport * 0.33
    el.scrollLeft = Math.max(0, Math.min(target, LABEL_W + geo.laneW - viewW))
  }, [scheduledCount, viewW, scale, geo, dayW])

  const months = useMemo(() => {
    if (scheduledCount === 0) return []
    const out: { start: number; end: number; label: string }[] = []
    for (let i = 0; i < geo.totalDays; i += 1) {
      const d = dateAt(geo.t0 + i)
      if (i === 0 || d.getDate() === 1) {
        if (out.length > 0) out[out.length - 1]!.end = i
        out.push({ start: i, end: geo.totalDays, label: fmtMonthName(lang, d, 'short') })
      }
    }
    return out
  }, [geo, scheduledCount, lang])

  const weekendCols = useMemo(() => {
    if (scheduledCount === 0) return []
    const out: number[] = []
    for (let i = 0; i < geo.totalDays; i += 1) {
      const byDay = dateAt(geo.t0 + i).getDay()
      if (byDay === 0 || byDay === 6) out.push(i)
    }
    return out
  }, [geo, scheduledCount])

  const weekLines = useMemo(() => {
    if (scheduledCount === 0) return []
    const out: number[] = []
    for (let i = 1; i < geo.totalDays; i += 1) {
      if (dateAt(geo.t0 + i).getDay() === 1) out.push(i)
    }
    return out
  }, [geo, scheduledCount])

  const toneOf = (todo: Todo, range: GanttRange) => {
    if (range.overdue) {
      return {
        fill: withAlpha(theme.weekend, 0.14),
        border: withAlpha(theme.weekend, 0.55),
        dot: theme.weekend,
        text: theme.ink,
        dashed: false,
      }
    }
    switch (todo.status) {
      case 'inProgress':
        return {
          fill: withAlpha(theme.today, 0.16),
          border: withAlpha(theme.today, 0.42),
          dot: theme.today,
          text: theme.ink,
          dashed: false,
        }
      case 'waitingOnOthers':
        return {
          fill: withAlpha(theme.accent, 0.14),
          border: withAlpha(theme.accent, 0.44),
          dot: theme.accent,
          text: theme.ink,
          dashed: true,
        }
      case 'deferred':
        return {
          fill: withAlpha(theme.muted, 0.08),
          border: withAlpha(theme.muted, 0.28),
          dot: theme.muted,
          text: theme.muted,
          dashed: true,
        }
      case 'completed':
        return {
          fill: withAlpha(theme.done[1]!, 0.75),
          border: theme.done[3]!,
          dot: theme.done[3]!,
          text: theme.ink,
          dashed: false,
        }
      default:
        return {
          fill: withAlpha(theme.ink, 0.07),
          border: withAlpha(theme.ink, 0.18),
          dot: withAlpha(theme.muted, 0.9),
          text: theme.ink,
          dashed: false,
        }
    }
  }

  const changeScale = (next: Scale) => {
    setScale(next)
    if (typeof localStorage !== 'undefined') localStorage.setItem(SCALE_KEY, next)
  }

  const scrollToToday = () => {
    const el = scrollRef.current
    if (!el) return
    const viewport = Math.max(viewW - LABEL_W, 1)
    const target = geo.todayX + dayW / 2 - viewport * 0.33
    el.scrollTo({ left: Math.max(0, Math.min(target, LABEL_W + geo.laneW - viewW)), behavior: 'smooth' })
  }

  const toggleGroup = (listId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(listId)) next.delete(listId)
      else next.add(listId)
      return next
    })
  }

  const dayLabelStep = Math.max(1, Math.ceil(20 / dayW))
  const showWeekday = dayW >= 28
  const viewportLane = Math.max(viewW - LABEL_W, 1)
  const visibleMonth = useMemo(() => {
    if (scheduledCount === 0) return ''
    const idx = geo.t0 + Math.min(Math.floor(scrollLeft / dayW), geo.totalDays - 1)
    return fmtMonthName(lang, dateAt(idx), 'short')
  }, [geo, scrollLeft, dayW, lang, scheduledCount])

  return (
    <div className="h-full flex flex-col min-h-0">
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 border-b"
        style={{ borderColor: theme.border, backgroundColor: theme.panel }}
      >
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.ink }}>
          <CalendarRange size={14} strokeWidth={1.8} style={{ color: theme.today }} />
          {t('topbar.todoMode.gantt')}
          <span className="tabular-nums" style={{ color: theme.muted }}>
            {scheduledCount}
          </span>
        </span>

        {scheduledCount > 0 && (
          <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: theme.subtle }}>
            {SCALES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => changeScale(s.id)}
                className={clsx(
                  'rounded-md px-2 py-1 text-[11px] transition-colors',
                  scale === s.id ? 'font-medium shadow-sm' : 'hover:opacity-80',
                )}
                style={{
                  backgroundColor: scale === s.id ? theme.panel : 'transparent',
                  color: scale === s.id ? theme.ink : theme.muted,
                }}
                aria-pressed={scale === s.id}
              >
                {t(s.labelKey)}
              </button>
            ))}
          </div>
        )}

        {scheduledCount > 0 && (
          <button
            type="button"
            onClick={scrollToToday}
            className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:opacity-80"
            style={{ color: theme.today, backgroundColor: withAlpha(theme.today, 0.08) }}
          >
            {t('todoboards.gantt.today')}
          </button>
        )}

        <div className="flex-1" />

        {unscheduled.length > 0 && (
          <button
            type="button"
            onClick={() => setShowUnscheduled((v) => !v)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors hover:opacity-80"
            style={{ color: theme.muted, backgroundColor: withAlpha(theme.subtle, 0.65) }}
            aria-expanded={showUnscheduled}
          >
            {t('todoboards.gantt.unscheduledCount', { n: unscheduled.length })}
            {showUnscheduled ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto" onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}>
        {scheduledCount === 0 ? (
          <div className="h-full min-h-[260px] flex flex-col items-center justify-center px-6 text-center">
            <span
              className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{ backgroundColor: withAlpha(theme.today, 0.1), color: theme.today }}
            >
              <CalendarRange size={24} strokeWidth={1.5} />
            </span>
            <p className="text-sm font-medium" style={{ color: theme.ink }}>
              {t('todoboards.gantt.emptyTitle')}
            </p>
            <p className="mt-1 max-w-[320px] text-xs leading-relaxed" style={{ color: theme.muted }}>
              {t('todoboards.gantt.emptyHint')}
            </p>
          </div>
        ) : (
          <div className="relative min-w-max" style={{ width: LABEL_W + geo.laneW }}>
            <div
              className="sticky top-0 z-30 flex border-b"
              style={{ height: HEAD_H, backgroundColor: theme.panel, borderColor: theme.border }}
            >
              <div
                className="sticky left-0 z-40 flex flex-shrink-0 items-center gap-2 px-3"
                style={{ width: LABEL_W, backgroundColor: theme.panel, borderRight: `1px solid ${theme.border}` }}
              >
                <CalendarRange size={13} style={{ color: theme.today }} />
                {visibleMonth && (
                  <span className="text-[11px] font-medium tabular-nums" style={{ color: theme.muted }}>
                    {visibleMonth}
                  </span>
                )}
              </div>
              <div className="relative flex-shrink-0" style={{ width: geo.laneW }}>
                {months.map((m) => (
                  <div
                    key={`${m.start}-${m.label}`}
                    className="absolute top-0 flex h-[26px] items-center overflow-hidden whitespace-nowrap border-l pl-1.5 text-[11px] font-medium"
                    style={{
                      left: m.start * dayW,
                      width: (m.end - m.start) * dayW,
                      borderColor: withAlpha(theme.border, 0.9),
                      color: theme.ink,
                    }}
                  >
                    {m.start * dayW > scrollLeft + 8 && m.label}
                  </div>
                ))}
                {Array.from({ length: geo.totalDays }, (_, i) => {
                  if (i % dayLabelStep !== 0 && dateAt(geo.t0 + i).getDate() !== 1) return null
                  const d = dateAt(geo.t0 + i)
                  const weekend = d.getDay() === 0 || d.getDay() === 6
                  const isToday = geo.t0 + i === todayIdx
                  return (
                    <div
                      key={`day-${i}`}
                      className="absolute bottom-0 flex h-[32px] flex-col items-center justify-start pt-0.5 text-[9px] tabular-nums"
                      style={{ left: i * dayW, width: dayW, color: weekend ? theme.weekend : theme.muted }}
                    >
                      {showWeekday && (
                        <span className="text-[9px] opacity-70">{fmtWeekday(lang, d, 'narrow')}</span>
                      )}
                      <span
                        className={clsx('flex h-4 min-w-4 items-center justify-center rounded-full px-0.5', isToday && 'font-semibold')}
                        style={isToday ? { backgroundColor: theme.today, color: theme.panel } : undefined}
                      >
                        {d.getDate()}
                      </span>
                    </div>
                  )
                })}
                <div
                  className="pointer-events-none absolute bottom-0 top-[26px] w-px"
                  style={{ left: geo.todayX + dayW / 2, backgroundColor: theme.today, opacity: 0.6 }}
                />
              </div>
            </div>

            <div className="relative" style={{ height: geo.contentH }}>
              {weekendCols.map((i) => (
                <div
                  key={`weekend-${i}`}
                  className="pointer-events-none absolute top-0"
                  style={{
                    left: LABEL_W + i * dayW,
                    width: dayW,
                    height: geo.contentH,
                    backgroundColor: withAlpha(theme.subtle, 0.5),
                  }}
                />
              ))}
              {weekLines.map((i) => (
                <div
                  key={`week-${i}`}
                  className="pointer-events-none absolute top-0 w-px"
                  style={{ left: LABEL_W + i * dayW, height: geo.contentH, backgroundColor: withAlpha(theme.border, 0.75) }}
                />
              ))}
              {dayW >= 28 &&
                Array.from({ length: geo.totalDays }, (_, i) => (
                  <div
                    key={`grid-${i}`}
                    className="pointer-events-none absolute top-0 w-px"
                    style={{ left: LABEL_W + i * dayW, height: geo.contentH, backgroundColor: withAlpha(theme.border, 0.28) }}
                  />
                ))}
              <div
                className="pointer-events-none absolute top-0 z-0 w-[1.5px]"
                style={{ left: LABEL_W + geo.todayX + dayW / 2, height: geo.contentH, backgroundColor: theme.today, opacity: 0.65 }}
              />

              {groups.map((group) => {
                const isCollapsed = collapsed.has(group.listId)
                return (
                  <div key={group.listId}>
                    <div
                      className="flex cursor-pointer select-none items-center border-b"
                      style={{ height: GROUP_H, borderColor: withAlpha(theme.border, 0.7) }}
                      onClick={() => toggleGroup(group.listId)}
                    >
                      <div
                        className="sticky left-0 z-20 flex flex-shrink-0 items-center gap-1.5 px-2"
                        style={{
                          width: LABEL_W,
                          height: GROUP_H,
                          backgroundColor: theme.subtle,
                          borderRight: `1px solid ${theme.border}`,
                        }}
                      >
                        {isCollapsed ? (
                          <ChevronRight size={13} style={{ color: theme.muted }} />
                        ) : (
                          <ChevronDown size={13} style={{ color: theme.muted }} />
                        )}
                        <span className="truncate text-[11px] font-semibold" style={{ color: theme.ink }}>
                          {group.name}
                        </span>
                        <span className="ml-auto text-[10px] tabular-nums" style={{ color: theme.muted }}>
                          {group.rows.length}
                        </span>
                      </div>
                      <div
                        className="flex-1"
                        style={{
                          height: GROUP_H,
                          backgroundColor: withAlpha(theme.subtle, 0.55),
                          borderTop: `1px solid ${withAlpha(theme.border, 0.45)}`,
                        }}
                      />
                    </div>

                    {!isCollapsed &&
                      group.rows.map(({ todo, range }) => {
                        const startIdx = dayIndex(range.start!)
                        const endIdx = dayIndex(range.end!)
                        const rawLeft = (startIdx - geo.t0) * dayW
                        const rawRight = (endIdx - geo.t0 + 1) * dayW
                        const left = Math.max(rawLeft, scrollLeft)
                        const right = Math.min(rawRight, scrollLeft + viewportLane, geo.laneW)
                        const showBar = right > left
                        const width = Math.max(right - left - 2, range.milestone ? 10 : 6)
                        const clippedLeft = rawLeft < scrollLeft
                        const clippedRight = rawRight > scrollLeft + viewportLane
                        const tone = toneOf(todo, range)
                        const selected = selectedTodoId === todo.id
                        const rangeLabel = range.milestone
                          ? formatMilestone(range.start!, today)
                          : formatRange(range.start!, range.end!)
                        const statusLabel = labelOf(STATUS_KEYS, todo.status, t)

                        return (
                          <div
                            key={todo.id}
                            role="button"
                            tabIndex={0}
                            className="flex cursor-pointer border-b outline-none transition-colors"
                            style={{
                              height: ROW_H,
                              borderColor: withAlpha(theme.border, 0.55),
                              backgroundColor: selected ? withAlpha(theme.today, 0.08) : 'transparent',
                            }}
                            onClick={() => onSelect(todo.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                onSelect(todo.id)
                              }
                            }}
                          >
                            <div
                              className="sticky left-0 z-20 flex flex-shrink-0 items-center gap-2 px-2"
                              style={{
                                width: LABEL_W,
                                height: ROW_H,
                                backgroundColor: selected ? withAlpha(theme.today, 0.08) : theme.panel,
                                borderRight: `1px solid ${theme.border}`,
                                borderLeft: selected ? `2px solid ${theme.today}` : '2px solid transparent',
                              }}
                            >
                              <span
                                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: tone.dot, boxShadow: `0 0 0 2px ${withAlpha(tone.dot, 0.14)}` }}
                              />
                              <div className="min-w-0 flex-1">
                                <div
                                  className={clsx('truncate text-[12px] leading-4', range.overdue && 'font-medium')}
                                  style={{ color: range.overdue ? theme.weekend : theme.ink }}
                                  title={todo.title}
                                >
                                  {todo.title}
                                </div>
                                <div className="truncate text-[10px] leading-3 tabular-nums" style={{ color: theme.muted }}>
                                  {rangeLabel}
                                  <span className="ml-1.5" style={{ color: withAlpha(theme.muted, 0.75) }}>
                                    {statusLabel}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="relative flex-shrink-0" style={{ width: geo.laneW }}>
                              {showBar && (range.milestone ? (
                                <div
                                  className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1"
                                  style={{ left: left + width / 2 - 5 }}
                                  title={t('todoboards.gantt.barTitle', {
                                    range: rangeLabel,
                                    overdue: range.overdue ? t('todoboards.gantt.overdueSuffix') : '',
                                    status: statusLabel,
                                  })}
                                >
                                  <span
                                    className="h-2.5 w-2.5 rotate-45 rounded-[2px]"
                                    style={{
                                      backgroundColor: tone.fill,
                                      border: `1.5px solid ${tone.dot}`,
                                      boxShadow: selected ? `0 0 0 3px ${withAlpha(theme.today, 0.25)}` : undefined,
                                    }}
                                  />
                                  {dayW >= 22 && (
                                    <span className="whitespace-nowrap text-[9px] tabular-nums" style={{ color: theme.muted }}>
                                      {formatMilestone(range.start!, today)}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div
                                  className="absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden rounded-[6px] border text-[9px]"
                                  style={{
                                    left,
                                    width,
                                    height: BAR_H,
                                    backgroundColor: tone.fill,
                                    borderColor: tone.border,
                                    borderStyle: tone.dashed ? 'dashed' : 'solid',
                                    color: tone.text,
                                    boxShadow: selected ? `0 0 0 2px ${withAlpha(theme.today, 0.4)}` : `0 1px 2px ${withAlpha(theme.ink, 0.06)}`,
                                  }}
                                  title={t('todoboards.gantt.barTitle', {
                                    range: rangeLabel,
                                    overdue: range.overdue ? t('todoboards.gantt.overdueSuffix') : '',
                                    status: statusLabel,
                                  })}
                                >
                                  <span
                                    className="absolute inset-y-0 left-0 w-[3px]"
                                    style={{ backgroundColor: tone.dot }}
                                  />
                                  {clippedLeft && <span className="pl-1.5 opacity-60">‹</span>}
                                  {width > 92 && (
                                    <span className={clsx('truncate px-2 tabular-nums', clippedLeft && 'pl-0.5')}>
                                      {rangeLabel}
                                    </span>
                                  )}
                                  {range.overdue && width > 120 && (
                                    <span className="ml-auto whitespace-nowrap pr-2 font-medium">{t('todoboards.gantt.overdueBar')}</span>
                                  )}
                                  {clippedRight && <span className="ml-auto pr-1 opacity-60">›</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {unscheduled.length > 0 && (
        <div className="flex-shrink-0 border-t" style={{ borderColor: theme.border, backgroundColor: theme.panel }}>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left"
            onClick={() => setShowUnscheduled((v) => !v)}
            aria-expanded={showUnscheduled}
          >
            {showUnscheduled ? (
              <ChevronDown size={13} style={{ color: theme.muted }} />
            ) : (
              <ChevronRight size={13} style={{ color: theme.muted }} />
            )}
            <span className="text-[11px] font-medium" style={{ color: theme.ink }}>
              {t('todoboards.gantt.unscheduledCount', { n: unscheduled.length })}
            </span>
            <span className="truncate text-[10px]" style={{ color: theme.muted }}>
              {t('todoboards.gantt.unscheduledHint')}
            </span>
          </button>
          {showUnscheduled && (
            <div className="flex max-h-[132px] flex-wrap gap-1.5 overflow-y-auto px-3 pb-2">
              {unscheduled.map(({ todo }) => {
                const selected = selectedTodoId === todo.id
                return (
                  <button
                    key={todo.id}
                    type="button"
                    onClick={() => onSelect(todo.id)}
                    className="flex max-w-[240px] items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] transition-colors hover:opacity-80"
                    style={{
                      borderColor: selected ? theme.today : theme.border,
                      backgroundColor: selected ? withAlpha(theme.today, 0.08) : withAlpha(theme.subtle, 0.55),
                      color: theme.ink,
                    }}
                    title={todo.title}
                  >
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: theme.muted }} />
                    <span className="truncate">{todo.title}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
