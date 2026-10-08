import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, Inbox, ListPlus, Pencil, Plus, Repeat, Star, Trash2, Upload } from 'lucide-react'
import clsx from 'clsx'
import { getTodoLists, getTodos, getTodoStats, createTodo, updateTodo, deleteTodo, createTodoList, updateTodoList, deleteTodoList, importTodosCsv, reorderTodoLists, reorderTodos } from '../api/client'
import { todayStr, labelOf } from '../utils/todoLogic'
import type { Todo, TodoList, TodoSort, TodoViewMode } from '../types'
import { useT, type TxKey } from '../i18n'
import { layerLabel } from '../i18n/adapt/layerLabel'
import { TodoDetailPanel, type TodoDetailPanelRef } from './TodoDetailPanel'
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
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set())
  const [manualOrder, setManualOrder] = useState<string[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const leavingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  // 量筒：今日完成（completed_on 精确过滤，避免全量 completed 截断丢今日）
  const today = todayStr()
  const { data: todayDone = [] } = useQuery({
    queryKey: ['todos', 'doneOn', today],
    queryFn: () => getTodos({ status: 'completed', completed_on: today }),
    enabled: viewMode === 'jar',
  })

  // 看板已完成：tag 筛选后用于展开列（计数直接用 stats）
  const filteredCompleted = useMemo(() => {
    return tagFilter ? completed.filter((t) => (t.tags ?? []).includes(tagFilter)) : completed
  }, [completed, tagFilter])

  const selectedTodo = useMemo(
    () => {
      if (!selectedTodoId) return null
      return [...incomplete, ...completed].find((t) => t.id === selectedTodoId) ?? null
    },
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

  const handleToggle = (t: Todo, done: boolean) => {
    setLeavingIds((prev) => new Set(prev).add(t.id))
    if (leavingTimer.current) clearTimeout(leavingTimer.current)
    leavingTimer.current = setTimeout(() => {
      updateMut.mutate({ id: t.id, data: { ...t, id: t.id, status: done ? 'completed' : 'notStarted' } })
      setLeavingIds((prev) => {
        const next = new Set(prev)
        next.delete(t.id)
        return next
      })
    }, 280)
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of incomplete) m.set(t.list_id, (m.get(t.list_id) ?? 0) + 1)
    return m
  }, [incomplete])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    for (const t of [...incomplete, ...completed]) (t.tags ?? []).forEach((tag) => s.add(tag))
    return Array.from(s).sort()
  }, [incomplete, completed])

  const filteredIncomplete = useMemo(() => {
    const base = tagFilter ? incomplete.filter((t) => (t.tags ?? []).includes(tagFilter)) : incomplete
    if (manualOrder) {
      const orderMap = new Map(manualOrder.map((id, i) => [id, i]))
      return [...base].sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999))
    }
    return base
  }, [incomplete, tagFilter, manualOrder])

  const jarTodos = useMemo(() => [...filteredIncomplete, ...todayDone], [filteredIncomplete, todayDone])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setCsvResult(null)
      csvMut.mutate(f)
    }
    e.target.value = ''
  }

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
                  onClick={(e) => { e.stopPropagation(); if (confirm(t('todoview.lists.deleteConfirm', { name: l.display_name }))) deleteListMut.mutate(l.id) }}
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
                const listName = lists.find((l) => l.id === t.list_id)?.display_name
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
                      leaving={leavingIds.has(t.id)}
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
                        const listName = lists.find((l) => l.id === t.list_id)?.display_name
                        return (
                          <TodoRow
                            key={t.id}
                            todo={t}
                            listName={listName}
                            isDone={true}
                            overdue={false}
                            selected={selectedTodoId === t.id}
                            leaving={leavingIds.has(t.id)}
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

function TodoRow({ todo, listName, isDone, overdue, selected, leaving, onSelect, onToggle, onOpenNotes }: {
  todo: Todo
  listName?: string
  isDone: boolean
  overdue: boolean
  selected: boolean
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
        'group flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-all duration-200 tt-row-enter',
        selected ? 'bg-blue-50 border-blue-200' : 'border-transparent hover:bg-gray-100 hover:border-gray-200 active:scale-[0.99]',
        leaving && 'opacity-0 scale-[0.98] -translate-x-2 max-h-0 py-0 my-0 overflow-hidden',
      )}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        className={clsx(
          'w-4 h-4 mt-0.5 rounded border flex-shrink-0 flex items-center justify-center transition-all duration-200 active:scale-75',
          isDone ? 'bg-blue-500 border-blue-500' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50',
        )}
      >
        {isDone && <Check size={11} className="text-white" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={clsx('text-sm leading-snug break-words whitespace-normal', isDone ? 'text-gray-400 line-through' : 'text-gray-800')}>{todo.title}</p>
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
          {!isDone && todo.status && todo.status !== 'notStarted' && (
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
  )
}
