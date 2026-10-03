import { useState } from 'react'
import type { Day, Layer, MonthData } from '../types'
import { useLang, fmtWeekday } from '../i18n'
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

// 周表头：以 2023-01-02（周一）为锚点，列 i 依次为周一…周日（决策 #7：星期名走 Intl，
// zh 输出「周一…周日」与旧手写数组逐字一致，en 为 Mon…Sun）

export function MonthGrid({ monthData, layers, selectedDate, onSelect, onDoubleClick, onContextMenu, onDragStart, onDrop }: Props) {
  const [dragOver, setDragOver] = useState<string | null>(null)
  const lang = useLang()
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="grid grid-cols-7 gap-1 mb-1">
        {Array.from({ length: 7 }, (_, i) => fmtWeekday(lang, new Date(2023, 0, 2 + i), 'short')).map((w, i) => (
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
