import clsx from 'clsx'
import type { Todo } from '../../types'
import { dueInDays } from '../../utils/todoLogic'

export function TodoMiniCard({ todo, selected, sub, onClick }: {
  todo: Todo
  selected: boolean
  sub?: string
  onClick: () => void
}) {
  const done = todo.status === 'completed'
  const din = dueInDays(todo)
  const overdue = !done && din !== null && din < 0
  const dueToday = !done && din === 0

  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left px-2.5 py-2 rounded-lg border bg-white transition select-none',
        selected
          ? 'border-blue-400 ring-1 ring-blue-300 shadow-sm'
          : 'border-gray-200 hover:border-gray-300 hover:shadow-sm',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span className={clsx('text-sm leading-snug break-all', todo.status === 'completed' && 'line-through text-gray-400')}>
          {todo.title}
        </span>
        <span className="flex flex-col items-end gap-0.5 flex-shrink-0">
          {overdue && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium whitespace-nowrap">
              逾期 {-(din ?? 0)} 天
            </span>
          )}
          {dueToday && !overdue && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 font-medium whitespace-nowrap">今天</span>
          )}
        </span>
      </div>
      {sub && <div className="mt-1 text-[11px] text-gray-400">{sub}</div>}
    </button>
  )
}
