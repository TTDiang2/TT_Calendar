import { useMemo } from 'react'
import clsx from 'clsx'
import { Clock, Palette, Plus, Sparkles } from 'lucide-react'
import type { CalEvent, Layer, MonthData } from '../types'
import { parseDate } from '../data'
import { fmtDate, fmtWeekday, useLang, useT } from '../i18n'
import { layerLabel } from '../i18n/adapt/layerLabel'
import { lunarDisplay } from '../i18n/adapt/labels'
import { useCalendarTheme, withAlpha } from '../lib/calendar-theme'
import { scheduleGroupsOf, solidMarksOf, visibleEventsOf } from '../lib/day-presentation'

interface Props {
  monthData: MonthData
  layers: Layer[]
  onSelect: (date: string) => void
  onDoubleClick: (date: string) => void
  onEditEvent: (date: string, event: CalEvent) => void
  onEditSchedule: (date: string) => void
  onAddEntry: (date: string, kind: 'dot' | 'color') => void
}

/**
 * 日视图 = 日期书脊 + 当天议程。
 *
 * 旧版把当天的日程、事件、涂色全堆进一张带高饱和标题的卡片，下方大片空白，
 * 而右侧详情栏又把同一批日程和事件列了一遍。改成两栏以后：
 *  - 左边只讲「这是哪一天」（日期、农历、节假日、充实度、标记）
 *  - 右边只讲「今天有什么」（全天 / 时间轴 / 事件），按时间排
 *  - 右侧详情栏在日模式下收起清单，只留编辑入口，不再左右各一份
 */
export function DayView({ monthData, layers, onSelect, onDoubleClick, onEditEvent, onEditSchedule, onAddEntry }: Props) {
  const t = useT()
  const lang = useLang()
  const { theme } = useCalendarTheme()
  const day = monthData.days[0]

  const derived = useMemo(() => {
    if (!day) return null
    const events = visibleEventsOf(day, layers)
    const groups = scheduleGroupsOf(day)
    return { events, groups, marks: solidMarksOf(day) }
  }, [day, layers])

  if (!day || !derived) {
    return <div className="flex-1 flex items-center justify-center" style={{ color: theme.muted }}>{t('calendar.noData')}</div>
  }

  const { y, m, d } = parseDate(day.date)
  const dt = new Date(y, m - 1, d)
  const lunarText = lunarDisplay(lang, day.lunar)
  const layerById = new Map(layers.map((l) => [l.layer_id, l]))

  const { events, groups, marks } = derived
  const scheduleCount = groups.timed.length + groups.allDay.length + groups.continuations.length
  const isEmpty = scheduleCount === 0 && events.length === 0


  return (
    <div className="flex-1 flex gap-3 min-h-0">
      {/* 日期书脊 */}
      <aside
        className="w-[196px] flex-shrink-0 flex flex-col gap-3 rounded-xl border p-4 overflow-y-auto"
        style={{ backgroundColor: 'var(--cal-panel)', borderColor: theme.border }}
        onClick={() => onSelect(day.date)}
        onDoubleClick={() => onDoubleClick(day.date)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect(day.date) }}
      >
        <div>
          <div className="flex items-baseline justify-between">
            <span
              className="text-[54px] leading-[0.9] font-semibold tabular-nums tracking-tight"
              style={{ color: day.is_today ? theme.today : theme.ink }}
            >
              {d}
            </span>
            {day.is_today && (
              <span
                className="text-[10px] px-1.5 py-[2px] rounded-full font-medium"
                style={{ backgroundColor: withAlpha(theme.today, 0.12), color: theme.today }}
              >
                {t('topbar.today')}
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px]" style={{ color: theme.muted }}>
            {fmtDate(lang, dt, { year: 'numeric', month: 'long' })}
          </p>
          <p className="text-[12px] font-medium" style={{ color: day.is_weekend ? theme.weekend : theme.ink }}>
            {fmtWeekday(lang, dt, 'long')}
            {lunarText && <span className="ml-1.5 font-normal" style={{ color: theme.muted }}>{lunarText}</span>}
          </p>
        </div>

        {(day.holiday?.name || day.holiday?.is_workday_made_up) && (
          <div className="flex flex-wrap gap-1">
            {day.holiday?.name && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ backgroundColor: withAlpha(theme.danger, 0.1), color: theme.danger }}
              >
                {day.holiday.name}
              </span>
            )}
            {day.holiday?.is_workday_made_up && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ backgroundColor: withAlpha(theme.warning, 0.14), color: theme.warning }}
              >
                {t('calendar.makeUpWorkday')}
              </span>
            )}
          </div>
        )}

        {/* 充实度：5 段色块，当前档实心其余淡化 */}
        {day.coloring_level != null && (
          <div>
            <p className="text-[10px] mb-1" style={{ color: theme.muted }}>{t('calendar.fullnessLabel')}</p>
            <div className="flex gap-[3px]">
              {theme.coloring.map((c, i) => (
                <span
                  key={i}
                  className="flex-1 h-1.5 rounded-full transition-opacity"
                  style={{ backgroundColor: c, opacity: i <= day.coloring_level! ? 1 : 0.22 }}
                />
              ))}
            </div>
          </div>
        )}

        {/* 待办忙度：预测 / 已完成两条细条，只在有值时出现 */}
        {(day.predict_level != null || day.done_level != null) && (
          <div className="flex flex-col gap-1.5">
            {day.predict_level != null && layerById.get('todo')?.enabled && (
              <div>
                <p className="text-[9.5px] mb-0.5 whitespace-nowrap" style={{ color: theme.muted }}>{t('detail.todoPredict')}</p>
                <div className="flex gap-[2px]">
                  {theme.predict.map((c, i) => (
                    <span
                      key={i}
                      className="flex-1 h-1 rounded-full"
                      style={{ backgroundColor: c, opacity: i <= day.predict_level! ? 1 : 0.2 }}
                    />
                  ))}
                </div>
              </div>
            )}
            {day.done_level != null && layerById.get('todo_done')?.enabled && (
              <div>
                <p className="text-[9.5px] mb-0.5 whitespace-nowrap" style={{ color: theme.muted }}>{t('detail.todoDone')}</p>
                <div className="flex gap-[2px]">
                  {theme.done.map((c, i) => (
                    <span
                      key={i}
                      className="flex-1 h-1 rounded-full"
                      style={{ backgroundColor: c, opacity: i <= day.done_level! ? 1 : 0.2 }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {marks.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {marks.map((mk) => (
              <span
                key={mk.layer_id}
                className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
                style={{ backgroundColor: theme.subtle, color: theme.ink }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: mk.color ?? theme.muted }} />
                {mk.display_name}
              </span>
            ))}
          </div>
        )}
      </aside>

      {/* 当日议程 */}
      <section
        className="flex-1 min-w-0 flex flex-col rounded-xl border overflow-hidden"
        style={{ backgroundColor: 'var(--cal-panel)', borderColor: theme.border }}
      >
        <header
          className="flex items-center justify-between gap-2 px-4 py-2.5 flex-shrink-0"
          style={{ borderBottom: `1px solid ${theme.border}` }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: theme.muted }}>
              {scheduleCount} {t('calendar.scheduleUnit')}
              <span className="mx-1">·</span>
              {events.length} {t('calendar.eventUnit')}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onAddEntry(day.date, 'dot')}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md cal-hover-bg"
              style={{ color: theme.muted }}
            >
              <Plus size={12} /> {t('detail.dot')}
            </button>
            <button
              onClick={() => onAddEntry(day.date, 'color')}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md cal-hover-bg"
              style={{ color: theme.muted }}
            >
              <Palette size={12} /> {t('detail.coloring')}
            </button>
            <button
              onClick={() => onEditSchedule(day.date)}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md"
              style={{ backgroundColor: withAlpha(theme.accent, 0.1), color: theme.accent }}
            >
              <Clock size={12} /> {t('detail.schedule')}
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {isEmpty ? (
            <div className="h-full flex flex-col items-center justify-center gap-2">
              <Sparkles size={16} style={{ color: theme.muted }} />
              <p className="text-[13px]" style={{ color: theme.muted }}>{t('calendar.emptyDay')}</p>
              <button
                onClick={() => onDoubleClick(day.date)}
                className="text-[11px] px-2.5 py-1 rounded-md"
                style={{ backgroundColor: withAlpha(theme.accent, 0.1), color: theme.accent }}
              >
                {t('detail.dot')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* 全天 */}
              {(groups.allDay.length > 0 || groups.continuations.length > 0) && (
                <div>
                  <p className="text-[10px] tracking-wide mb-1.5" style={{ color: theme.muted }}>
                    {t('calendar.allDay')}
                  </p>
                  <div className="flex flex-col gap-1">
                    {groups.allDay.map((it) => (
                      <button
                        key={it.id ?? it.title}
                        onClick={() => onEditSchedule(day.date)}
                        className="group flex items-center gap-2 px-2 py-1.5 rounded-lg text-left cal-hover-bg"
                      >
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: it.color ?? theme.accent }} />
                        <span className="text-[13px] flex-1 min-w-0 truncate" style={{ color: theme.ink }}>{it.title}</span>
                        {(it.span_total ?? 1) > 1 && (
                          <span className="text-[10px] flex-shrink-0" style={{ color: theme.muted }}>
                            {t('calendar.spanDays', { n: it.span_total ?? 1 })}
                          </span>
                        )}
                      </button>
                    ))}
                    {groups.continuations.map((it) => (
                      <div
                        key={it.id ?? `c-${it.title}`}
                        className="h-[6px] rounded-full mx-2"
                        style={{
                          backgroundColor: it.color ?? theme.accent,
                          backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0) 40%, rgba(0,0,0,0.05))',
                        }}
                        title={t('calendar.contTitle', { title: it.title, i: String(it.span_index), total: String(it.span_total), start: String(it.span_start) })}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 时间轴 */}
              {groups.timed.length > 0 && (
                <div>
                  <div className="flex flex-col">
                    {groups.timed.map((it, i) => (
                      <button
                        key={it.id ?? it.title}
                        onClick={() => onEditSchedule(day.date)}
                        className="group relative flex items-start gap-3 px-1 py-2 text-left rounded-lg cal-hover-bg"
                      >
                        <div className="w-[52px] flex-shrink-0 text-right">
                          <p className="text-[13px] tabular-nums leading-tight" style={{ color: theme.ink }}>{it.start_time}</p>
                          {it.end_time && (
                            <p className="text-[10px] tabular-nums leading-tight mt-0.5" style={{ color: theme.muted }}>{it.end_time}</p>
                          )}
                        </div>
                        {/* 节点 + 竖线：一格一条日程，时间从上往下读 */}
                        <div className="relative flex flex-col items-center self-stretch pt-1" style={{ width: 10 }}>
                          <span
                            className="w-[7px] h-[7px] rounded-full flex-shrink-0 z-10"
                            style={{ backgroundColor: it.color ?? theme.accent, boxShadow: `0 0 0 3px ${withAlpha(it.color ?? theme.accent, 0.14)}` }}
                          />
                          {i < groups.timed.length - 1 && (
                            <span className="flex-1 w-px mt-1" style={{ backgroundColor: theme.border }} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] leading-snug" style={{ color: theme.ink }}>{it.title}</p>
                          {(it.span_total ?? 1) > 1 && (
                            <p className="text-[10px] mt-0.5" style={{ color: theme.muted }}>
                              {t('calendar.spanRange', { i: String(it.span_index ?? ''), total: String(it.span_total), start: String(it.span_start ?? ''), end: String(it.span_end ?? '') })}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 事件（点点/重要日期等，无时间属性） */}
              {events.length > 0 && (
                <div>
                  <div className="flex flex-col gap-1">
                    {events.map((ev) => {
                      const l = layerById.get(ev.layer_id)
                      return (
                        <button
                          key={ev.id ?? ev.title}
                          onClick={() => { if (ev.source === 'manual') onEditEvent(day.date, ev) }}
                          className={clsx('flex items-start gap-2 px-2 py-1.5 rounded-lg text-left cal-hover-bg', ev.source !== 'manual' && 'cursor-default')}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                            style={{ backgroundColor: ev.color ?? l?.color ?? theme.muted }}
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] leading-snug truncate" style={{ color: theme.ink }}>{ev.title}</span>
                            <span className="block text-[10px] truncate" style={{ color: theme.muted }}>
                              {l ? layerLabel(l, t) : ev.layer_id}
                              {ev.description ? ` · ${ev.description}` : ''}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
