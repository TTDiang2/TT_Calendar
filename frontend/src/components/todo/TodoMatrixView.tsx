import { useMemo } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CalendarClock, Coffee, Hourglass } from 'lucide-react'
import type { Todo, TodoList } from '../../types'
import { dueInDays, isImportant, urgencyOf } from '../../utils/todoLogic'
import { useI18n, type I18n, type TxKey } from '../../i18n'
import { layerLabel } from '../../i18n/adapt/layerLabel'
import { TodoMiniCard } from './TodoMiniCard'

interface Props {
  todos: Todo[]
  lists: TodoList[]
  selectedTodoId: string | null
  onSelect: (id: string) => void
  onToggle: (todo: Todo, done: boolean) => void
}

/** 四象限（labelKey 模式：模块常量不存文案，key 命名沿 Neo quadrant.*，zh 逐字一致） */
const QUADRANTS: {
  key: 'iu' | 'in' | 'nu' | 'nn'
  labels: { title: TxKey; action: TxKey; desc: TxKey }
  icon: typeof AlertTriangle
  tone: string
  head: string
}[] = [
  {
    key: 'iu',
    labels: { title: 'todoboards.matrix.quadrant.doNow.title', action: 'todoboards.matrix.quadrant.doNow.action', desc: 'todoboards.matrix.quadrant.doNow.desc' },
    icon: AlertTriangle,
    tone: 'border-red-200 bg-red-50/60',
    head: 'text-red-700',
  },
  {
    key: 'in',
    labels: { title: 'todoboards.matrix.quadrant.planIt.title', action: 'todoboards.matrix.quadrant.planIt.action', desc: 'todoboards.matrix.quadrant.planIt.desc' },
    icon: CalendarClock,
    tone: 'border-blue-200 bg-blue-50/60',
    head: 'text-blue-700',
  },
  {
    key: 'nu',
    labels: { title: 'todoboards.matrix.quadrant.delegate.title', action: 'todoboards.matrix.quadrant.delegate.action', desc: 'todoboards.matrix.quadrant.delegate.desc' },
    icon: Coffee,
    tone: 'border-amber-200 bg-amber-50/60',
    head: 'text-amber-700',
  },
  {
    key: 'nn',
    labels: { title: 'todoboards.matrix.quadrant.drop.title', action: 'todoboards.matrix.quadrant.drop.action', desc: 'todoboards.matrix.quadrant.drop.desc' },
    icon: Hourglass,
    tone: 'border-gray-200 bg-gray-50/60',
    head: 'text-gray-600',
  },
]

function subText(t: Todo, lists: TodoList[], ia: I18n): string {
  const parts: string[] = []
  const l0 = lists.find((l) => l.id === t.list_id)
  const listName = l0 ? layerLabel(l0, ia.t) : undefined
  if (listName) parts.push(listName)
  const din = dueInDays(t)
  if (t.due_date && din !== null) {
    parts.push(din < 0 ? ia.tPlural('todoboards.matrix.sub.overdueBy', -din) : din === 0 ? ia.t('todoboards.matrix.sub.dueToday') : ia.tPlural('todoboards.matrix.sub.dueIn', din))
  } else if (t.planned_date) {
    parts.push(ia.t('todoboards.matrix.sub.planned', { date: t.planned_date }))
  }
  if ((t.tags ?? []).length) parts.push(t.tags!.map((x) => `#${x}`).join(' '))
  return parts.join(' · ')
}

export function TodoMatrixView({ todos, lists, selectedTodoId, onSelect, onToggle }: Props) {
  const ia = useI18n()
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
                <span className={clsx('text-sm font-semibold', q.head)}>{ia.t(q.labels.title)}</span>
                <span className="text-xs text-gray-400">{ia.t(q.labels.action)}</span>
              </div>
              <div className="flex items-center gap-2">
                {soonCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700" title={ia.t('todoboards.matrix.soonTitle')}>
                    {ia.tPlural('todoboards.matrix.nearing', soonCount)}
                  </span>
                )}
                <span className="text-xs font-medium text-gray-500">{items.length}</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 min-h-0">
              {items.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-gray-300">{ia.t(q.labels.desc)}</div>
              ) : (
                items.map((t) => (
                  <TodoMiniCard
                    key={t.id}
                    todo={t}
                    selected={selectedTodoId === t.id}
                    sub={subText(t, lists, ia)}
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
