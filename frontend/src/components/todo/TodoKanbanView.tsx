import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { Todo, TodoList } from '../../types'
import { COMPLEXITY_LABELS, IMPORTANCE_LABELS, STATUS_LABELS } from '../../utils/todoLogic'
import { TodoMiniCard } from './TodoMiniCard'

type Dim = 'status' | 'planned' | 'importance' | 'complexity' | 'tag'

const DIMS: { key: Dim; label: string }[] = [
  { key: 'status', label: '按状态' },
  { key: 'planned', label: '按计划日期' },
  { key: 'importance', label: '按重要性' },
  { key: 'complexity', label: '按复杂度' },
  { key: 'tag', label: '按标签' },
]

interface Props {
  todos: Todo[]
  lists: TodoList[]
  selectedTodoId: string | null
  onSelect: (id: string) => void
  onUpdate: (id: string, data: Record<string, unknown>) => void
}

interface Column {
  key: string
  title: string
  tone?: string
  items: Todo[]
}

function buildColumns(todos: Todo[], dim: Dim): Column[] {
  const map = new Map<string, Column>()

  const col = (key: string, title: string, tone?: string): Column => {
    let c = map.get(key)
    if (!c) {
      c = { key, title, tone, items: [] }
      map.set(key, c)
    }
    return c
  }

  for (const t of todos) {
    switch (dim) {
      case 'status':
        col(t.status, STATUS_LABELS[t.status] ?? t.status).items.push(t)
        break
      case 'planned': {
        const key = t.planned_date ?? '__none__'
        col(key, t.planned_date ?? '未计划').items.push(t)
        break
      }
      case 'importance':
        col(t.importance, IMPORTANCE_LABELS[t.importance] ?? t.importance).items.push(t)
        break
      case 'complexity':
        col(t.complexity, COMPLEXITY_LABELS[t.complexity] ?? t.complexity).items.push(t)
        break
      case 'tag': {
        const tags = t.tags ?? []
        if (tags.length === 0) col('__none__', '无标签').items.push(t)
        else for (const tag of tags) col(tag, `#${tag}`).items.push(t)
        break
      }
    }
  }

  const cols = Array.from(map.values())
  if (dim === 'status') {
    const order = ['notStarted', 'inProgress', 'waitingOnOthers', 'deferred', 'completed']
    cols.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  } else if (dim === 'planned') {
    cols.sort((a, b) => {
      if (a.key === '__none__') return 1
      if (b.key === '__none__') return -1
      return a.key.localeCompare(b.key)
    })
  } else if (dim === 'importance') {
    const order = ['high', 'normal', 'low']
    cols.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  } else if (dim === 'complexity') {
    const order = ['hard', 'medium', 'simple']
    cols.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  }
  return cols
}

const COLUMN_TONES: Record<string, string> = {
  notStarted: 'bg-gray-50',
  inProgress: 'bg-blue-50/70',
  waitingOnOthers: 'bg-purple-50/70',
  deferred: 'bg-amber-50/60',
  completed: 'bg-emerald-50/60',
}

export function TodoKanbanView({ todos, lists, selectedTodoId, onSelect, onUpdate }: Props) {
  const [dim, setDim] = useState<Dim>('status')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  const columns = useMemo(() => buildColumns(todos, dim), [todos, dim])
  const listName = useMemo(() => {
    const m = new Map(lists.map((l) => [l.id, l.display_name]))
    return (t: Todo) => m.get(t.list_id)
  }, [lists])

  const droppable = dim === 'status'

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 pb-3 flex-shrink-0">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
          {DIMS.map((d) => (
            <button
              key={d.key}
              onClick={() => setDim(d.key)}
              className={clsx(
                'px-2.5 py-1 text-xs rounded-md transition',
                dim === d.key ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        {droppable && <span className="text-xs text-gray-400">拖动卡片到其他列即可改变状态</span>}
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
        <div className="flex gap-3 h-full min-w-max">
          {columns.map((c) => {
            const tone = droppable ? COLUMN_TONES[c.key] : undefined
            return (
              <div
                key={c.key}
                onDragOver={(e) => {
                  if (!droppable || !dragId) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setOverCol(c.key)
                }}
                onDragLeave={() => overCol === c.key && setOverCol(null)}
                onDrop={() => {
                  if (!droppable || !dragId) return
                  const t = todos.find((x) => x.id === dragId)
                  setDragId(null)
                  setOverCol(null)
                  if (t && t.status !== c.key) onUpdate(dragId, { ...t, id: dragId, status: c.key })
                }}
                className={clsx(
                  'w-60 flex flex-col rounded-xl border min-h-0 transition',
                  tone ?? 'bg-gray-50/60',
                  overCol === c.key ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-200',
                )}
              >
                <div className="px-3 py-2 flex items-center justify-between border-b border-black/5 flex-shrink-0">
                  <span className="text-sm font-medium text-gray-700 truncate">{c.title}</span>
                  <span className="text-xs text-gray-400">{c.items.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 min-h-0">
                  {c.items.map((t) => (
                    <div
                      key={`${t.id}-${c.key}`}
                      draggable={droppable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', t.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setDragId(t.id)
                      }}
                      onDragEnd={() => { setDragId(null); setOverCol(null) }}
                      className={clsx(dragId === t.id && 'opacity-30')}
                    >
                      <TodoMiniCard
                        todo={t}
                        selected={selectedTodoId === t.id}
                        sub={listName(t)}
                        onClick={() => onSelect(t.id)}
                      />
                    </div>
                  ))}
                  {c.items.length === 0 && (
                    <div className="flex-1 flex items-center justify-center text-xs text-gray-300 py-6">空</div>
                  )}
                </div>
              </div>
            )
          })}
          {columns.length === 0 && (
            <div className="text-sm text-gray-300 flex items-center px-8">暂无待办</div>
          )}
        </div>
      </div>
    </div>
  )
}
