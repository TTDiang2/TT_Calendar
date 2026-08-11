import { useState } from 'react'
import type { Day, Layer, MonthData } from '../types'
import { DayCell } from './DayCell'

interface Props {
  monthData: MonthData
  layers: Layer[]
  selectedDate: string | null
  onSelect: (date: string) => void
  onDoubleClick: (date: string) => void
  onContextMenu: (e: { clientX: number; clientY: number }, date: string) => void
  onDragStart: (date: string) => void
  onDrop: (date: string) => void
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function MonthGrid({ monthData, layers, selectedDate, onSelect, onDoubleClick, onContextMenu, onDragStart, onDrop }: Props) {
  const [dragOver, setDragOver] = useState<string | null>(null)
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`text-center text-xs font-medium py-1 ${i >= 5 ? 'text-red-400' : 'text-gray-400'}`}
          >
            {w}
          </div>
        ))}
      </div>
      <div
        className="grid grid-cols-7 gap-1 flex-1 overflow-hidden"
        onDragEnd={() => setDragOver(null)}
      >
        {monthData.days.map((day: Day, i) => (
          <DayCell
            key={i}
            day={day}
            layers={layers}
            selected={selectedDate === day.date}
            dragOver={dragOver === day.date}
            onClick={onSelect}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            onDragStart={(d) => {
              onDragStart(d)
              setDragOver(d)
            }}
            onDragEnter={(d) => setDragOver(d)}
            onDrop={(d) => {
              setDragOver(null)
              onDrop(d)
            }}
          />
        ))}
      </div>
    </div>
  )
}
