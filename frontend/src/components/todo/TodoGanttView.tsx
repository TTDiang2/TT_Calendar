import { useMemo } from 'react'
import clsx from 'clsx'
import { CheckCircle2 } from 'lucide-react'
import type { Todo, TodoList } from '../../types'
import { ganttRange, STATUS_LABELS } from '../../utils/todoLogic'

interface Props {
  todos: Todo[]
  lists: TodoList[]
  selectedTodoId: string | null
  onSelect: (id: string) => void
}

const DAY = 86400000
const LABEL_W = 210
const ROW_H = 34
const BAR_H = 18
const HEAD_H = 40

function dayIndex(d: string): number {
  return Math.floor(new Date(d + 'T00:00:00').getTime() / DAY)
}

const BAR_STYLE: Record<string, string> = {
  completed: 'bg-emerald-400 border-emerald-500',
  inProgress: 'bg-blue-400 border-blue-500',
  notStarted: 'bg-gray-300 border-gray-400',
  waitingOnOthers: 'bg-purple-300 border-purple-400',
  deferred: 'bg-amber-300 border-amber-400',
}

export function TodoGanttView({ todos, lists, selectedTodoId, onSelect }: Props) {
  const today = new Date().toISOString().slice(0, 10)

  const rows = useMemo(() => {
    return todos
      .map((t) => ({ t, r: ganttRange(t, today) }))
      .sort((a, b) => dayIndex(a.r.start) - dayIndex(b.r.start) || a.t.title.localeCompare(b.t.title, 'zh'))
  }, [todos, today])

  const geo = useMemo(() => {
    if (rows.length === 0) {
      return { t0: dayIndex(today), totalDays: 1, dayW: 24, months: [] as { start: number; label: string }[], weekendCols: [] as number[] }
    }
    const starts = rows.map((x) => dayIndex(x.r.start))
    const ends = rows.map((x) => dayIndex(x.r.end))
    const min = Math.min(...starts)
    const max = Math.max(...ends, dayIndex(today)) + 2
    const span = max - min
    const w = span <= 35 ? 24 : span <= 90 ? 12 : span <= 200 ? 6 : 3
    const months: { start: number; label: string }[] = []
    const weekendCols: number[] = []
    for (let i = 0; i <= span; i += 1) {
      const d = new Date((min + i) * DAY)
      if (d.getDate() === 1 || i === 0) months.push({ start: i, label: `${d.getMonth() + 1} 月` })
      if (d.getDay() === 0 || d.getDay() === 6) weekendCols.push(i)
    }
    return { t0: min, totalDays: span + 1, dayW: w, months, weekendCols }
  }, [rows, today])

  const laneW = geo.totalDays * geo.dayW
  const todayX = (dayIndex(today) - geo.t0) * geo.dayW

  const listName = useMemo(() => {
    const m = new Map(lists.map((l) => [l.id, l.display_name]))
    return (id: string) => m.get(id)
  }, [lists])

  if (rows.length === 0) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-300">暂无待办</div>
  }

  const showDayNums = geo.dayW >= 12

  return (
    <div className="h-full overflow-auto pb-4">
      <div className="relative min-w-max" style={{ width: LABEL_W + laneW }}>
        <div className="sticky top-0 z-20 bg-white border-b border-gray-200 flex" style={{ height: HEAD_H }}>
          <div className="sticky left-0 z-30 bg-white border-r border-gray-100 flex-shrink-0" style={{ width: LABEL_W }} />
          <div className="relative flex-shrink-0" style={{ width: laneW }}>
            {geo.months.map((m) => (
              <div
                key={m.start}
                className="absolute top-0 h-1/2 flex items-center text-[11px] text-gray-500 font-medium border-l border-gray-300 pl-1"
                style={{ left: m.start * geo.dayW }}
              >
                {m.label}
              </div>
            ))}
            {showDayNums && Array.from({ length: geo.totalDays }, (_, i) => {
              const d = new Date((geo.t0 + i) * DAY)
              const weekend = d.getDay() === 0 || d.getDay() === 6
              return (
                <div
                  key={i}
                  className={clsx('absolute bottom-0 h-1/2 flex items-start justify-center text-[9px]', weekend ? 'text-gray-300' : 'text-gray-400')}
                  style={{ left: i * geo.dayW, width: geo.dayW }}
                >
                  {d.getDate()}
                </div>
              )
            })}
          </div>
        </div>

        <div className="relative">
          {geo.weekendCols.map((i) => (
            <div
              key={`wk-${i}`}
              className="absolute top-0 bg-gray-50/80 pointer-events-none"
              style={{ left: LABEL_W + i * geo.dayW, width: geo.dayW, height: rows.length * ROW_H + HEAD_H }}
            />
          ))}
          <div
            className="absolute border-l-2 border-dashed border-red-400 z-10 pointer-events-none"
            style={{ left: LABEL_W + todayX, top: 0, height: rows.length * ROW_H }}
          />

          {rows.map(({ t, r }) => {
            const x = (dayIndex(r.start) - geo.t0) * geo.dayW
            const w = Math.max((dayIndex(r.end) - dayIndex(r.start) + 1) * geo.dayW - 2, geo.dayW - 2)
            const selected = selectedTodoId === t.id
            const ln = listName(t.list_id)
            return (
              <div
                key={t.id}
                className={clsx('flex border-b border-gray-50 hover:bg-blue-50/30 cursor-pointer relative z-[5]', selected && 'bg-blue-50/60')}
                onClick={() => onSelect(t.id)}
                style={{ height: ROW_H }}
              >
                <div
                  className={clsx(
                    'sticky left-0 z-10 flex-shrink-0 px-2 flex items-center gap-1.5 border-r border-gray-100',
                    selected ? 'bg-blue-50' : 'bg-white',
                  )}
                  style={{ width: LABEL_W }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {r.completed && <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />}
                  <span className={clsx('text-xs truncate', r.completed ? 'text-gray-400 line-through' : 'text-gray-700')}>
                    {t.title}
                  </span>
                  {ln && <span className="text-[10px] text-gray-300 flex-shrink-0 ml-auto">{ln}</span>}
                </div>
                <div className="relative flex-shrink-0" style={{ width: laneW }}>
                  <div
                    className={clsx(
                      'absolute rounded-md border text-[9px] text-white flex items-center px-1.5 overflow-hidden whitespace-nowrap',
                      r.overdue ? 'bg-red-400 border-red-500' : BAR_STYLE[t.status] ?? BAR_STYLE.notStarted,
                      selected && 'ring-2 ring-blue-400',
                    )}
                    style={{ left: x, width: w, top: (ROW_H - BAR_H) / 2, height: BAR_H }}
                    title={`${r.start} → ${r.end}${r.overdue ? '（已过期）' : ''} · ${STATUS_LABELS[t.status] ?? t.status}`}
                  >
                    {r.overdue && <span className="font-medium">逾期中</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
