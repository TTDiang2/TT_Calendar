import type { Todo } from '../types'

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

export const IMPORTANCE_LABELS: Record<string, string> = {
  high: '高', normal: '中', low: '低',
}

export const COMPLEXITY_LABELS: Record<string, string> = {
  hard: '困难', medium: '中等', simple: '简单',
}

export const STATUS_LABELS: Record<string, string> = {
  notStarted: '未开始', inProgress: '进行中', waitingOnOthers: '等他人', deferred: '已推迟', completed: '已完成',
}
