import { Fragment, memo, useMemo } from 'react'
import clsx from 'clsx'
import type { Day, Layer } from '../types'
import { COLORING_COLORS, parseDate, pickContrastColor } from '../data'

interface Props {
  day: Day
  layers: Layer[]
  selected: boolean
  dragOver: boolean
  onClick: (date: string) => void
  onDoubleClick: (date: string) => void
  onContextMenu: (e: { clientX: number; clientY: number }, date: string) => void
  onDragStart: (date: string) => void
  onDragEnter: (date: string) => void
  onDrop: (date: string) => void
  maxLabels?: number
}

export const DayCell = memo(function DayCell({ day, layers, selected, dragOver, onClick, onDoubleClick, onContextMenu, onDragStart, onDragEnter, onDrop, maxLabels = 3 }: Props) {
  const { d } = parseDate(day.date)

  const visibleEvents = useMemo(() => {
    // important/schedule 图层的事件始终显示（开关只控染色）；其他图层按开关过滤
    const enabledSet = new Set(layers.filter((l) => l.enabled).map((l) => l.layer_id))
    return Object.entries(day.events_by_layer)
      .filter(([lid]) => lid === 'important' || lid === 'schedule' || enabledSet.has(lid))
      .flatMap(([, evs]) => evs)
      .sort((a, b) => a.sort_key - b.sort_key)
  }, [day, layers])

  const dots = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const lid of Object.keys(day.events_by_layer)) {
      const layer = layers.find((l) => l.layer_id === lid)
      if (!layer?.enabled && lid !== 'important' && lid !== 'schedule') continue
      const c = layer?.color ?? '#9ca3af'
      if (!seen.has(c) && visibleEvents.some((e) => e.layer_id === lid)) {
        seen.add(c)
        out.push(c)
      }
    }
    // 日程类型图层：按 category 显示色点（点点图层，不涂色）
    const items = day.schedule_items ?? []
    if (items.length > 0) {
      const catSet = new Set(items.map((i) => i.category ?? 'work'))
      for (const lid of Object.keys(layers)) {
        if (!lid.startsWith('schedule_')) continue
        const layer = layers.find((l) => l.layer_id === lid)
        if (!layer?.enabled) continue
        const cat = (layer.config as Record<string, unknown>)?.category as string | undefined
        if (cat && catSet.has(cat) && layer.color && !seen.has(layer.color)) {
          seen.add(layer.color)
          out.push(layer.color)
        }
      }
    }
    return out.slice(0, 5)
  }, [day, layers, visibleEvents])

  const layerById = new Map(layers.map((l) => [l.layer_id, l]))
  const colorLayers: { id: string; color: string }[] = []
  if (layerById.get('important')?.enabled && day.gradient_bg && day.gradient_bg.toLowerCase() !== '#ffffff') {
    colorLayers.push({ id: 'important', color: day.gradient_bg })
  }
  if (layerById.get('coloring')?.enabled && day.coloring_level != null) {
    colorLayers.push({ id: 'coloring', color: COLORING_COLORS[day.coloring_level] })
  }
  if (layerById.get('holiday')?.enabled && day.holiday?.name) {
    colorLayers.push({ id: 'holiday', color: layerById.get('holiday')!.color ?? '#8E24AA' })
  }
  const activeTodos = day.todos?.filter((t) => t.status !== 'completed') ?? []
  if (layerById.get('todo')?.enabled && activeTodos.length > 0) {
    colorLayers.push({ id: 'todo', color: layerById.get('todo')!.color ?? '#F59E0B' })
  }
  if (day.custom_bg && day.custom_bg.color) {
    colorLayers.push({ id: 'custom', color: day.custom_bg.color })
  }

  const scheduleItems = day.schedule_items ?? []

  return (
    <div
      onClick={() => onClick(day.date)}
      onDoubleClick={() => onDoubleClick(day.date)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu({ clientX: e.clientX, clientY: e.clientY }, day.date)
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', day.date)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(day.date)
      }}
      onDragEnter={() => onDragEnter(day.date)}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop(day.date)
      }}
      className={clsx(
        'relative p-1.5 rounded-lg border cursor-pointer transition-all flex flex-col gap-0.5 overflow-hidden',
        maxLabels >= 6 ? 'min-h-[160px]' : 'min-h-[104px]',
        'hover:shadow-md hover:-translate-y-0.5',
        day.is_today
          ? 'border-2 border-blue-500'
          : 'border-gray-200',
        day.is_other_month && 'opacity-40',
        selected && 'ring-2 ring-blue-300',
        dragOver && 'ring-2 ring-green-400 scale-[1.02]',
      )}
    >
      {colorLayers.length === 1 && (
        <div className="absolute inset-0" style={{ backgroundColor: colorLayers[0].color }} />
      )}
      {colorLayers.length >= 2 && (
        <div className="absolute inset-0 flex flex-col">
          {colorLayers.map((c, i) => (
            <Fragment key={c.id}>
              <div className="flex-1" style={{ backgroundColor: c.color }} />
              {i < colorLayers.length - 1 && <div className="h-[2px] bg-white flex-shrink-0" />}
            </Fragment>
          ))}
        </div>
      )}

      <div className="relative z-10 flex flex-col gap-0.5 flex-1 min-h-0">
      {/* 头部：日期 + 角标 */}
      <div className="flex items-center justify-between">
        <span
          className={clsx(
            'text-sm font-semibold',
            day.is_today && 'bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs',
          )}
          style={day.is_today ? undefined : (() => {
            const last = colorLayers[colorLayers.length - 1]
            if (!last) return undefined
            return { color: pickContrastColor(last.color) }
          })()}
        >
          {d}
        </span>
        {day.holiday?.is_workday_made_up && (
          <span className="text-[9px] bg-amber-500 text-white px-1 rounded leading-tight">班</span>
        )}
        {day.holiday?.name && (
          <span className="text-[9px] bg-purple-500 text-white px-1 rounded leading-tight truncate max-w-[40px]">
            {day.holiday.name}
          </span>
        )}
      </div>

      {/* 色点 */}
      {dots.length > 0 && (
        <div className="flex gap-0.5">
          {dots.map((c, i) => (
            <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
          ))}
        </div>
      )}

      {/* 事件标签 */}
      {(() => {
        const last = colorLayers[colorLayers.length - 1]
        const labelColor = last ? pickContrastColor(last.color) : '#6b7280'
        return (
          <div className="flex flex-col gap-px overflow-hidden">
            {visibleEvents.slice(0, maxLabels).map((ev, i) => (
              <span
                key={ev.id ?? i}
                className="text-[10px] truncate leading-tight"
                style={{ color: last ? labelColor : '#6b7280' }}
                title={ev.title}
              >
                {ev.title}
              </span>
            ))}
            {visibleEvents.length > maxLabels && (
              <span className="text-[10px]" style={{ color: last ? labelColor : '#9ca3af' }}>+{visibleEvents.length - maxLabels}</span>
            )}
          </div>
        )
      })()}

      {/* 日程摘要（首条时段 + 剩余计数） */}
      {scheduleItems.length > 0 && (
        <div className="flex flex-col gap-px overflow-hidden">
          {(() => {
            const last = colorLayers[colorLayers.length - 1]
            const labelColor = last ? pickContrastColor(last.color) : '#3D6BFB'
            const sorted = [...scheduleItems].sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
            const first = sorted[0]!
            return (
              <>
                <span className="text-[10px] truncate leading-tight font-medium" style={{ color: labelColor }} title={first.title}>
                  {first.start_time ? `${first.start_time} ${first.title}` : first.title}
                </span>
                {sorted.length > 1 && (
                  <span className="text-[10px]" style={{ color: labelColor }}>+{sorted.length - 1} 项日程</span>
                )}
              </>
            )
          })()}
        </div>
      )}
      </div>
    </div>
  )
})