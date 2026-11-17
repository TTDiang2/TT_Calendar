import { describe, expect, it } from 'vitest'
import { buildColumns, tagSlot, TAG_SLOT_COUNT } from '../todoBoards'
import type { Todo } from '../../types'

function todo(id: string, patch: Partial<Todo> = {}): Todo {
  return {
    id,
    list_id: 'L1',
    title: `todo-${id}`,
    body: null,
    status: 'notStarted',
    importance: 'normal',
    due_date: null,
    planned_date: null,
    start_date: null,
    repeat: null,
    complexity: 'medium',
    tags: null,
    created_at: null,
    completed_at: null,
    sort_order: 0,
    ...patch,
  }
}

// 看板列头文字走字典；单测只关心「列集合与分桶是否正确」，翻译函数退化成 key 本身
const tr = ((k: string) => k) as never

describe('buildColumns / 状态维度', () => {
  it('没有任何任务时也出全 4 列（保证空列可投放）', () => {
    const cols = buildColumns([], 'status', '2026-11-17', tr)
    expect(cols.map((c) => c.key)).toEqual(['notStarted', 'inProgress', 'waitingOnOthers', 'deferred'])
    expect(cols.every((c) => c.items.length === 0)).toBe(true)
  })

  it('只有一个进行中任务时仍然 4 列，且该任务只落在进行中列', () => {
    const cols = buildColumns([todo('a', { status: 'inProgress' })], 'status', '2026-11-17', tr)
    expect(cols).toHaveLength(4)
    expect(cols.find((c) => c.key === 'inProgress')!.items.map((t) => t.id)).toEqual(['a'])
    expect(cols.filter((c) => c.key !== 'inProgress').every((c) => c.items.length === 0)).toBe(true)
  })
})

describe('buildColumns / 枚举维度', () => {
  it('重要性恒为 3 列，顺序 high → normal → low', () => {
    const cols = buildColumns([todo('a', { importance: 'low' })], 'importance', '2026-11-17', tr)
    expect(cols.map((c) => c.key)).toEqual(['high', 'normal', 'low'])
  })

  it('复杂度恒为 3 列，顺序 hard → medium → simple', () => {
    const cols = buildColumns([], 'complexity', '2026-11-17', tr)
    expect(cols.map((c) => c.key)).toEqual(['hard', 'medium', 'simple'])
  })
})

describe('buildColumns / 值维度', () => {
  it('计划日期：只出有值的列 + 未计划列，且未计划排最后', () => {
    const cols = buildColumns(
      [
        todo('a', { planned_date: '2026-11-18' }),
        todo('b', { planned_date: '2026-11-18' }),
        todo('c'),
      ],
      'planned',
      '2026-11-17',
      tr,
    )
    expect(cols.map((c) => c.key)).toEqual(['2026-11-18', '__none__'])
    expect(cols[0]!.items).toHaveLength(2)
  })

  it('计划日期已过的任务不进看板', () => {
    const cols = buildColumns([todo('a', { planned_date: '2026-11-10' })], 'planned', '2026-11-17', tr)
    expect(cols).toHaveLength(0)
  })

  it('计划日期为今天的列强度最高（3）', () => {
    const cols = buildColumns([todo('a', { planned_date: '2026-11-17' })], 'planned', '2026-11-17', tr)
    expect(cols[0]!.tone).toEqual({ kind: 'accent', strength: 3 })
  })

  it('标签：一个任务有多个标签会出现在多列里', () => {
    const cols = buildColumns([todo('a', { tags: ['x', 'y'] })], 'tag', '2026-11-17', tr)
    expect(cols.map((c) => c.key)).toEqual(['x', 'y'])
    expect(cols.every((c) => c.items.length === 1)).toBe(true)
  })

  it('无标签任务落到「无标签」列', () => {
    const cols = buildColumns([todo('a')], 'tag', '2026-11-17', tr)
    expect(cols.map((c) => c.key)).toEqual(['__none__'])
  })
})

describe('tagSlot', () => {
  it('同一标签永远落在同一槽位且在范围内', () => {
    const a = tagSlot('工作')
    expect(tagSlot('工作')).toBe(a)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(TAG_SLOT_COUNT)
  })
})
