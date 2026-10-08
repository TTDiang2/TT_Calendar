import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import type { Layer, MonthData } from '../types'
import { COLORING_COLORS, getBusyColors, parseDate, todayStr } from '../data'
import { getTodoBusyConfig } from '../api/client'
import { useT, useLang, fmtDate } from '../i18n'
import { layerLabel } from '../i18n/adapt/layerLabel'

interface Props {
  monthData: MonthData
  layers: Layer[]
  selectedDate: string | null
  onSelect: (date: string) => void
  onDoubleClick: (date: string) => void
}

export function DayView({ monthData, layers, selectedDate, onSelect, onDoubleClick }: Props) {
  const t = useT()
  const lang = useLang()
  const { data: busyConfig } = useQuery({ queryKey: ['todoBusyConfig'], queryFn: getTodoBusyConfig, staleTime: 60_000 })
  const day = monthData.days[0]
  if (!day) return <div className="flex-1 flex items-center justify-center text-gray-400">{t('calendar.noData')}</div>

  const { y, m, d } = parseDate(day.date)
  const dt = new Date(y, m - 1, d)
  // 日期串走 Intl（决策 #7）：zh「9月3日」「2023年 周六」与旧手写拼接逐字一致
  //（后者含 year 与星期间的半角空格，Intl 的 year+weekday 组合恰好保留）
  const titleDate = fmtDate(lang, dt, { month: 'short', day: 'numeric' })
  const titleYearWeekday = fmtDate(lang, dt, { year: 'numeric', weekday: 'short' })
  const layerById = new Map(layers.map((l) => [l.layer_id, l]))

  const visibleEvents = Object.entries(day.events_by_layer)
    .filter(([lid]) => layerById.get(lid)?.enabled)
    .flatMap(([, evs]) => evs)
    .sort((a, b) => a.sort_key - b.sort_key)

  const colorLayers: string[] = []
  if (layerById.get('important')?.enabled && day.gradient_bg && day.gradient_bg.toLowerCase() !== '#ffffff') {
    colorLayers.push(day.gradient_bg)
  }
  if (layerById.get('coloring')?.enabled && day.coloring_level != null) {
    colorLayers.push(COLORING_COLORS[day.coloring_level])
  }
  for (const b of getBusyColors(day, todayStr(), busyConfig)) {
    if (layerById.get(b.id)?.enabled) colorLayers.push(b.color)
  }
  // 多个染色维度时按优先级取一个做色条（避免多条色条叠加）
  const barColor = colorLayers[0]

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex flex-col rounded-lg border overflow-hidden relative">
        {barColor && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1"
            style={{ backgroundColor: barColor }}
          />
        )}
        <div
          className={clsx(
            'px-4 py-3 pl-5 flex items-center justify-between cursor-pointer',
            day.is_today ? 'bg-blue-500 text-white' : 'bg-gray-100',
          )}
          onClick={() => onSelect(day.date)}
          onDoubleClick={() => onDoubleClick(day.date)}
        >
          <div>
            <p className="text-lg font-semibold">{titleDate}</p>
            <p className="text-xs opacity-80">{titleYearWeekday}{day.is_weekend ? t('calendar.weekendSuffix') : ''}</p>
          </div>
          {day.holiday?.name && <span className="text-xs bg-purple-500 text-white px-2 py-1 rounded">{day.holiday.name}</span>}
        </div>

        <div className="flex-1 p-4 overflow-y-auto">
          {day.custom_bg && (
            <div className="mb-4 flex items-center gap-1">
              <span className="text-xs text-gray-500 mr-1">{t('calendar.markLabel')}</span>
              <span
                className="px-2 py-0.5 rounded text-[11px] text-white"
                style={{ backgroundColor: day.custom_bg.color }}
              >
                {day.custom_bg.label}
              </span>
            </div>
          )}
          {day.coloring_level != null && (
            <div className="mb-4 flex items-center gap-1">
              <span className="text-xs text-gray-500 mr-1">{t('calendar.fullnessLabel')}</span>
              {COLORING_COLORS.map((c, i) => (
                <span
                  key={i}
                  className={clsx('w-6 h-2 rounded', i === day.coloring_level && 'ring-2 ring-blue-400')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          )}
          {day.schedule_items && day.schedule_items.length > 0 && (
            <div className="mb-4 space-y-1">
              {[...day.schedule_items]
                .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
                .map((it) => (
                  <div
                    key={it.id ?? `${it.title}-${it.start_time}`}
                    className="flex items-center gap-2 text-sm rounded-md border border-gray-100 px-2 py-1"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: it.color ?? '#3D6BFB' }}
                    />
                    {it.start_time && (
                      <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">
                        {it.start_time}{it.end_time ? `-${it.end_time}` : ''}
                      </span>
                    )}
                    <span className="text-gray-800">{it.title}</span>
                    {it.span_total && it.span_total > 1 && (
                      <span className="text-[11px] text-blue-600 flex-shrink-0">
                        {t('calendar.spanRange', { i: it.span_index ?? '', total: it.span_total, start: it.span_start ?? '', end: it.span_end ?? '' })}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          )}
          {visibleEvents.length === 0 ? (
            <p className="text-sm text-gray-400">{t('calendar.emptyDay')}</p>
          ) : (
            <ul className="space-y-2">
              {visibleEvents.map((ev) => {
                const l = layerById.get(ev.layer_id)
                return (
                  <li key={ev.id ?? ev.title} className="flex items-start gap-2">
                    <span className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: ev.color ?? l?.color ?? '#9ca3af' }} />
                    <div>
                      <p className="text-sm font-medium">{ev.title}</p>
                      {l && <p className="text-[11px] text-gray-400">{layerLabel(l, t)}</p>}
                      {ev.description && <p className="text-xs text-gray-500 mt-0.5">{ev.description}</p>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
