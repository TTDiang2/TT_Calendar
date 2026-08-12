import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import type { Day, Layer, YearData } from '../types'
import { COLORING_COLORS, getBusyColors, parseDate, todayStr } from '../data'
import { getTodoBusyConfig, type TodoBusyConfig } from '../api/client'

interface Props {
  yearData: YearData
  layers: Layer[]
  selectedDate: string | null
  onSelectDate: (date: string) => void
}

// 迷你格太小无法分层，按优先级取第一个启用的染色维度颜色
function miniCellColor(day: Day, layerById: Map<string, Layer>, busyConfig?: TodoBusyConfig): string | null {
  const coloringL = layerById.get('coloring')
  if (coloringL?.enabled && day.coloring_level != null) return COLORING_COLORS[day.coloring_level]
  const importantL = layerById.get('important')
  if (importantL?.enabled && day.gradient_bg && day.gradient_bg.toLowerCase() !== '#ffffff') return day.gradient_bg
  const scheduleL = layerById.get('schedule')
  if (scheduleL?.enabled && (day.schedule_items?.length ?? 0) > 0) {
    return scheduleL.color ?? '#3D6BFB'
  }
  const holidayL = layerById.get('holiday')
  if (holidayL?.enabled && day.holiday?.name) return holidayL.color ?? '#8E24AA'
  for (const b of getBusyColors(day, todayStr(), busyConfig)) {
    if (layerById.get(b.id)?.enabled) return b.color
  }
  if (day.custom_bg?.color) return day.custom_bg.color
  return null
}

export function YearView({ yearData, layers, selectedDate, onSelectDate }: Props) {
  const layerById = useMemo(() => new Map(layers.map((l) => [l.layer_id, l])), [layers])
  const { data: busyConfig } = useQuery({ queryKey: ['todoBusyConfig'], queryFn: getTodoBusyConfig, staleTime: 60_000 })

  const byMonth = useMemo(() => {
    const map = new Map<number, Day[]>()
    for (const m of yearData.months) map.set(m.month, m.days)
    return map
  }, [yearData])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const days = byMonth.get(m) ?? []
          return (
            <div key={m} className="bg-white rounded-lg border border-gray-200 p-2">
              <p className="text-xs font-semibold text-gray-600 mb-1">{m}月</p>
              <div className="grid grid-cols-7 gap-px">
                {['一', '二', '三', '四', '五', '六', '日'].map((w, wi) => (
                  <span
                    key={w}
                    className={clsx(
                      'text-[8px] text-center',
                      wi >= 5 ? 'text-red-400' : 'text-gray-400',
                    )}
                  >
                    {w}
                  </span>
                ))}
                {days.map((day) => {
                  const { d } = parseDate(day.date)
                  const color = miniCellColor(day, layerById)
                  const isSel = selectedDate === day.date
                  return (
                    <button
                      key={day.date}
                      onClick={() => onSelectDate(day.date)}
                      style={color ? { backgroundColor: color } : undefined}
                      className={clsx(
                        'aspect-square w-full text-[8px] leading-none rounded-[2px]',
                        day.is_other_month ? 'opacity-30' : 'text-gray-600',
                        day.is_today && 'ring-1 ring-blue-500',
                        isSel && 'ring-1 ring-blue-300',
                      )}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
