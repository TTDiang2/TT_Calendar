/**
 * 待办看板的列生成（纯函数，便于单测）。
 *
 * 规则要点：
 *  - 状态 / 重要性 / 复杂度是「枚举维度」，列集合必须固定：即使某列没任务也要出现，
 *    否则唯一一个「进行中」任务会让整个看板只剩一根 240px 的列，右边全空，
 *    而且没有「未开始」「等待他人」列可拖。
 *  - 计划日期 / 标签是「值维度」，列只能跟着数据长，最多补一个「未计划 / 无标签」。
 */
import type { Todo } from '../types'
import { COMPLEXITY_KEYS, IMPORTANCE_KEYS, STATUS_KEYS, labelOf } from './todoLogic'
import type { I18n } from '../i18n'

export type Dim = 'status' | 'planned' | 'importance' | 'complexity' | 'tag'

export type ColumnTone =
  | { kind: 'semantic'; tone: 'muted' | 'info' | 'warning' | 'danger' | 'success' }
  | { kind: 'accent'; strength: number }
  | { kind: 'tag'; index: number }

export interface Column {
  key: string
  title: string
  tone: ColumnTone
  items: Todo[]
}

type Translate = I18n['t']

/** 状态维度的固定列顺序与色调 */
const STATUS_ORDER: { key: string; tone: ColumnTone; labelKeys: typeof STATUS_KEYS }[] = [
  { key: 'notStarted', tone: { kind: 'semantic', tone: 'muted' }, labelKeys: STATUS_KEYS },
  { key: 'inProgress', tone: { kind: 'semantic', tone: 'info' }, labelKeys: STATUS_KEYS },
  { key: 'waitingOnOthers', tone: { kind: 'semantic', tone: 'warning' }, labelKeys: STATUS_KEYS },
  { key: 'deferred', tone: { kind: 'semantic', tone: 'muted' }, labelKeys: STATUS_KEYS },
]

const IMPORTANCE_ORDER = ['high', 'normal', 'low'] as const
const COMPLEXITY_ORDER = ['hard', 'medium', 'simple'] as const

const IMPORTANCE_TONE: Record<string, ColumnTone> = {
  high: { kind: 'semantic', tone: 'danger' },
  normal: { kind: 'semantic', tone: 'warning' },
  low: { kind: 'semantic', tone: 'success' },
}

const COMPLEXITY_TONE: Record<string, ColumnTone> = {
  hard: { kind: 'semantic', tone: 'danger' },
  medium: { kind: 'semantic', tone: 'warning' },
  simple: { kind: 'semantic', tone: 'success' },
}

/** 标签固定配色：hash 到 10 个槽位，同一标签跨列/跨次渲染永远同色 */
export const TAG_SLOT_COUNT = 10

export function tagSlot(tag: string): number {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
  return h % TAG_SLOT_COUNT
}

/** 计划日期色阶：今天最深、越远越浅——一扫就知道近期压力在哪 */
function plannedStrength(planned: string | null, today: string): number {
  if (!planned) return 0
  const days = Math.round((new Date(planned).getTime() - new Date(today).getTime()) / 86400000)
  if (days <= 0) return 3
  if (days <= 2) return 2
  if (days <= 7) return 1
  return 0
}

export function buildColumns(openTodos: Todo[], dim: Dim, today: string, tr: Translate): Column[] {
  if (dim === 'status') {
    return STATUS_ORDER.map((s) => ({
      key: s.key,
      title: labelOf(s.labelKeys, s.key, tr),
      tone: s.tone,
      items: openTodos.filter((t) => t.status === s.key),
    }))
  }

  if (dim === 'importance') {
    return IMPORTANCE_ORDER.map((k) => ({
      key: k,
      title: labelOf(IMPORTANCE_KEYS, k, tr),
      tone: IMPORTANCE_TONE[k]!,
      items: openTodos.filter((t) => t.importance === k),
    }))
  }

  if (dim === 'complexity') {
    return COMPLEXITY_ORDER.map((k) => ({
      key: k,
      title: labelOf(COMPLEXITY_KEYS, k, tr),
      tone: COMPLEXITY_TONE[k]!,
      items: openTodos.filter((t) => t.complexity === k),
    }))
  }

  const map = new Map<string, Column>()
  const col = (key: string, title: string, tone: ColumnTone): Column => {
    let c = map.get(key)
    if (!c) {
      c = { key, title, tone, items: [] }
      map.set(key, c)
    }
    return c
  }

  for (const t of openTodos) {
    if (dim === 'planned') {
      // 计划日已过的不进看板（逾期由列表/矩阵处理），保持看板只看「还没到」的安排
      if (t.planned_date && t.planned_date < today) continue
      const key = t.planned_date ?? '__none__'
      const title = t.planned_date
        ? t.planned_date === today
          ? tr('todoboards.kanban.todayCol', { date: t.planned_date.slice(5) })
          : t.planned_date
        : tr('todoboards.kanban.unplanned')
      col(key, title, { kind: 'accent', strength: plannedStrength(t.planned_date, today) }).items.push(t)
      continue
    }
    // tag
    const tags = t.tags ?? []
    if (tags.length === 0) {
      col('__none__', tr('todoboards.kanban.untagged'), { kind: 'semantic', tone: 'muted' }).items.push(t)
    } else {
      for (const tag of tags) {
        col(tag, `#${tag}`, { kind: 'tag', index: tagSlot(tag) }).items.push(t)
      }
    }
  }

  const cols = Array.from(map.values())
  if (dim === 'planned') {
    cols.sort((a, b) => {
      if (a.key === '__none__') return 1
      if (b.key === '__none__') return -1
      return a.key.localeCompare(b.key)
    })
  }
  return cols
}
