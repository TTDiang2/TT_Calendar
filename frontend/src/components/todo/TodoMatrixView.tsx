import { useMemo } from 'react'
import { AlertTriangle, CalendarClock, Coffee, Hourglass } from 'lucide-react'
import type { Todo, TodoList } from '../../types'
import { dueInDays, isImportant, urgencyOf } from '../../utils/todoLogic'
import { useI18n, type I18n, type TxKey } from '../../i18n'
import { layerLabel } from '../../i18n/adapt/layerLabel'
import { useCalendarTheme } from '../../lib/calendar-theme'
import { withAlpha } from '../../lib/calendar-theme'
import { TodoMiniCard } from './TodoMiniCard'

interface Props {
  todos: Todo[]
  lists: TodoList[]
  selectedTodoId: string | null
  onSelect: (id: string) => void
  onToggle: (todo: Todo, done: boolean) => void
}

type Tone = 'danger' | 'info' | 'warning' | 'muted'

/** 四象限（labelKey 模式：模块常量不存文案，key 命名沿 Neo quadrant.*，zh 逐字一致） */
const QUADRANTS: {
  key: 'iu' | 'in' | 'nu' | 'nn'
  labels: { title: TxKey; action: TxKey; desc: TxKey }
  icon: typeof AlertTriangle
  tone: Tone
}[] = [
  {
    key: 'iu',
    labels: { title: 'todoboards.matrix.quadrant.doNow.title', action: 'todoboards.matrix.quadrant.doNow.action', desc: 'todoboards.matrix.quadrant.doNow.desc' },
    icon: AlertTriangle,
    tone: 'danger',
  },
  {
    key: 'in',
    labels: { title: 'todoboards.matrix.quadrant.planIt.title', action: 'todoboards.matrix.quadrant.planIt.action', desc: 'todoboards.matrix.quadrant.planIt.desc' },
    icon: CalendarClock,
    tone: 'info',
  },
  {
    key: 'nu',
    labels: { title: 'todoboards.matrix.quadrant.delegate.title', action: 'todoboards.matrix.quadrant.delegate.action', desc: 'todoboards.matrix.quadrant.delegate.desc' },
    icon: Coffee,
    tone: 'warning',
  },
  {
    key: 'nn',
    labels: { title: 'todoboards.matrix.quadrant.drop.title', action: 'todoboards.matrix.quadrant.drop.action', desc: 'todoboards.matrix.quadrant.drop.desc' },
    icon: Hourglass,
    tone: 'muted',
  },
]

function subText(t: Todo, lists: TodoList[], ia: I18n): string {
  // 卡片元信息行已经带了截止/计划日期与标签，副标题只留所属列表，避免同一信息写两遍
  const l0 = lists.find((l) => l.id === t.list_id)
  return l0 ? layerLabel(l0, ia.t) : ''
}

/**
 * 待办矩阵 = 四象限仪表盘。
 *
 * 旧版四个象限整块铺红/蓝/琥珀，颜色比任务本身更抢眼；卡片上状态、重要性、
 * 复杂度、三个日期、标签、备注全在，信息重复且没有主次。
 * 现在：象限只是纸面白卡 + 顶部 3px 语义色条，卡片用 compact 密度，
 * 并且隐藏「象限已经表达过」的两个维度（重要性、复杂度）。
 */
export function TodoMatrixView({ todos, lists, selectedTodoId, onSelect, onToggle }: Props) {
  const ia = useI18n()
  const { theme } = useCalendarTheme()
  const active = useMemo(() => todos.filter((t) => t.status !== 'completed'), [todos])

  const toneColor = (tone: Tone): string =>
    tone === 'danger' ? theme.danger : tone === 'info' ? theme.info : tone === 'warning' ? theme.warning : theme.muted

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
    <div className="h-full flex flex-col min-h-0 pb-4">
      <div className="flex items-center justify-between pb-2 flex-shrink-0">
        <span className="text-[10px] tracking-wide" style={{ color: theme.muted }}>
          {ia.t('todoboards.matrix.axisHint')}
        </span>
        <span className="text-[10px] tabular-nums" style={{ color: theme.muted }}>
          {active.length} {ia.t('todoboards.kanban.openCount')}
        </span>
      </div>

      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-2.5 min-h-0">
        {QUADRANTS.map((q) => {
          const items = buckets[q.key]
          const Icon = q.icon
          const soonCount = items.filter((t) => urgencyOf(t) === 'soon').length
          const c = toneColor(q.tone)
          return (
            <div
              key={q.key}
              className="rounded-xl border flex flex-col overflow-hidden min-h-0"
              style={{ backgroundColor: 'var(--cal-panel)', borderColor: theme.border }}
            >
              {/* 顶部色条是这一格唯一的「大面积」颜色 */}
              <div className="h-[3px] flex-shrink-0" style={{ backgroundColor: c, opacity: q.tone === 'muted' ? 0.45 : 1 }} />

              <div
                className="px-3 py-2 flex items-center justify-between gap-2 flex-shrink-0"
                style={{ borderBottom: `1px solid ${theme.border}` }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: withAlpha(c, 0.12), color: c }}
                  >
                    <Icon size={13} />
                  </span>
                  <span className="text-[13px] font-medium truncate" style={{ color: theme.ink }}>
                    {ia.t(q.labels.title)}
                  </span>
                  <span className="text-[10px] truncate hidden xl:inline" style={{ color: theme.muted }}>
                    {ia.t(q.labels.action)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {soonCount > 0 && (
                    <span
                      className="flex items-center gap-1 text-[10px] tabular-nums"
                      style={{ color: theme.warningInk }}
                      title={ia.t('todoboards.matrix.soonTitle')}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.warning }} />
                      {soonCount}
                    </span>
                  )}
                  <span className="text-[11px] font-medium tabular-nums" style={{ color: theme.muted }}>
                    {items.length}
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 min-h-0">
                {items.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center gap-1.5 px-3">
                    <Icon size={18} style={{ color: withAlpha(c, 0.35) }} />
                    <span className="text-[11px] text-center leading-snug" style={{ color: theme.muted, opacity: 0.75 }}>
                      {ia.t(q.labels.desc)}
                    </span>
                  </div>
                ) : (
                  items.map((t) => (
                    <TodoMiniCard
                      key={t.id}
                      todo={t}
                      density="compact"
                      // 象限本身就说明了重要性与紧迫度，卡片不再重复这两个维度
                      hide={{ importance: true, complexity: true, body: true }}
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
    </div>
  )
}
