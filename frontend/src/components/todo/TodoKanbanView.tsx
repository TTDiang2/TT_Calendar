import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Todo, TodoList } from '../../types'
import { COMPLEXITY_LABELS, IMPORTANCE_LABELS, STATUS_LABELS, todayStr } from '../../utils/todoLogic'
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
  openTodos: Todo[]
  completedTodos: Todo[]
  completedCount: number
  lists: TodoList[]
  selectedTodoId: string | null
  onSelect: (id: string) => void
  onToggle: (todo: Todo, done: boolean) => void
  onUpdate: (id: string, data: Record<string, unknown>) => void
}

interface Column {
  key: string
  title: string
  tone?: string
  headCls?: string
  items: Todo[]
}

const IMPORTANCE_TONE: Record<string, string> = {
  high: 'bg-red-50/70',
  normal: 'bg-amber-50/70',
  low: 'bg-emerald-50/70',
}

const COMPLEXITY_TONE: Record<string, string> = {
  hard: 'bg-red-50/70',
  medium: 'bg-amber-50/70',
  simple: 'bg-emerald-50/70',
}

const STATUS_TONE: Record<string, string> = {
  notStarted: 'bg-gray-50',
  inProgress: 'bg-blue-50/70',
  waitingOnOthers: 'bg-purple-50/70',
  deferred: 'bg-amber-50/60',
}

// 计划日期色阶：同一蓝色系，今天最深、越远越浅——一扫就知道近期压力在哪
function plannedTone(key: string, today: string): { tone: string; headCls: string } {
  if (key === '__none__') return { tone: 'bg-gray-50', headCls: 'text-gray-500' }
  const days = Math.round((new Date(key).getTime() - new Date(today).getTime()) / 86400000)
  if (days <= 0) return { tone: 'bg-blue-200/60', headCls: 'text-blue-800' }
  if (days <= 2) return { tone: 'bg-blue-100/80', headCls: 'text-blue-700' }
  if (days <= 7) return { tone: 'bg-blue-50', headCls: 'text-blue-600' }
  return { tone: 'bg-blue-50/50', headCls: 'text-blue-400' }
}

// 标签固定配色：hash 到 10 色柔和调色板，同一标签永远同色（跨列/跨次渲染稳定）
const TAG_PALETTE: { bg: string; head: string }[] = [
  { bg: 'bg-rose-50/80', head: 'text-rose-700' },
  { bg: 'bg-orange-50/80', head: 'text-orange-700' },
  { bg: 'bg-amber-50/80', head: 'text-amber-700' },
  { bg: 'bg-lime-50/80', head: 'text-lime-700' },
  { bg: 'bg-emerald-50/80', head: 'text-emerald-700' },
  { bg: 'bg-teal-50/80', head: 'text-teal-700' },
  { bg: 'bg-sky-50/80', head: 'text-sky-700' },
  { bg: 'bg-indigo-50/80', head: 'text-indigo-700' },
  { bg: 'bg-violet-50/80', head: 'text-violet-700' },
  { bg: 'bg-fuchsia-50/80', head: 'text-fuchsia-700' },
]

function tagHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function buildColumns(openTodos: Todo[], dim: Dim, today: string): Column[] {
  const map = new Map<string, Column>()

  const col = (key: string, title: string, tone?: string, headCls?: string): Column => {
    let c = map.get(key)
    if (!c) {
      c = { key, title, tone, headCls, items: [] }
      map.set(key, c)
    }
    return c
  }

  for (const t of openTodos) {
    switch (dim) {
      case 'status':
        col(t.status, STATUS_LABELS[t.status] ?? t.status, STATUS_TONE[t.status]).items.push(t)
        break
      case 'planned': {
        if (t.planned_date && t.planned_date < today) break
        const key = t.planned_date ?? '__none__'
        // 标题带具体日期，用户不用算「后天是几号」
        const title = t.planned_date === today ? `今天 · ${t.planned_date.slice(5)}` : t.planned_date ?? '未计划'
        const { tone, headCls } = plannedTone(key, today)
        col(key, title, tone, headCls).items.push(t)
        break
      }
      case 'importance':
        col(t.importance, IMPORTANCE_LABELS[t.importance] ?? t.importance, IMPORTANCE_TONE[t.importance]).items.push(t)
        break
      case 'complexity':
        col(t.complexity, COMPLEXITY_LABELS[t.complexity] ?? t.complexity, COMPLEXITY_TONE[t.complexity]).items.push(t)
        break
      case 'tag': {
        const tags = t.tags ?? []
        if (tags.length === 0) col('__none__', '无标签').items.push(t)
        else
          for (const tag of tags) {
            const p = TAG_PALETTE[tagHash(tag) % TAG_PALETTE.length]
            col(tag, `#${tag}`, p.bg, p.head).items.push(t)
          }
        break
      }
    }
  }

  const cols = Array.from(map.values())
  if (dim === 'status') {
    const order = ['notStarted', 'inProgress', 'waitingOnOthers', 'deferred']
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

// 已完成列展开时最多渲染的卡片数：千级完成全渲染会卡顿，这里只出最近 50 条
const COMPLETED_RENDER_LIMIT = 50

export function TodoKanbanView({ openTodos, completedTodos, completedCount, lists, selectedTodoId, onSelect, onToggle, onUpdate }: Props) {
  const [dim, setDim] = useState<Dim>('status')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [showCompletedCol, setShowCompletedCol] = useState(false)

  const today = todayStr()
  const columns = useMemo(() => buildColumns(openTodos, dim, today), [openTodos, dim, today])
  const listName = useMemo(() => {
    const m = new Map(lists.map((l) => [l.id, l.display_name]))
    return (t: Todo) => m.get(t.list_id)
  }, [lists])

  const droppable = dim === 'status'

  const dropOn = (colKey: string) => {
    if (!droppable || !dragId) return
    const t = openTodos.find((x) => x.id === dragId)
    setDragId(null)
    setOverCol(null)
    if (t && t.status !== colKey) onUpdate(dragId, { ...t, id: dragId, status: colKey })
  }

  // 已完成卡片的副标题：完成时间比所属列表更有信息量（列表名仍前置）
  const doneSub = (t: Todo): string => {
    const ln = listName(t)
    const ca = t.completed_at ? `完成于 ${t.completed_at.slice(5, 10)}` : null
    return [ln, ca].filter(Boolean).join(' · ')
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 pb-3 flex-shrink-0">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
          {DIMS.map((d) => (
            <button
              key={d.key}
              onClick={() => setDim(d.key)}
              className={clsx(
                'px-2.5 py-1 text-xs rounded-md transition cursor-pointer',
                dim === d.key ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        {droppable && <span className="text-xs text-gray-400">拖动卡片到其他列即可改变状态；勾选圆形按钮直接完成</span>}
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
        <div className="flex gap-3 h-full min-w-max">
          {columns.map((c) => (
            <div
              key={c.key}
              onDragOver={(e) => {
                if (!droppable || !dragId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOverCol(c.key)
              }}
              onDragLeave={() => overCol === c.key && setOverCol(null)}
              onDrop={() => dropOn(c.key)}
              className={clsx(
                'w-60 flex flex-col rounded-xl border min-h-0 transition',
                c.tone ?? 'bg-gray-50/60',
                overCol === c.key ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-200',
              )}
            >
              <div className="px-3 py-2 flex items-center justify-between border-b border-black/5 flex-shrink-0">
                <span className={clsx('text-sm font-medium truncate', c.headCls ?? 'text-gray-700')}>{c.title}</span>
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
                      onToggle={(done) => onToggle(t, done)}
                    />
                  </div>
                ))}
                {c.items.length === 0 && (
                  <div className="flex-1 flex items-center justify-center text-xs text-gray-300 py-6">空</div>
                )}
              </div>
            </div>
          ))}

          {dim === 'status' && (
            <div
              className={clsx(
                'flex flex-col rounded-xl border border-gray-200 bg-emerald-50/50 min-h-0 overflow-hidden',
                // 折叠=窄边条、展开=整列，宽度动画让过渡自然而非突兀弹开
                'transition-all duration-300 ease-in-out',
                showCompletedCol ? 'w-60' : 'w-11',
              )}
            >
              {showCompletedCol ? (
                <>
                  <button
                    onClick={() => setShowCompletedCol(false)}
                    className="px-3 py-2 flex items-center justify-between border-b border-black/5 flex-shrink-0 cursor-pointer hover:bg-emerald-100/60 rounded-t-xl transition-colors"
                  >
                    <span className="text-sm font-medium text-gray-600 truncate">
                      已完成 <span className="text-emerald-600 font-semibold">{completedCount}</span>
                    </span>
                    <ChevronRight size={14} className="text-gray-400" />
                  </button>
                  <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 min-h-0">
                    {completedTodos.length === 0 && (
                      <div className="flex-1 flex items-center justify-center text-xs text-gray-300 py-6">加载中…</div>
                    )}
                    {completedTodos.slice(0, COMPLETED_RENDER_LIMIT).map((t) => (
                      <TodoMiniCard
                        key={t.id}
                        todo={t}
                        selected={selectedTodoId === t.id}
                        sub={doneSub(t)}
                        onClick={() => onSelect(t.id)}
                        onToggle={(done) => onToggle(t, done)}
                      />
                    ))}
                    {completedTodos.length > COMPLETED_RENDER_LIMIT && (
                      <div className="text-[10px] text-gray-400 text-center py-2 border-t border-black/5">
                        已显示最近 {COMPLETED_RENDER_LIMIT} / 共 {completedCount} 条
                      </div>
                    )}
                  </div>
                </>
              ) : (
                // 折叠边条：竖排「已完成」+ 计数，占位极小，点一下平滑展开
                <button
                  onClick={() => setShowCompletedCol(true)}
                  className="flex-1 flex flex-col items-center gap-1.5 py-3 cursor-pointer hover:bg-emerald-100/50 transition-colors"
                  aria-label={`展开已完成列（共 ${completedCount} 条）`}
                >
                  <CheckCircle2 size={15} className="text-emerald-500" />
                  <span className="text-xs font-semibold text-emerald-700">{completedCount}</span>
                  <span className="text-[10px] text-gray-500 [writing-mode:vertical-rl] tracking-widest">已完成</span>
                  <ChevronLeft size={12} className="text-gray-400 mt-auto" />
                </button>
              )}
            </div>
          )}

          {columns.length === 0 && (
            <div className="text-sm text-gray-300 flex items-center px-8">暂无待办</div>
          )}
        </div>
      </div>
    </div>
  )
}
