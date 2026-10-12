import type { Todo } from '../types'
import type { TxKey } from '../i18n'

export type UrgencyLevel = 'urgent' | 'soon' | 'later'

const dayMs = 86400000

function toDay(d: string): number {
  return Math.floor(new Date(d + 'T00:00:00').getTime() / dayMs)
}

export function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 紧急度：due 优先 + planned 兜底（TODO_VIEWS_DESIGN.md §2.1，用户确认版） */
export function urgencyOf(t: Todo, today = todayStr()): UrgencyLevel {
  const td = toDay(today)
  if (t.due_date) {
    const slack = toDay(t.due_date) - td
    if (slack <= 3) return 'urgent'
    if (slack <= 7) return 'soon'
    return 'later'
  }
  if (t.planned_date) {
    return toDay(t.planned_date) <= td ? 'urgent' : 'later'
  }
  return 'later'
}

/** 逾期天数（正数 = 已逾期 N 天；0 = 今天到期；负数 = 还剩 N 天） */
export function dueInDays(t: Todo, today = todayStr()): number | null {
  if (!t.due_date) return null
  return toDay(t.due_date) - toDay(today)
}

/** 重要性轴：high = 重要（TODO_VIEWS_DESIGN.md §2.2，用户确认版） */
export function isImportant(t: Todo): boolean {
  return t.importance === 'high'
}

export interface GanttRange {
  start: string
  end: string
  overdue: boolean
  completed: boolean
}

/** 甘特区 间：start=created_at，end 按 completed→due→planned→start 优先级（TODO_VIEWS_DESIGN.md §2.3） */
export function ganttRange(t: Todo, today = todayStr()): GanttRange {
  const completed = t.status === 'completed'
  const dateOf = (dt: string | null): string | null => {
    if (!dt) return null
    return dt.slice(0, 10)
  }
  const start = dateOf(t.created_at) ?? t.planned_date ?? t.due_date ?? today
  let end = completed
    ? dateOf(t.completed_at)
    : t.due_date ?? t.planned_date ?? null
  let overdue = false
  if (!completed) {
    const naturalEnd = end
    if (!naturalEnd || toDay(naturalEnd) < toDay(today)) {
      end = today
      overdue = !!naturalEnd
    }
  }
  return { start, end: end ?? start, overdue, completed }
}

/**
 * 旧词表三张（与 todoDetail 表措辞不同：等他人/高·中·低/困难·中等·简单），zh 逐屏一致
 * 红线禁合并；labelKey 模式（手册 §8.2）：常量表只存字典 key，渲染时经 labelOf() 出文案。
 * 落点：i18n/dict/fragments/todo.ts 的 todo.card.*（消费方：看板列头/迷你卡/甘特条）。
 */
export const IMPORTANCE_KEYS: Record<string, TxKey> = {
  high: 'todo.card.importance.high', normal: 'todo.card.importance.normal', low: 'todo.card.importance.low',
}

export const COMPLEXITY_KEYS: Record<string, TxKey> = {
  hard: 'todo.card.complexity.hard', medium: 'todo.card.complexity.medium', simple: 'todo.card.complexity.simple',
}

export const STATUS_KEYS: Record<string, TxKey> = {
  notStarted: 'todo.card.status.notStarted', inProgress: 'todo.card.status.inProgress', waitingOnOthers: 'todo.card.status.waitingOnOthers', deferred: 'todo.card.status.deferred', completed: 'todo.card.status.completed',
}

/** 词表 key 查询：未知枚举回落原值（同原 `LABELS[v] ?? v` 语义，新档位先行时不白屏） */
export function labelOf(keys: Record<string, TxKey>, value: string, t: (k: TxKey) => string): string {
  const k = keys[value]
  return k ? t(k) : value
}

// ---------------------------------------------------------------- 列表筛选与排序
// 以下四函数原先内联在 TodoView.tsx 的 useMemo 里。抽出来的原因是它们承载了
// 真实语义（标签筛选、手动排序的兜底位置、跨状态段查找），却没有一行测试——
// 组件要渲染才能触发，一次改错就是「待办顺序悄悄变了」这种没人报错的回归。

/**
 * 标签全集：多组待办（通常是未完成 + 已完成）里出现过的去重标签，按字典序。
 * tags 为 null/undefined 的待办按「无标签」处理，不贡献任何标签。
 */
export function collectTags(...groups: Todo[][]): string[] {
  const s = new Set<string>()
  for (const group of groups) {
    for (const t of group) (t.tags ?? []).forEach((tag) => s.add(tag))
  }
  return Array.from(s).sort()
}

/**
 * 标签筛选。无筛选时原样返回入参（保持引用不变），否则过滤出带该标签的待办。
 * 保留引用是有意的：下游 useMemo 的依赖比对依赖它，避免每次渲染都产出新数组。
 */
export function filterByTag(todos: Todo[], tagFilter: string | null | undefined): Todo[] {
  return tagFilter ? todos.filter((t) => (t.tags ?? []).includes(tagFilter)) : todos
}

/**
 * 手动排序：按 manualOrder 里的下标升序。
 * 不在 manualOrder 中的待办一律排到末尾（999）——它们是筛选后才出现的新条目，
 * 排到末尾而不是排到最前，避免每次打开筛选视图都把它们顶上来。
 * null/undefined 时原样返回；空数组会走排序路径（此时全部取 999，稳定排序等于
 * 原顺序，只是产出新数组），与原组件的 `if (manualOrder)` 判断保持一致。
 */
export function sortByManualOrder(todos: Todo[], manualOrder: string[] | null | undefined): Todo[] {
  if (!manualOrder) return todos
  const orderMap = new Map(manualOrder.map((id, i) => [id, i]))
  return [...todos].sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999))
}

/** 筛选 + 排序的组合，供视图层一次调用。 */
export function applyTagAndOrder(
  todos: Todo[],
  tagFilter: string | null | undefined,
  manualOrder: string[] | null | undefined,
): Todo[] {
  return sortByManualOrder(filterByTag(todos, tagFilter), manualOrder)
}

/**
 * 跨多个状态段按 id 查找（侧栏选中项：待办可能在未完成段，也可能在已完成段）。
 * id 为空或两段都没有时返回 null。
 */
export function findTodoById(groups: Todo[][], id: string | null | undefined): Todo | null {
  if (!id) return null
  for (const group of groups) {
    const hit = group.find((t) => t.id === id)
    if (hit) return hit
  }
  return null
}
