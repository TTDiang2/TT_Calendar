import { useState } from 'react'
import type { Day, Layer, MonthData } from '../types'
import { fmtWeekday, useLang } from '../i18n'
import type { CalendarColorStyle } from '../lib/calendar-style'
import { WeekDayColumn } from './WeekDayColumn'

interface Props {
  monthData: MonthData
  layers: Layer[]
  selectedDate: string | null
  colorStyle: CalendarColorStyle
  onSelect: (date: string) => void
  onDoubleClick: (date: string) => void
  onContextMenu: (e: { clientX: number; clientY: number }, date: string) => void
  onDragStart: (date: string) => void
  onDrop: (date: string) => void
}

/**
 * 周视图 = 7 张计划卡。
 *
 * 旧版直接复用月格的 DayCell，整格铺忙度色，7 天变成 7 根超长色柱，
 * 事件挤在顶部 10px 小字里。改成独立列以后：
 *  - 底色只留顶部 3px 色条（强度仍可一眼扫过）
 *  - 列头是日期本身，正文让给「几点、什么事」
 *  - 窄窗口横向滚动，而不是把 7 列压成 60px
 */
export function WeekView({ monthData, layers, selectedDate, colorStyle, onSelect, onDoubleClick, onContextMenu, onDragStart, onDrop }: Props) {
  const [dragOver, setDragOver] = useState<string | null>(null)
  const lang = useLang()

  const days = monthData.days.slice(0, 7)
  // 跨月周：只要这一天不是「本周多数月份」，就在列头补一个小月份标签
  const weekMonth = days[0] ? Number(days[0].date.slice(5, 7)) : 0

  return (
    <div
      className="flex-1 flex gap-2 min-h-0 overflow-x-auto pb-1"
      onDragEnd={() => setDragOver(null)}
    >
      {days.map((day: Day) => {
        const [y, m, d] = day.date.split('-').map(Number)
        return (
          <WeekDayColumn
            key={day.date}
            day={day}
            weekday={fmtWeekday(lang, new Date(y, m - 1, d), 'short')}
            showMonth={m !== weekMonth}
            layers={layers}
            selected={selectedDate === day.date}
            dragOver={dragOver === day.date}
            colorStyle={colorStyle}
            onClick={onSelect}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            onDragStart={(dt) => { onDragStart(dt); setDragOver(dt) }}
            onDragEnter={(dt) => setDragOver(dt)}
            onDrop={(dt) => { setDragOver(null); onDrop(dt) }}
          />
        )
      })}
    </div>
  )
}
