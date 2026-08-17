import { useMemo } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CalendarClock, Coffee, Trash2 } from 'lucide-react'
import type { Todo, TodoList } from '../../types'
import { dueInDays, isImportant, urgencyOf } from '../../utils/todoLogic'
import { TodoMiniCard } from './TodoMiniCard'

interface Props {
  todos: Todo[]
  lists: TodoList[]
  selectedTodoId: string | null
  onSelect: (id: string) => void
  onToggle: (todo: Todo, done: boolean) => void
}

const QUADRANTS = [
  {
    key: 'iu' as const,
    title: '重要 × 紧急',
    action: '立即做',
    icon: AlertTriangle,
    tone: 'border-red-200 bg-red-50/60',
    head: 'text-red-700',
    desc: '今天必须推进的事',
  },
  {
    key: 'in' as const,
    title: '重要 × 不紧急',
    action: '规划做',
    icon: CalendarClock,
    tone: 'border-blue-200 bg-blue-50/60',
    head: 'text-blue-700',
    desc: '矩阵的核心价值区：别让它变成紧急',
  },
  {
    key: 'nu' as const,
    title: '不重要 × 紧急',
    action: '快速清',
    icon: Coffee,
    tone: 'border-amber-200 bg-amber-50/60',
    head: 'text-amber-700',
    desc: '碎片打断：批量快速处理',
  },
  {
    key: 'nn' as const,
    title: '不重要 × 不紧急',
    action: '考虑丢',
    icon: Trash2,
    tone: 'border-gray-200 bg-gray-50/60',
    head: 'text-gray-600',
    desc: '真的值得做吗？',
  },
]

function subText(t: Todo, lists: TodoList[]): string {
  const parts: string[] = []
  const listName = lists.find((l) => l.id === t.list_id)?.display_name
  if (listName) parts.push(listName)
  const din = dueInDays(t)
  if (t.due_date && din !== null) {
    parts.push(din < 0 ? `截止已过 ${-din} 天` : din === 0 ? '今天截止' : `${din} 天后截止`)
  } else if (t.planned_date) {
    parts.push(`计划 ${t.planned_date}`)
  }
  if ((t.tags ?? []).length) parts.push(t.tags!.map((x) => `#${x}`).join(' '))
  return parts.join(' · ')
}

export function TodoMatrixView({ todos, lists, selectedTodoId, onSelect, onToggle }: Props) {
  const active = useMemo(() => todos.filter((t) => t.status !== 'completed'), [todos])

  const buckets = useMemo(() => {
    const b: Record<string, Todo[]> = { iu: [], in: [], nu: [], nn: [] }
    for (const t of active) {
      const imp = isImportant(t)
      const urg = urgencyOf(t) === 'urgent'
      b[imp ? (urg ? 'iu' : 'in') : urg ? 'nu' : 'nn'].push(t)
    }
    for (const k of Object.keys(b)) {
      b[k].sort((a, z) => (dueInDays(a) ?? 999) - (dueInDays(z) ?? 999))
    }
    return b
  }, [active])

  return (
    <div className="h-full grid grid-cols-2 grid-rows-2 gap-3 pb-4">
      {QUADRANTS.map((q) => {
        const items = buckets[q.key]
        const Icon = q.icon
        const soonCount = items.filter((t) => urgencyOf(t) === 'soon').length
        return (
          <div key={q.key} className={clsx('rounded-xl border flex flex-col overflow-hidden min-h-0', q.tone)}>
            <div className="px-3 py-2 flex items-center justify-between border-b border-black/5 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <Icon size={14} className={q.head} />
                <span className={clsx('text-sm font-semibold', q.head)}>{q.title}</span>
                <span className="text-xs text-gray-400">{q.action}</span>
              </div>
              <div className="flex items-center gap-2">
                {soonCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700" title="3-7 天内到期">
                    {soonCount} 临近
                  </span>
                )}
                <span className="text-xs font-medium text-gray-500">{items.length}</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 min-h-0">
              {items.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-gray-300">{q.desc}</div>
              ) : (
                items.map((t) => (
                  <TodoMiniCard
                    key={t.id}
                    todo={t}
                    selected={selectedTodoId === t.id}
                    sub={subText(t, lists)}
                    onClick={() => onSelect(t.id)}
                    onToggle={(done) => onToggle(t, done)}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
