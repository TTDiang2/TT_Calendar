import clsx from 'clsx'
import type { Day, Layer, MonthData } from '../types'
import { COLORING_COLORS, parseDate } from '../data'

interface Props {
  monthData: MonthData
  layers: Layer[]
  selectedDate: string | null
  onSelect: (date: string) => void
  onDoubleClick: (date: string) => void
}

const WEEK_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function DayView({ monthData, layers, selectedDate, onSelect, onDoubleClick }: Props) {
  const day = monthData.days[0]
  if (!day) return <div className="flex-1 flex items-center justify-center text-gray-400">无数据</div>

  const { y, m, d } = parseDate(day.date)
  const dt = new Date(y, m - 1, d)
  const weekday = WEEK_NAMES[dt.getDay() === 0 ? 6 : dt.getDay() - 1]
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
            <p className="text-lg font-semibold">{m}月{d}日</p>
            <p className="text-xs opacity-80">{y}年 {weekday}{day.is_weekend ? ' · 周末' : ''}</p>
          </div>
          {day.holiday?.name && <span className="text-xs bg-purple-500 text-white px-2 py-1 rounded">{day.holiday.name}</span>}
        </div>

        <div className="flex-1 p-4 overflow-y-auto">
          {day.custom_bg && (
            <div className="mb-4 flex items-center gap-1">
              <span className="text-xs text-gray-500 mr-1">标记</span>
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
              <span className="text-xs text-gray-500 mr-1">充实度</span>
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
                  </div>
                ))}
            </div>
          )}
          {visibleEvents.length === 0 ? (
            <p className="text-sm text-gray-400">当天无事件</p>
          ) : (
            <ul className="space-y-2">
              {visibleEvents.map((ev) => {
                const l = layerById.get(ev.layer_id)
                return (
                  <li key={ev.id ?? ev.title} className="flex items-start gap-2">
                    <span className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: ev.color ?? l?.color ?? '#9ca3af' }} />
                    <div>
                      <p className="text-sm font-medium">{ev.title}</p>
                      {l && <p className="text-[11px] text-gray-400">{l.display_name}</p>}
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
