import clsx from 'clsx'
import type { Todo } from '../../types'
import { dueInDays } from '../../utils/todoLogic'

export function TodoMiniCard({ todo, selected, sub, onClick, onToggle }: {
  todo: Todo
  selected: boolean
  sub?: string
  onClick: () => void
  onToggle?: (done: boolean) => void
}) {
  const done = todo.status === 'completed'
  const din = dueInDays(todo)
  const overdue = !done && din !== null && din < 0
  const dueToday = !done && din === 0

  return (
    <div
      className={clsx(
        'group flex items-start gap-2 px-2.5 py-2 rounded-lg border bg-white transition select-none',
        selected
          ? 'border-blue-400 ring-1 ring-blue-300 shadow-sm'
          : 'border-gray-200 hover:border-gray-300 hover:shadow-sm',
      )}
    >
      {onToggle && (
        <button
          aria-label={done ? '标记为未完成' : '标记为已完成'}
          onClick={(e) => { e.stopPropagation(); onToggle(!done) }}
          className={clsx(
            'mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center cursor-pointer transition-colors duration-200',
            done
              ? 'bg-emerald-500 border-emerald-500 text-white'
              : 'border-gray-300 text-transparent hover:border-emerald-400 hover:text-emerald-300',
          )}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="w-2.5 h-2.5">
            <path d="M4 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <button onClick={onClick} className="flex-1 text-left min-w-0 cursor-pointer">
        <div className="flex items-start justify-between gap-1">
          <span className={clsx('text-sm leading-snug break-all', done && 'line-through text-gray-400')}>
            {todo.title}
          </span>
          <span className="flex flex-col items-end gap-0.5 flex-shrink-0">
            {overdue && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium whitespace-nowrap">
                逾期 {-(din ?? 0)} 天
              </span>
            )}
            {dueToday && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 font-medium whitespace-nowrap">今天</span>
            )}
          </span>
        </div>
        {sub && <div className="mt-1 text-[11px] text-gray-400">{sub}</div>}
      </button>
    </div>
  )
}
