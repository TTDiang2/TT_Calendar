import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Todo, TodoList } from '../../types'
import { todayStr } from '../../utils/todoLogic'
import { buildColumns, type Dim } from '../../utils/todoBoards'
import { useT, type TxKey } from '../../i18n'
import { fmtNumber } from '../../i18n/format'
import { useLang } from '../../i18n'
import { layerLabel } from '../../i18n/adapt/layerLabel'
import { useCalendarTheme, withAlpha } from '../../lib/calendar-theme'
import { TodoMiniCard, type CardHide } from './TodoMiniCard'

/** 维度切换胶囊（labelKey 模式：模块常量不存文案，渲染时 t(d.labelKey)） */
const DIMS: { key: Dim; labelKey: TxKey }[] = [
  { key: 'status', labelKey: 'todoboards.kanban.dim.status' },
  { key: 'planned', labelKey: 'todoboards.kanban.dim.planned' },
  { key: 'importance', labelKey: 'todoboards.kanban.dim.importance' },
  { key: 'complexity', labelKey: 'todoboards.kanban.dim.complexity' },
  { key: 'tag', labelKey: 'todoboards.kanban.dim.tag' },
]

/** 当前维度对应的卡片字段：板块已经分组了，卡片不再重复显示这一维 */
const HIDE_BY_DIM: Record<Dim, CardHide> = {
  status: { status: true, body: true },
  planned: { planned: true, body: true },
  importance: { importance: true, body: true },
  complexity: { complexity: true, body: true },
  tag: { tags: true, body: true },
}

// 标签固定色槽：与 utils/todoBoards.ts 的 TAG_SLOT_COUNT 对齐（10 槽，低饱和）
const TAG_COLORS = [
  '#C2543D', '#B4791F', '#5F8A6E', '#4F7F9B', '#7A6C93',
  '#A0625F', '#6E8A62', '#8A6F9B', '#4A6E86', '#9B7B4A',
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

// 已完成列展开时最多渲染的卡片数：千级完成全渲染会卡顿，这里只出最近 50 条
const COMPLETED_RENDER_LIMIT = 50

/**
 * 待办看板 = 固定泳道。
 *
 * 旧版只给「有任务的列」建列：状态维度下只剩一个进行中任务时，整块板子就一根
 * 240px 的列，右边全空，而且没有空列可拖。现在枚举维度永远出全 4/3/3 列，
 * 空列自带虚线投放区；列宽改 flex-1，四列时自动铺满，标签多了才横向滚动。
 */
export function TodoKanbanView({ openTodos, completedTodos, completedCount, lists, selectedTodoId, onSelect, onToggle, onUpdate }: Props) {
  const t = useT()
  const lang = useLang()
  const { theme } = useCalendarTheme()
  const [dim, setDim] = useState<Dim>('status')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [showCompletedCol, setShowCompletedCol] = useState(false)

  const today = todayStr()
  const columns = useMemo(() => buildColumns(openTodos, dim, today, t), [openTodos, dim, today, t])
  const listName = useMemo(() => {
    const m = new Map(lists.map((l) => [l.id, layerLabel(l, t)]))
    return (td: Todo) => m.get(td.list_id)
  }, [lists, t])

  const droppable = dim === 'status'

  const dropOn = (colKey: string) => {
    if (!droppable || !dragId) return
    const target = openTodos.find((x) => x.id === dragId)
    setDragId(null)
    setOverCol(null)
    if (target && target.status !== colKey) onUpdate(dragId, { ...target, id: dragId, status: colKey })
  }

  const toneColor = (col: (typeof columns)[number]): string => {
    const tone = col.tone
    if (tone.kind === 'semantic') {
      return tone.tone === 'danger' ? theme.danger
        : tone.tone === 'info' ? theme.info
          : tone.tone === 'warning' ? theme.warning
            : tone.tone === 'success' ? theme.success
              : theme.muted
    }
    if (tone.kind === 'tag') return TAG_COLORS[tone.index % TAG_COLORS.length]!
    return theme.accent
  }

  // 已完成卡片的副标题：完成时间比所属列表更有信息量（列表名仍前置）
  const doneSub = (td: Todo): string => {
    const ln = listName(td)
    const ca = td.completed_at ? t('todoboards.kanban.doneAt', { date: td.completed_at.slice(5, 10) }) : null
    return [ln, ca].filter(Boolean).join(' · ')
  }

  const hide = HIDE_BY_DIM[dim]

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-3 pb-2.5 flex-shrink-0">
        <div
          className="inline-flex rounded-lg p-0.5 flex-shrink-0"
          style={{ backgroundColor: theme.subtle, border: `1px solid ${theme.border}` }}
        >
          {DIMS.map((d) => {
            const active = dim === d.key
            return (
              <button
                key={d.key}
                onClick={() => setDim(d.key)}
                className="px-2.5 py-1 text-[11px] rounded-md transition cursor-pointer"
                style={{
                  backgroundColor: active ? 'var(--cal-panel)' : 'transparent',
                  color: active ? theme.ink : theme.muted,
                  boxShadow: active ? '0 1px 2px rgba(17,24,39,0.08)' : undefined,
                  fontWeight: active ? 500 : 400,
                }}
              >
                {t(d.labelKey)}
              </button>
            )
          })}
        </div>
        {droppable && (
          <span className="text-[10px] truncate" style={{ color: theme.muted }}>
            {t('todoboards.kanban.dragHint')}
          </span>
        )}
        <span className="ml-auto text-[11px] tabular-nums flex-shrink-0" style={{ color: theme.muted }}>
          {fmtNumber(lang, openTodos.length)} {t('todoboards.kanban.openCount')}
        </span>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-2 min-h-0">
        <div className="flex gap-2.5 h-full">
          {columns.map((c) => {
            const over = overCol === c.key
            const tone = toneColor(c)
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
                onDrop={() => dropOn(c.key)}
                className="flex-1 basis-0 min-w-[124px] flex flex-col rounded-xl border min-h-0 transition-[border-color,box-shadow]"
                style={{
                  backgroundColor: 'var(--cal-panel)',
                  borderColor: over ? theme.accent : theme.border,
                  boxShadow: over ? `0 0 0 3px ${withAlpha(theme.accent, 0.14)}` : undefined,
                }}
              >
                <div className="h-[3px] rounded-t-xl flex-shrink-0" style={{ backgroundColor: tone, opacity: 0.85 }} />
                <div
                  className="px-3 py-2 flex items-center justify-between gap-2 flex-shrink-0"
                  style={{ borderBottom: `1px solid ${theme.border}` }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ backgroundColor: tone }} />
                    <span className="text-[12px] font-medium truncate" style={{ color: theme.ink }}>{c.title}</span>
                  </div>
                  <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: theme.muted }}>
                    {fmtNumber(lang, c.items.length)}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 min-h-0">
                  {c.items.map((td) => (
                    <div
                      key={`${td.id}-${c.key}`}
                      draggable={droppable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', td.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setDragId(td.id)
                      }}
                      onDragEnd={() => { setDragId(null); setOverCol(null) }}
                      className={clsx(dragId === td.id && 'opacity-30')}
                    >
                      <TodoMiniCard
                        todo={td}
                        density="compact"
                        hide={hide}
                        selected={selectedTodoId === td.id}
                        sub={listName(td)}
                        onClick={() => onSelect(td.id)}
                        onToggle={(done) => onToggle(td, done)}
                      />
                    </div>
                  ))}
                  {c.items.length === 0 && (
                    <div
                      className="h-[68px] rounded-lg border border-dashed flex items-center justify-center text-[10px]"
                      style={{
                        borderColor: over ? withAlpha(theme.accent, 0.55) : theme.border,
                        color: theme.muted,
                        backgroundColor: over ? withAlpha(theme.accent, 0.05) : 'transparent',
                      }}
                    >
                      {droppable ? t('todoboards.kanban.dropHere') : t('todoboards.kanban.emptyCol')}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {dim === 'status' && (
            <div
              className="flex flex-col rounded-xl border min-h-0 overflow-hidden transition-all duration-300 ease-in-out flex-shrink-0"
              style={{
                backgroundColor: 'var(--cal-panel)',
                borderColor: theme.border,
                width: showCompletedCol ? 300 : 44,
              }}
            >
              {showCompletedCol ? (
                <>
                  <div className="h-[3px] flex-shrink-0" style={{ backgroundColor: theme.success, opacity: 0.85 }} />
                  <button
                    onClick={() => setShowCompletedCol(false)}
                    className="px-3 py-2 flex items-center justify-between gap-2 flex-shrink-0 cursor-pointer"
                    style={{ borderBottom: `1px solid ${theme.border}` }}
                  >
                    <div className="flex flex-col items-start min-w-0">
                      <span className="text-[12px] font-medium truncate" style={{ color: theme.ink }}>
                        {t('todoboards.kanban.completed')}
                        <span className="ml-1.5 tabular-nums font-semibold" style={{ color: theme.success }}>
                          {fmtNumber(lang, completedCount)}
                        </span>
                      </span>
                      <span className="text-[10px]" style={{ color: theme.muted }}>
                        {t('todoboards.kanban.shownOf', { shown: Math.min(completedTodos.length, COMPLETED_RENDER_LIMIT), total: completedCount })}
                      </span>
                    </div>
                    <ChevronRight size={14} style={{ color: theme.muted }} className="flex-shrink-0" />
                  </button>
                  <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 min-h-0">
                    {completedTodos.length === 0 && (
                      <div className="h-[68px] flex items-center justify-center text-[10px]" style={{ color: theme.muted }}>
                        {t('common.loading')}
                      </div>
                    )}
                    {completedTodos.slice(0, COMPLETED_RENDER_LIMIT).map((td) => (
                      <TodoMiniCard
                        key={td.id}
                        todo={td}
                        density="compact"
                        hide={{ body: true, tags: true }}
                        selected={selectedTodoId === td.id}
                        sub={doneSub(td)}
                        onClick={() => onSelect(td.id)}
                        onToggle={(done) => onToggle(td, done)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <button
                  onClick={() => setShowCompletedCol(true)}
                  className="flex-1 flex flex-col items-center gap-1.5 py-3 cursor-pointer transition-colors"
                  style={{ color: theme.muted }}
                  aria-label={t('todoboards.kanban.expandCompleted', { n: completedCount })}
                >
                  <CheckCircle2 size={15} style={{ color: theme.success }} />
                  <span className="text-[11px] font-semibold tabular-nums" style={{ color: theme.success }}>
                    {fmtNumber(lang, completedCount)}
                  </span>
                  <span className="text-[10px] [writing-mode:vertical-rl] tracking-widest">
                    {t('todoboards.kanban.completed')}
                  </span>
                  <ChevronLeft size={12} className="mt-auto" style={{ color: theme.muted }} />
                </button>
              )}
            </div>
          )}

          {columns.length === 0 && (
            <div className="text-[13px] flex items-center px-8" style={{ color: theme.muted }}>
              {t('todoboards.empty.none')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
