import clsx from 'clsx'
import type { Todo } from '../../types'
import { COMPLEXITY_LABELS, IMPORTANCE_LABELS, STATUS_LABELS, dueInDays } from '../../utils/todoLogic'

// 状态点的颜色：看板/矩阵卡片元信息行用小圆点区分状态，比文字 badge 更紧凑
const STATUS_DOT: Record<string, string> = {
  notStarted: 'bg-gray-300',
  inProgress: 'bg-blue-500',
  waitingOnOthers: 'bg-purple-500',
  deferred: 'bg-amber-500',
}

// 重要性染色：high 需要视觉警示（红），normal/low 保持中性避免卡片过花
const IMPORTANCE_CLS: Record<string, string> = {
  high: 'text-red-600 font-medium',
  normal: 'text-gray-500',
  low: 'text-gray-400',
}

// 复杂度染色：困难红/中等琥珀/简单绿，与看板列色调一致
const COMPLEXITY_CLS: Record<string, string> = {
  hard: 'text-red-500',
  medium: 'text-amber-600',
  simple: 'text-emerald-600',
}

function shortDate(d: string): string {
  // 元信息行空间有限，08-18 短格式够用；跨年任务罕见，若遇到保留原串
  return d.length >= 10 ? d.slice(5, 10) : d
}

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
  const tags = todo.tags ?? []

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

        {/* 元信息行：状态/重要性/复杂度/三类日期，条件渲染避免空分隔符堆积 */}
        {!done && (
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] leading-none text-gray-500">
            <span className="flex items-center gap-0.5">
              <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT[todo.status] ?? 'bg-gray-300')} />
              {STATUS_LABELS[todo.status] ?? todo.status}
            </span>
            <span className={clsx(IMPORTANCE_CLS[todo.importance] ?? '')}>
              {IMPORTANCE_LABELS[todo.importance] ?? todo.importance}
            </span>
            <span className={clsx(COMPLEXITY_CLS[todo.complexity] ?? '')}>
              {COMPLEXITY_LABELS[todo.complexity] ?? todo.complexity}
            </span>
            {todo.due_date && (
              <span className={clsx(overdue && 'text-red-600 font-medium')}>
                截止 {shortDate(todo.due_date)}
              </span>
            )}
            {todo.planned_date && <span>计划 {shortDate(todo.planned_date)}</span>}
            {todo.start_date && <span>开始 {shortDate(todo.start_date)}</span>}
          </div>
        )}

        {tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 leading-none">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* 备注预览：单行截断，完整内容在详情面板看 */}
        {todo.body && (
          <div className="mt-1 text-[10px] text-gray-400 leading-snug truncate">{todo.body}</div>
        )}

        {sub && <div className="mt-1 text-[11px] text-gray-400">{sub}</div>}
      </button>
    </div>
  )
}
