import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, ChevronUp, Inbox, ListPlus, Pencil, Plus, Repeat, Star, Trash2, Upload } from 'lucide-react'
import clsx from 'clsx'
import { getTodoLists, getTodos, getTodoStats, createTodo, updateTodo, deleteTodo, createTodoList, updateTodoList, deleteTodoList, importTodosCsv, reorderTodoLists, reorderTodos } from '../api/client'
import { todayStr, labelOf, collectTags, applyTagAndOrder, filterByTag, findTodoById } from '../utils/todoLogic'
import type { Todo, TodoList, TodoSort, TodoViewMode } from '../types'
import { useT, type TxKey } from '../i18n'
import { layerLabel } from '../i18n/adapt/layerLabel'
import { TodoDetailPanel, type TodoDetailPanelRef } from './TodoDetailPanel'
import { AnimatedCheck } from './ui/AnimatedCheck'
import { TodoMatrixView } from './todo/TodoMatrixView'
import { TodoKanbanView } from './todo/TodoKanbanView'
import { TodoGanttView } from './todo/TodoGanttView'
import { TodoJarView } from './todo/TodoJarView'
import { TodoStickiesView } from './todo/TodoStickiesView'

/** 排序下拉（labelKey 模式：模块常量不存文案，渲染时 t(o.labelKey)） */
const SORT_OPTIONS: { key: TodoSort; labelKey: TxKey }[] = [
  { key: 'manual', labelKey: 'todoview.sort.manual' },
  { key: 'due_importance', labelKey: 'todoview.sort.dueImportance' },
  { key: 'due_planned_importance', labelKey: 'todoview.sort.duePlannedImportance' },
  { key: 'due', labelKey: 'todoview.sort.due' },
  { key: 'planned', labelKey: 'todoview.sort.planned' },
  { key: 'importance', labelKey: 'todoview.sort.importance' },
  { key: 'created', labelKey: 'todoview.sort.created' },
]

/** 行徽标词表（labelKey 模式，同 utils/todoLogic 三张旧表；落点 todoview.imp/status/complexity） */
const IMPORTANCE_KEYS: Record<string, TxKey> = {
  high: 'todoview.imp.high',
  normal: 'todoview.imp.normal',
  low: 'todoview.imp.low',
}
const IMPORTANCE_TAG_CLS: Record<string, string> = {
  high: 'bg-red-50 text-red-600',
  normal: 'bg-gray-100 text-gray-500',
  low: 'bg-green-50 text-green-600',
}

const STATUS_KEYS: Record<string, TxKey> = {
  notStarted: 'todoview.status.notStarted',
  inProgress: 'todoview.status.inProgress',
  completed: 'todoview.status.completed',
  waitingOnOthers: 'todoview.status.waitingOnOthers',
  deferred: 'todoview.status.deferred',
}
const STATUS_TAG_CLS: Record<string, string> = {
  notStarted: 'bg-gray-100 text-gray-500',
  inProgress: 'bg-blue-50 text-blue-600',
  completed: 'bg-gray-100 text-gray-400',
  waitingOnOthers: 'bg-amber-50 text-amber-600',
  deferred: 'bg-purple-50 text-purple-600',
}

const COMPLEXITY_KEYS: Record<string, TxKey> = {
  simple: 'todoview.complexity.simple',
  medium: 'todoview.complexity.medium',
  hard: 'todoview.complexity.hard',
}
const COMPLEXITY_TAG_CLS: Record<string, string> = {
  simple: 'bg-green-50 text-green-600',
  medium: 'bg-gray-100 text-gray-500',
  hard: 'bg-purple-50 text-purple-600',
}

/** 重复档位徽标（none 不显示，未知枚举回落原值） */
const REPEAT_KEYS: Record<string, TxKey> = {
  daily: 'todoview.repeat.daily',
  weekdays: 'todoview.repeat.weekdays',
  weekly: 'todoview.repeat.weekly',
}

const DEFAULT_LIST_KEY = 'tt_default_todo_list'

/** 完成编排阶段：check = 勾画/划掉，collapse = 收行。 */
type ExitPhase = 'check' | 'collapse'

export function TodoView({ viewMode }: { viewMode: TodoViewMode }) {
  const t = useT()
  const qc = useQueryClient()
  const [selectedList, setSelectedList] = useState<string | null>(() => localStorage.getItem(DEFAULT_LIST_KEY))
  const [sort, setSort] = useState<TodoSort>('due_planned_importance')
  const [tagFilter, setTagFilter] = useState<string>('')
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null)
  const [creatingList, setCreatingList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [autoList, setAutoList] = useState(false)
  const [csvResult, setCsvResult] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const [exits, setExits] = useState<Map<string, { done: boolean; phase: ExitPhase }>>(new Map())
  const [undoToast, setUndoToast] = useState<Todo | null>(null)
  const [manualOrder, setManualOrder] = useState<string[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map())
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragListId = useRef<string | null>(null)
  const [renamingListId, setRenamingListId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const dragTodoId = useRef<string | null>(null)
  const detailRef = useRef<TodoDetailPanelRef>(null)

  const { data: lists = [] } = useQuery({
    queryKey: ['todoLists'],
    queryFn: getTodoLists,
  })

  // 轻量统计（首屏立即显示完成数量，不用拉全量）
  const { data: stats } = useQuery({
    queryKey: ['todoStats', selectedList],
    queryFn: () => getTodoStats(selectedList ?? undefined),
  })

  // 未完成 + 进行中：首屏只拉这一部分（快）
  const { data: rawIncomplete = [] } = useQuery({
    queryKey: ['todos', selectedList, 'incomplete', sort],
    queryFn: () => getTodos({ list_id: selectedList ?? undefined, status: 'notStarted', sort }),
  })

  const incomplete = rawIncomplete

  // 已完成：列表展开 / 看板（按状态维度）时拉，限制 500 条
  const { data: completed = [], isLoading: loadingCompleted } = useQuery({
    queryKey: ['todos', selectedList, 'completed', sort],
    queryFn: () => getTodos({ list_id: selectedList ?? undefined, status: 'completed', sort, limit: 500 }),
    enabled: showCompleted || viewMode === 'kanban',
  })

  // 后端数据追上后清掉已完成编排的临时行：完成→等它离开未完列表；取消完成→等它离开已完成列表。
  useEffect(() => {
    if (exits.size === 0) return
    const incompleteIds = new Set(incomplete.map((t) => t.id))
    const completedIds = new Set(completed.map((t) => t.id))
    setExits((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const [id, entry] of prev) {
        const stillVisible = entry.done ? incompleteIds.has(id) : completedIds.has(id)
        if (!stillVisible) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [incomplete, completed, exits])

  // 卸载时清掉所有编排计时器，避免在已卸载组件上 setState。
  useEffect(() => () => {
    for (const timers of exitTimers.current.values()) timers.forEach(clearTimeout)
    exitTimers.current.clear()
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  // 量筒：今日完成（completed_on 精确过滤，避免全量 completed 截断丢今日）
  const today = todayStr()
  const { data: todayDone = [] } = useQuery({
    queryKey: ['todos', 'doneOn', today],
    queryFn: () => getTodos({ status: 'completed', completed_on: today }),
    enabled: viewMode === 'jar',
  })

  // 看板已完成：tag 筛选后用于展开列（计数直接用 stats）
  const filteredCompleted = useMemo(() => filterByTag(completed, tagFilter), [completed, tagFilter])

  const selectedTodo = useMemo(
    () => findTodoById([incomplete, completed], selectedTodoId),
    [incomplete, completed, selectedTodoId],
  )

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['todos'] })
    qc.invalidateQueries({ queryKey: ['todoStats'] })
    qc.invalidateQueries({ queryKey: ['todoLists'] })
    qc.invalidateQueries({ queryKey: ['view'] })
  }

  const createMut = useMutation({ mutationFn: createTodo, onSuccess: invalidate })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => updateTodo(id, data),
    onSuccess: invalidate,
  })
  const deleteMut = useMutation({ mutationFn: deleteTodo, onSuccess: invalidate })
  const createListMut = useMutation({ mutationFn: (name: string) => createTodoList(name), onSuccess: invalidate })
  const renameListMut = useMutation({
    mutationFn: ({ id, display_name }: { id: string; display_name: string }) => updateTodoList(id, display_name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todoLists'] })
      setRenamingListId(null)
    },
  })
  const cancelRename = () => { setRenamingListId(null); setRenameDraft('') }
  const commitRename = (id: string) => {
    const trimmed = renameDraft.trim()
    if (!trimmed) { cancelRename(); return }
    renameListMut.mutate({ id, display_name: trimmed })
  }
  const deleteListMut = useMutation({
    mutationFn: deleteTodoList,
    onSuccess: () => { invalidate(); setSelectedTodoId(null) },
  })
  const reorderListMut = useMutation({
    mutationFn: (ordered_ids: string[]) => reorderTodoLists(ordered_ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todoLists'] }),
  })
  const reorderTodoMut = useMutation({
    mutationFn: (ordered_ids: string[]) => reorderTodos(ordered_ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos'] })
      qc.invalidateQueries({ queryKey: ['view'] })
    },
  })

  const setDefaultList = (id: string | null) => {
    if (id) localStorage.setItem(DEFAULT_LIST_KEY, id)
    else localStorage.removeItem(DEFAULT_LIST_KEY)
    setSelectedList(id)
  }

  const csvMut = useMutation({
    mutationFn: importTodosCsv,
    onSuccess: (r: { inserted: number; lists_created: number; errors: string[] }) => {
      invalidate()
      setCsvResult(
        r.errors.length
          ? t('todoview.csv.doneWithErrors', { inserted: r.inserted, lists: r.lists_created, n: r.errors.length })
          : t('todoview.csv.done', { inserted: r.inserted, lists: r.lists_created }),
      )
    },
    onError: (e: unknown) => setCsvResult(t('todoview.csv.failed', { msg: e instanceof Error ? e.message : 'unknown' })),
  })

  const dismissUndoToast = () => {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current)
      toastTimer.current = null
    }
    setUndoToast(null)
  }

  const showUndoToast = (todo: Todo) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setUndoToast(todo)
    toastTimer.current = setTimeout(() => {
      setUndoToast(null)
      toastTimer.current = null
    }, 2500)
  }

  // 悬停时暂停倒计时，移开后重新给 2.5 秒，方便慢慢点撤销。
  const pauseUndoToast = () => {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current)
      toastTimer.current = null
    }
  }
  const resumeUndoToast = () => {
    if (!undoToast) return
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => {
      setUndoToast(null)
      toastTimer.current = null
    }, 2500)
  }

  const handleUndoCompletion = () => {
    const todo = undoToast
    dismissUndoToast()
    if (!todo) return
    // 恢复完成前的状态（可能是进行中等），而不是一律退回未开始。
    updateMut.mutate({ id: todo.id, data: { ...todo, id: todo.id } })
  }

  const scheduleExit = (id: string, fn: () => void, delay: number) => {
    const timer = setTimeout(fn, delay)
    const timers = exitTimers.current.get(id) ?? []
    timers.push(timer)
    exitTimers.current.set(id, timers)
  }

  const handleToggle = (todo: Todo, done: boolean) => {
    if (exits.has(todo.id) || exitTimers.current.has(todo.id)) return
    const vars = {
      id: todo.id,
      data: { ...todo, id: todo.id, status: done ? 'completed' : 'notStarted' },
    }

    // 矩阵/看板由数据驱动卡片位置，立即提交；列表视图走下面的 勾画→划掉→收行 编排。
    if (viewMode !== 'list') {
      updateMut.mutate(vars, { onSuccess: () => { if (done) showUndoToast(todo) } })
      return
    }

    exitTimers.current.set(todo.id, [])
    setExits((prev) => new Map(prev).set(todo.id, { done, phase: done ? 'check' : 'collapse' }))

    // 先让勾号画完、标题划掉，再收行；约 200ms 后行高归零。
    if (done) {
      scheduleExit(todo.id, () => {
        setExits((prev) => {
          const entry = prev.get(todo.id)
          if (!entry) return prev
          return new Map(prev).set(todo.id, { ...entry, phase: 'collapse' })
        })
      }, 220)
    }

    scheduleExit(todo.id, () => {
      exitTimers.current.delete(todo.id)
      updateMut.mutate(vars, {
        onSuccess: () => { if (done) showUndoToast(todo) },
        onError: () => {
          setExits((prev) => {
            if (!prev.has(todo.id)) return prev
            const next = new Map(prev)
            next.delete(todo.id)
            return next
          })
        },
      })
    }, done ? 420 : 200)
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of incomplete) m.set(t.list_id, (m.get(t.list_id) ?? 0) + 1)
    return m
  }, [incomplete])

  const allTags = useMemo(() => collectTags(incomplete, completed), [incomplete, completed])

  const filteredIncomplete = useMemo(
    () => applyTagAndOrder(incomplete, tagFilter, manualOrder),
    [incomplete, tagFilter, manualOrder],
  )

  const jarTodos = useMemo(() => [...filteredIncomplete, ...todayDone], [filteredIncomplete, todayDone])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setCsvResult(null)
      csvMut.mutate(f)
    }
    e.target.value = ''
  }

  // 门5 P3：列表名显示映射（map 回调的 (t) 是待办对象，会遮蔽翻译 t —— 在外层先绑定）
  const listLabelOf = (todo: Todo) => layerLabel(lists.find((l) => l.id === todo.list_id) ?? { display_name: '' }, t)

  const completedCount = stats?.completed ?? (showCompleted ? completed.length : undefined)

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左列表栏 — w-60 对齐日历 Sidebar */}
      <div className="w-60 bg-white border-r border-gray-200 p-3 overflow-y-auto flex flex-col">
        <button
          onClick={() => { setSelectedList(null); setSelectedTodoId(null); setManualOrder(null) }}
          className={clsx(
            'flex items-center justify-between px-2 py-1.5 rounded-md text-sm mb-1',
            selectedList === null ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50',
          )}
        >
          <span className="flex items-center gap-1.5"><Inbox size={14} /> {t('todoview.lists.all')}</span>
          {stats && <span className="text-xs text-gray-400">{stats.incomplete}</span>}
        </button>
        {lists.map((l) => {
          const isDefault = localStorage.getItem(DEFAULT_LIST_KEY) === l.id
          return (
            <div
              key={l.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', l.id)
                e.dataTransfer.effectAllowed = 'move'
                dragListId.current = l.id
              }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
              onDrop={() => {
                const src = dragListId.current
                dragListId.current = null
                if (!src || src === l.id) return
                const ids = lists.map((x) => x.id)
                const from = ids.indexOf(src)
                const to = ids.indexOf(l.id)
                if (from < 0 || to < 0) return
                ids.splice(to, 0, ids.splice(from, 1)[0])
                reorderListMut.mutate(ids)
              }}
              className={clsx(
                'group flex items-center justify-between px-2 py-1.5 rounded-md text-sm cursor-pointer mb-0.5 transition-colors select-none',
                selectedList === l.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100',
              )}
              onClick={() => { setSelectedList(l.id); setSelectedTodoId(null); setManualOrder(null) }}
            >
              <span className="truncate flex-1 flex items-center gap-1">
                <span className="opacity-30 group-hover:opacity-60 text-[10px] select-none">⋮⋮</span>
                {renamingListId === l.id ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(l.id)}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(l.id) }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-white border border-blue-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                ) : (
                  layerLabel(l, t)
                )}
              </span>
              <span className="flex items-center gap-1">
                {counts.get(l.id) ? <span className="text-xs text-gray-400">{counts.get(l.id)}</span> : null}
                <button
                  onClick={(e) => { e.stopPropagation(); setDefaultList(isDefault ? null : l.id) }}
                  className={isDefault ? 'text-amber-400' : 'opacity-0 group-hover:opacity-100 text-gray-300 hover:text-amber-400'}
                  title={isDefault ? t('todoview.lists.unsetDefault') : t('todoview.lists.setDefault')}
                >
                  <Star size={12} fill={isDefault ? 'currentColor' : 'none'} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setRenamingListId(l.id); setRenameDraft(l.display_name) }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500"
                  title={t('todoview.lists.rename')}
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); if (confirm(t('todoview.lists.deleteConfirm', { name: layerLabel(l, t) }))) deleteListMut.mutate(l.id) }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
          )
        })}

        {creatingList ? (
          <div className="mt-2 flex gap-1">
            <input
              autoFocus
              className="tt-input flex-1 text-sm"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newListName.trim()) { createListMut.mutate(newListName.trim()); setNewListName(''); setCreatingList(false) }
                if (e.key === 'Escape') { setCreatingList(false); setNewListName('') }
              }}
              placeholder={t('todoview.lists.namePlaceholder')}
            />
          </div>
        ) : (
          <button onClick={() => setCreatingList(true)} className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-400 hover:text-gray-600 mt-1">
            <ListPlus size={14} /> {t('todoview.lists.create')}
          </button>
        )}
      </div>

      {/* 中任务区 */}
      <div className="flex-1 flex flex-col p-4 overflow-hidden min-w-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <FilterSelect
              label={t('todoview.filter.sort')}
              value={sort}
              options={SORT_OPTIONS.map((o) => ({ value: o.key, label: t(o.labelKey) }))}
              onChange={(v) => { setSort(v as TodoSort); setManualOrder(null) }}
            />
            {allTags.length > 0 && (
              <FilterSelect
                label={t('todoview.filter.tag')}
                value={tagFilter}
                options={[{ value: '', label: t('todoview.filter.allTags') }, ...allTags.map((tag) => ({ value: tag, label: tag }))]}
                onChange={(v) => { setTagFilter(v); setManualOrder(null) }}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg cursor-pointer">
              <Upload size={14} /> {t('todoview.toolbar.importCsv')}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
            </label>
            <button
              onClick={async () => {
                if (!lists.length) {
                  setAutoList(true)
                  try {
                    // 默认待办列表名经 createTodoList 持久化写入 todo_lists.display_name——
                    // 持久化数据非渲染期文案（手册 §5.1），保持原样（Neo lists.defaultName
                    // TODO-REVIEW 同款边界），行级棘轮豁免。
                    // eslint-disable-next-line no-restricted-syntax
                    const tl = await createTodoList('任务')
                    setSelectedList(tl.id)
                    invalidate()
                  } catch {
                    setAutoList(false)
                    return
                  }
                  setAutoList(false)
                }
                setSelectedTodoId('__NEW__')
              }}
              disabled={autoList}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
            >
              <Plus size={14} /> {t('todoview.actions.new')}
            </button>
          </div>
        </div>

        {csvResult && <div className="mb-2 text-sm text-gray-500 bg-gray-50 px-3 py-1.5 rounded">{csvResult}</div>}

        <div className={viewMode === 'list' ? 'flex-1 overflow-y-auto' : 'flex-1 min-h-0'}>
          {viewMode === 'matrix' ? (
            <TodoMatrixView todos={filteredIncomplete} lists={lists} selectedTodoId={selectedTodoId} onSelect={setSelectedTodoId} onToggle={handleToggle} />
          ) : viewMode === 'kanban' ? (
            <TodoKanbanView
              openTodos={filteredIncomplete}
              completedTodos={filteredCompleted}
              completedCount={stats?.completed ?? completed.length}
              lists={lists}
              selectedTodoId={selectedTodoId}
              onSelect={setSelectedTodoId}
              onToggle={handleToggle}
              onUpdate={(id, data) => updateMut.mutate({ id, data })}
            />
          ) : viewMode === 'gantt' ? (
            <TodoGanttView todos={filteredIncomplete} lists={lists} selectedTodoId={selectedTodoId} onSelect={setSelectedTodoId} />
          ) : viewMode === 'stickies' ? (
            <TodoStickiesView
              todos={filteredIncomplete}
              selectedTodoId={selectedTodoId}
              onSelect={setSelectedTodoId}
              onOpenNotes={(id) => { setSelectedTodoId(id); detailRef.current?.openNotes() }}
            />
          ) : viewMode === 'jar' ? (
            <TodoJarView
              todos={jarTodos}
              selectedTodoId={selectedTodoId}
              onSelect={setSelectedTodoId}
              onOpenNotes={(id) => { setSelectedTodoId(id); detailRef.current?.openNotes() }}
            />
          ) : filteredIncomplete.length === 0 && completedCount === undefined ? (
            <div className="h-full flex items-center justify-center text-gray-300 text-sm">
              {tagFilter ? t('todoview.empty.tagFiltered', { tag: tagFilter }) : t('todoview.empty.desktop')}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredIncomplete.length === 0 && completedCount === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">{t('todoview.empty.noneOpen')}</p>
              )}
              {filteredIncomplete.map((t) => {
                const listName = listLabelOf(t)
                const overdue = t.due_date && new Date(t.due_date) < new Date(new Date().toDateString())
                return (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', t.id)
                      e.dataTransfer.effectAllowed = 'move'
                      dragTodoId.current = t.id
                      setDraggingId(t.id)
                    }}
                    onDragEnd={() => { setDraggingId(null); setDragOverId(null) }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverId(t.id) }}
                    onDrop={() => {
                      const src = dragTodoId.current
                      dragTodoId.current = null
                      setDraggingId(null)
                      setDragOverId(null)
                      if (!src || src === t.id) return
                      const ids = filteredIncomplete.map((x) => x.id)
                      const from = ids.indexOf(src)
                      const to = ids.indexOf(t.id)
                      if (from < 0 || to < 0) return
                      ids.splice(to, 0, ids.splice(from, 1)[0])
                      setManualOrder(ids)
                      reorderTodoMut.mutate(ids)
                      setSort('manual')
                    }}
                    className={clsx(
                      'transition-opacity rounded-lg select-none cursor-grab active:cursor-grabbing',
                      draggingId === t.id && 'opacity-30',
                      dragOverId === t.id && draggingId !== t.id && 'ring-2 ring-blue-400 ring-offset-1',
                    )}
                  >
                    <TodoRow
                      todo={t}
                      listName={listName}
                      isDone={false}
                      overdue={!!overdue}
                      selected={selectedTodoId === t.id}
                      finishing={exits.get(t.id)?.done === true}
                      leaving={exits.get(t.id)?.phase === 'collapse'}
                      onSelect={() => setSelectedTodoId(t.id)}
                      onToggle={() => handleToggle(t, true)}
                      onOpenNotes={() => { setSelectedTodoId(t.id); detailRef.current?.openNotes() }}
                    />
                  </div>
                )
              })}

              {(completedCount ?? 0) > 0 && (
                <div className="mt-3 border-t border-gray-100 pt-2">
                  <button
                    onClick={() => setShowCompleted((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-md"
                  >
                    <span>{t('todoview.row.completedWithCount', { n: completedCount ?? 0 })}</span>
                    {showCompleted ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {showCompleted && (
                    <div className="mt-1 flex flex-col gap-1">
                      {loadingCompleted && <p className="text-xs text-gray-400 px-3 py-1">{t('common.loading')}</p>}
                      {completed.map((t) => {
                        const listName = listLabelOf(t)
                        return (
                          <TodoRow
                            key={t.id}
                            todo={t}
                            listName={listName}
                            isDone={true}
                            overdue={false}
                            selected={selectedTodoId === t.id}
                            finishing={exits.get(t.id)?.done === true}
                            leaving={exits.get(t.id)?.phase === 'collapse'}
                            onSelect={() => setSelectedTodoId(t.id)}
                            onToggle={() => handleToggle(t, false)}
                            onOpenNotes={() => { setSelectedTodoId(t.id); detailRef.current?.openNotes() }}
                          />
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 右详情栏 — w-72 对齐日历 DetailPanel */}
      <TodoDetailPanel
        ref={detailRef}
        todo={selectedTodoId === '__NEW__'
          ? { id: '' as string, list_id: selectedList ?? lists[0]?.id ?? '', title: '', body: null, importance: 'normal', due_date: null, planned_date: null, start_date: null, repeat: null, complexity: 'medium', tags: null, status: 'notStarted', created_at: null, completed_at: null, sort_order: 0 }
          : selectedTodo}
        lists={lists}
        onClose={() => setSelectedTodoId(null)}
        onSave={(data) => {
          if (!data.id) {
            createMut.mutate({
              list_id: data.list_id,
              title: data.title,
              body: data.body,
              importance: data.importance,
              due_date: data.due_date,
              planned_date: data.planned_date,
              start_date: data.start_date,
              repeat: data.repeat,
              complexity: data.complexity,
              tags: data.tags,
              status: data.status,
            })
          } else {
            updateMut.mutate({ id: data.id, data: { ...data, id: data.id } })
          }
        }}
        onDelete={(id) => { deleteMut.mutate(id); setSelectedTodoId(null) }}
      />

      <AnimatePresence>
        {undoToast && (
          <motion.div
            key="todo-undo-toast"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 14, x: '-50%', scale: 0.98 }}
            animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
            exit={{ opacity: 0, y: 8, x: '-50%', scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onMouseEnter={pauseUndoToast}
            onMouseLeave={resumeUndoToast}
            className="fixed bottom-6 left-1/2 z-[60] flex items-center gap-2.5 rounded-full border border-gray-200/80 bg-white/95 py-2 pl-2 text-sm text-gray-700 shadow-lg shadow-gray-900/10 backdrop-blur"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white" aria-hidden="true">
              <Check size={12} strokeWidth={3} />
            </span>
            <span className="font-medium text-gray-500">{t('todoview.toast.completed')}</span>
            <span className="max-w-[240px] truncate font-medium text-gray-700">{undoToast.title}</span>
            <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
            <button
              type="button"
              onClick={handleUndoCompletion}
              className="rounded-full px-2 py-0.5 font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {t('todoview.toast.undo')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function FilterSelect({ label, value, options, onChange }: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => o.value === value)

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 text-sm rounded-lg border transition',
          open
            ? 'border-blue-300 bg-blue-50 text-blue-700 shadow-sm'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300',
        )}
      >
        <span className="text-gray-400">{label}</span>
        <span className="font-medium">{current?.label}</span>
        <ChevronDown size={14} className={clsx('text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[170px] bg-white rounded-lg border border-gray-200 shadow-lg py-1 z-30">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={clsx(
                'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left transition',
                o.value === value
                  ? 'text-blue-600 font-medium'
                  : 'text-gray-700 hover:bg-gray-50',
              )}
            >
              <span>{o.label}</span>
              {o.value === value && <Check size={14} className="text-blue-600 flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TodoRow({ todo, listName, isDone, overdue, selected, finishing, leaving, onSelect, onToggle, onOpenNotes }: {
  todo: Todo
  listName?: string
  isDone: boolean
  overdue: boolean
  selected: boolean
  finishing?: boolean
  leaving?: boolean
  onSelect: () => void
  onToggle: () => void
  onOpenNotes?: () => void
}) {
  const t = useT()
  const dueState = useMemo(() => {
    if (!todo.due_date) return null
    const today = new Date(new Date().toDateString()).getTime()
    const due = new Date(todo.due_date).getTime()
    const diff = Math.round((due - today) / 86400000)
    if (diff < 0) return { labelKey: 'todoview.due.overdue' as TxKey, cls: 'bg-red-100 text-red-600' }
    if (diff === 0) return { labelKey: 'todoview.due.today' as TxKey, cls: 'bg-orange-100 text-orange-600' }
    if (diff === 1) return { labelKey: 'todoview.due.tomorrow' as TxKey, cls: 'bg-amber-100 text-amber-600' }
    return null
  }, [todo.due_date])

  const todayStr = new Date().toISOString().slice(0, 10)
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const plannedToday = todo.planned_date === todayStr
  const plannedTomorrow = todo.planned_date === tomorrowStr

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpenNotes}
      className={clsx(
        'group grid cursor-pointer border rounded-lg transition-all duration-200 tt-row-enter',
        selected ? 'bg-blue-50 border-blue-200' : 'border-transparent hover:bg-gray-100 hover:border-gray-200 active:scale-[0.99]',
        leaving && 'opacity-0 scale-[0.98] -translate-x-2 border-transparent',
      )}
      style={{ gridTemplateRows: leaving ? '0fr' : '1fr' }}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex items-start gap-2 px-3 py-2">
          <AnimatedCheck
        checked={isDone || !!finishing}
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        ariaLabel={isDone || finishing ? t('todoboards.aria.markUndone') : t('todoboards.aria.markDone')}
        size={18}
        checkSize={12}
        className={clsx(
          'mt-0.5 border',
          isDone || finishing
            ? 'bg-[var(--cal-accent,#3b82f6)] border-[var(--cal-accent,#3b82f6)]'
            : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50 hover:ring-2 hover:ring-blue-100',
        )}
        checkClassName="text-white"
      />
      <div className="flex-1 min-w-0">
        <p
          className={clsx('text-sm leading-snug break-words whitespace-normal', isDone || finishing ? 'text-gray-400' : 'text-gray-800')}
          style={{
            textDecoration: 'line-through',
            textDecorationColor: isDone || finishing ? 'currentColor' : 'transparent',
            textDecorationThickness: '1px',
            // 勾号先画，划掉晚 120ms 出现；两者都完成后再收行。
            transition: 'text-decoration-color 140ms ease 120ms, color 180ms ease',
          }}
        >
          {todo.title}
        </p>
        {todo.body && <p className="text-xs text-gray-400 break-words whitespace-normal mt-0.5">{todo.body}</p>}
        <div className="flex flex-wrap gap-1 mt-1">
          {todo.complexity && (
            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', COMPLEXITY_TAG_CLS[todo.complexity] ?? COMPLEXITY_TAG_CLS.medium)}>
              {labelOf(COMPLEXITY_KEYS, todo.complexity, t)}
            </span>
          )}
          <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', IMPORTANCE_TAG_CLS[todo.importance] ?? IMPORTANCE_TAG_CLS.normal)}>
            {labelOf(IMPORTANCE_KEYS, todo.importance, t)}
          </span>
          {todo.repeat && todo.repeat !== 'none' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 inline-flex items-center gap-0.5">
              <Repeat size={9} />
              {labelOf(REPEAT_KEYS, todo.repeat, t)}
            </span>
          )}
          {!isDone && !finishing && todo.status && todo.status !== 'notStarted' && (
            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', STATUS_TAG_CLS[todo.status] ?? STATUS_TAG_CLS.notStarted)}>
              {labelOf(STATUS_KEYS, todo.status, t)}
            </span>
          )}
          {(todo.tags ?? []).map((tag) => (
            <span key={tag} className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5 flex-wrap justify-end">
        {listName && !isDone && <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{listName}</span>}
        {todo.due_date && !isDone && (
          <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', dueState ? dueState.cls : 'bg-gray-100 text-gray-500')}>
            {dueState
              ? t('todoview.due.badge', { label: t(dueState.labelKey), date: todo.due_date.slice(5) })
              : todo.due_date.slice(5)}
          </span>
        )}
        {plannedToday && !isDone && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{t('todoview.plan.today')}</span>
        )}
        {plannedTomorrow && !isDone && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-600">{t('todoview.plan.tomorrow')}</span>
        )}
        </div>
        </div>
      </div>
    </div>
  )
}
