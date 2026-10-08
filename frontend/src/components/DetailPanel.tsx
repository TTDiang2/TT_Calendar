import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CheckCircle2, Clock, Palette, Pencil, Sparkles, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import type { CalEvent, Day, Layer } from '../types'
import { COLORING_COLORS, parseDate, TODO_BUSY_PREDICT_COLORS, TODO_BUSY_DONE_COLORS } from '../data'
import { deleteEvent, deleteMark, deleteScheduleItem, getSources, getTodoBusyConfig, updateTodo, type SourceFieldSpec } from '../api/client'
import { useT, useLang, fmtWeekday } from '../i18n'
import { layerLabel } from '../i18n/adapt/layerLabel'
import { lunarDisplay } from '../i18n/adapt/labels'
import { SourceFields } from './SourceFields'

interface Props {
  day: Day | null
  layers: Layer[]
  onEditEvent: (date: string, event: CalEvent) => void
  onEditSchedule: (date: string) => void
  onSetColoring: (date: string) => void
  onAddEntry: (date: string, kind: 'dot' | 'color') => void
}

export function DetailPanel({ day, layers, onEditEvent, onEditSchedule, onSetColoring, onAddEntry }: Props) {
  const t = useT()
  const lang = useLang()
  const qc = useQueryClient()
  const { data: busyConfig } = useQuery({ queryKey: ['todoBusyConfig'], queryFn: getTodoBusyConfig, staleTime: 60_000 })
  const { data: sources } = useQuery({ queryKey: ['sources'], queryFn: getSources, staleTime: 5 * 60_000 })
  // source_id → 字段 UI 规格（插件声明；无规格的源不渲染 extra）
  const fieldSpecBySource = {} as Record<string, SourceFieldSpec>
  for (const s of sources ?? []) {
    if (s.field_specs) fieldSpecBySource[s.source_id] = s.field_specs
  }
  const delMut = useMutation({
    mutationFn: (id: number) => deleteEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
      qc.invalidateQueries({ queryKey: ['countdown'] })
    },
  })
  const delScheduleMut = useMutation({
    mutationFn: (id: number) => deleteScheduleItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
      qc.invalidateQueries({ queryKey: ['scheduleItems'] })
    },
  })
  const delMarkMut = useMutation({
    mutationFn: ({ layerId, date }: { layerId: string; date: string }) => deleteMark(layerId, date),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
    },
  })
  const toggleTodoMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => updateTodo(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
      qc.invalidateQueries({ queryKey: ['todos'] })
    },
  })

  if (!day) {
    return (
      <aside className="w-72 bg-white border-l border-gray-200 p-4 overflow-y-auto">
        <p className="text-sm text-gray-400">{t('detail.panelEmpty')}</p>
      </aside>
    )
  }

  const { y, m, d } = parseDate(day.date)
  // 星期/日期展示（决策 #7：星期名走 Intl 有缓存封装）：zh 下 fmtWeekday 产出「周六」，
  // 与原手拼 '周' + '六' 逐字一致；月/日/年保留手拼空格（{m} 月 {d} 日，见 detail.ts 头注）
  const dt = new Date(y, m - 1, d)
  const lunarText = lunarDisplay(lang, day.lunar)
  const enabledSet = new Set(layers.filter((l) => l.enabled).map((l) => l.layer_id))
  // 涂色图层（kind=color 且 custom_*）的旧 events 不当事件显示（已迁到 marks）
  const colorLayerIds = new Set(layers.filter((l) => l.kind === 'color' && l.layer_id.startsWith('custom_')).map((l) => l.layer_id))
  const events = Object.entries(day.events_by_layer)
    .filter(([lid]) => (lid === 'important' || enabledSet.has(lid)) && !colorLayerIds.has(lid))
    .flatMap(([, evs]) => evs)
  const layerColor = (lid: string) => layers.find((l) => l.layer_id === lid)?.color ?? '#9ca3af'
  const layerName = (lid: string) => {
    const l = layers.find((x) => x.layer_id === lid)
    return l ? layerLabel(l, t) : lid
  }

  return (
    <aside className="w-72 bg-white border-l border-gray-200 p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[11px] text-gray-400">{t('detail.selectedDate')}</p>
          <p className="text-2xl font-semibold text-gray-800">
            {t('detail.dateMD', { m, d })}
          </p>
          <p className="text-sm text-gray-500">
            {t('detail.yearWeekday', { y, weekday: fmtWeekday(lang, dt, 'short') })}
            {lunarText && <span className="ml-2 text-gray-400">{lunarText}</span>}
            {day.is_today && <span className="ml-2 text-blue-500 text-xs">{t('topbar.today')}</span>}
          </p>
        </div>
      </div>

      <div className="flex gap-1 mb-4">
        <button
          onClick={() => onAddEntry(day.date, 'dot')}
          className="flex-1 flex items-center justify-center gap-1 text-xs text-gray-600 py-1.5 rounded-md bg-gray-50 hover:bg-gray-100"
        >
          <Clock size={12} /> {t('detail.dot')}
        </button>
        <button
          onClick={() => onAddEntry(day.date, 'color')}
          className="flex-1 flex items-center justify-center gap-1 text-xs text-gray-600 py-1.5 rounded-md bg-gray-50 hover:bg-gray-100"
        >
          <Palette size={12} /> {t('detail.coloring')}
        </button>
      </div>

      {day.holiday?.name && (
        <div className="mb-3 p-2 rounded-lg bg-purple-50 border border-purple-100">
          <p className="text-xs text-purple-600 font-medium">🏮 {day.holiday.name}</p>
        </div>
      )}

      {/* 5 档涂色：内置充实度 + 自定义 graded marks + 待办忙度 predict/done（无标题） */}
      {(day.coloring_level != null
        || day.marks?.some((mk) => mk.mode === 'graded')
        || day.predict_level != null
        || day.done_level != null) && (
        <div className="mb-3 space-y-1">
          {day.coloring_level != null && (
            <div className="flex items-center gap-2 group">
              <span className="text-[11px] text-gray-500 w-16 flex-shrink-0 truncate">{t('detail.fullness')}</span>
              <div className="flex-1 flex gap-px h-2 rounded overflow-hidden">
                {COLORING_COLORS.map((c, i) => (
                  <div key={i} className="flex-1" style={{ backgroundColor: c, opacity: i <= day.coloring_level! ? 1 : 0.3 }} />
                ))}
              </div>
              <span className="text-xs text-gray-500">{day.coloring_level + 1}/5</span>
            </div>
          )}
          {(day.marks ?? [])
            .filter((mk) => mk.mode === 'graded')
            .map((mk) => (
              <div key={mk.layer_id} className="flex items-center gap-2 group">
                <span className="text-[11px] text-gray-500 w-16 flex-shrink-0 truncate">{mk.display_name}</span>
                {mk.level != null ? (
                  <>
                    <div className="flex-1 flex gap-px h-2 rounded overflow-hidden">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div
                          key={i}
                          className="flex-1"
                          style={{ backgroundColor: mk.color ?? '#9ca3af', opacity: i <= mk.level! ? 1 : 0.3 }}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-gray-500">{(mk.level ?? 0) + 1}/5</span>
                  </>
                ) : (
                  <span className="flex-1 text-[11px] text-gray-300">{t('detail.noLevel')}</span>
                )}
                <button
                  onClick={() => delMarkMut.mutate({ layerId: mk.layer_id, date: day.date })}
                  className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition flex-shrink-0"
                  title={t('detail.deleteMark')}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          {day.predict_level != null && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-16 flex-shrink-0 truncate">{t('detail.todoPredict')}</span>
              <div className="flex-1 flex gap-px h-2 rounded overflow-hidden">
                {(busyConfig?.predict_colors ?? TODO_BUSY_PREDICT_COLORS).map((c, i) => (
                  <div key={i} className="flex-1" style={{ backgroundColor: c, opacity: i <= day.predict_level! ? 1 : 0.3 }} />
                ))}
              </div>
              <span className="text-xs text-gray-500">{day.predict_level! + 1}/5</span>
            </div>
          )}
          {day.done_level != null && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-16 flex-shrink-0 truncate">{t('detail.todoDone')}</span>
              <div className="flex-1 flex gap-px h-2 rounded overflow-hidden">
                {(busyConfig?.done_colors ?? TODO_BUSY_DONE_COLORS).map((c, i) => (
                  <div key={i} className="flex-1" style={{ backgroundColor: c, opacity: i <= day.done_level! ? 1 : 0.3 }} />
                ))}
              </div>
              <span className="text-xs text-gray-500">{day.done_level! + 1}/5</span>
            </div>
          )}
        </div>
      )}

      {/* 单色涂色：自定义 solid marks（无标题） */}
      {day.marks?.some((mk) => mk.mode !== 'graded') && (
        <div className="mb-3 space-y-1">
          {day.marks
            .filter((mk) => mk.mode !== 'graded')
            .map((mk) => (
              <div key={mk.layer_id} className="flex items-center gap-2 group">
                <span className="text-[11px] text-gray-500 w-16 flex-shrink-0 truncate">{mk.display_name}</span>
                <div className="flex-1 flex items-center gap-1">
                  <span className="w-3 h-3 rounded flex-shrink-0" style={{ backgroundColor: mk.color ?? '#9ca3af' }} />
                  <span className="text-[11px] text-gray-400">{t('detail.marked')}</span>
                </div>
                <button
                  onClick={() => delMarkMut.mutate({ layerId: mk.layer_id, date: day.date })}
                  className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition flex-shrink-0"
                  title={t('detail.deleteMark')}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
        </div>
      )}

      {(day.schedule_items?.length ?? 0) > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Clock size={12} /> {t('detail.schedule')}
            </div>
            <button
              onClick={() => onEditSchedule(day.date)}
              className="text-[11px] text-gray-400 hover:text-blue-500"
              title={t('detail.editAllSchedule')}
            >
              {t('detail.edit')}
            </button>
          </div>
          <div className="space-y-1">
            {[...(day.schedule_items ?? [])]
              .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
              .map((it) => (
                <div
                  key={it.id ?? `${it.title}-${it.start_time}`}
                  className="flex items-center gap-1.5 group rounded -mx-1 px-1 py-0.5 hover:bg-gray-50"
                >
                  <span className="text-gray-400 flex-shrink-0 tabular-nums whitespace-nowrap text-sm">
                    {it.start_time ? (it.end_time ? `${it.start_time}-${it.end_time}` : it.start_time) : t('detail.allDay')}
                  </span>
                  <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">
                    {it.title}
                    {it.span_total && it.span_total > 1 && (
                      <span className="ml-1 text-[10px] text-blue-600">
                        {t('detail.multiDay', { index: it.span_index ?? '', total: it.span_total ?? '' })}
                      </span>
                    )}
                  </span>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                    <button
                      onClick={() => onEditSchedule(day.date)}
                      className="p-1 text-gray-400 hover:text-blue-500"
                      title={t('dialogs.menu.editSchedule')}
                    >
                      <Pencil size={12} />
                    </button>
                    {it.id && (
                      <button
                        onClick={() => delScheduleMut.mutate(it.id!)}
                        className="p-1 text-gray-400 hover:text-red-500"
                        title={t('dialogs.deleteScheduleItem')}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-1 mb-1.5 text-xs text-gray-400">
          <CalendarDays size={12} /> {t('detail.eventsCount', { n: events.length })}
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-gray-300 flex items-center gap-1">
            <Sparkles size={12} /> {t('detail.noEvents')}
          </p>
        ) : (
          <div className="space-y-2">
            {events.map((ev, i) => (
              <div key={ev.id ?? i} className="p-2 rounded-lg bg-gray-50 border border-gray-100 group">
                <div className="flex items-start gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                    style={{ backgroundColor: ev.color ?? layerColor(ev.layer_id) }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 leading-tight">{ev.title}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{layerName(ev.layer_id)}</p>
                    {ev.description && <p className="text-xs text-gray-400 mt-1">{ev.description}</p>}
                    {fieldSpecBySource[ev.source] && ev.source !== 'manual' && (
                      <SourceFields spec={fieldSpecBySource[ev.source]} extra={ev.extra} />
                    )}
                  </div>
                  {ev.source === 'manual' && ev.id && (
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={() => onEditEvent(day.date, ev)}
                        className="p-1 text-gray-400 hover:text-blue-500"
                        title={t('detail.edit')}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => ev.id && delMut.mutate(ev.id)}
                        className="p-1 text-gray-400 hover:text-red-500"
                        title={t('common.delete')}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {day.todos && day.todos.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-1 mb-1.5 text-xs text-gray-400">
            <CheckCircle2 size={12} /> {t('detail.todosCount', { n: day.todos.length })}
          </div>
          <div className="space-y-1">
            {day.todos.map((td) => {
              const isDone = td.status === 'completed'
              return (
                <div key={td.id} className="flex items-start gap-1.5 p-1.5 rounded bg-amber-50/50">
                  <button
                    onClick={() => toggleTodoMut.mutate({
                      id: td.id,
                      data: { ...td, id: td.id, status: isDone ? 'notStarted' : 'completed' },
                    })}
                    className={clsx(
                      'w-3.5 h-3.5 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center',
                      isDone ? 'bg-amber-500 border-amber-500' : 'border-gray-300 hover:border-amber-400',
                    )}
                  >
                    {isDone && <span className="text-white text-[8px]">✓</span>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={clsx('text-sm leading-tight', isDone ? 'text-gray-400 line-through' : 'text-gray-700')}>{td.title}</p>
                    {td.importance === 'high' && !isDone && <span className="text-[10px] text-red-500">{t('detail.highImportance')}</span>}
                    {td.due_date === day.date && !isDone && (
                      <span className="text-[10px] text-red-500 ml-1">{t('detail.dueTag')}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </aside>
  )
}
