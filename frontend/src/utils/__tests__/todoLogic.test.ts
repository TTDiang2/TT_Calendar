import { describe, expect, it } from 'vitest'
import {
  applyTagAndOrder,
  collectTags,
  filterByTag,
  findTodoById,
  ganttRange,
  sortByManualOrder,
} from '../todoLogic'
import type { Todo } from '../../types'

function todo(id: string, tags: string[] | null = null): Todo {
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
    tags,
    created_at: null,
    completed_at: null,
    sort_order: 0,
  }
}

describe('collectTags', () => {
  it('跨多组去重并按字典序排列', () => {
    expect(
      collectTags(
        [todo('a', ['工作']), todo('b', ['生活', '工作'])],
        [todo('c', ['工作', '紧急'])],
      ),
    ).toEqual(['工作', '紧急', '生活'].sort())
  })

  it('tags 为 null 的待办不贡献标签', () => {
    expect(collectTags([todo('a'), todo('b', ['x'])])).toEqual(['x'])
  })

  it('单组内重复标签只出现一次', () => {
    expect(collectTags([todo('a', ['dup']), todo('b', ['dup'])])).toEqual(['dup'])
  })

  it('无任何标签时返回空数组', () => {
    expect(collectTags([todo('a'), todo('b')], [])).toEqual([])
  })

  it('传入空标签串不产生空字符串条目', () => {
    expect(collectTags([todo('a', ['', 'x'])])).toEqual(['', 'x'])
  })
})

describe('filterByTag', () => {
  const todos = [todo('a', ['工作']), todo('b', ['生活']), todo('c', ['工作', '生活'])]

  it('按标签过滤', () => {
    expect(filterByTag(todos, '工作').map((t) => t.id)).toEqual(['a', 'c'])
    expect(filterByTag(todos, '生活').map((t) => t.id)).toEqual(['b', 'c'])
  })

  it('无筛选时原样返回入参（保持引用，供下游 useMemo 依赖比对）', () => {
    expect(filterByTag(todos, null)).toBe(todos)
    expect(filterByTag(todos, undefined)).toBe(todos)
  })

  it('无匹配的标签返回空数组而非 null', () => {
    expect(filterByTag(todos, '不存在')).toEqual([])
  })

  it('无标签的待办在任何筛选下都不匹配', () => {
    const withNull = [todo('a', null), todo('b', ['x'])]
    expect(filterByTag(withNull, 'x').map((t) => t.id)).toEqual(['b'])
  })
})

describe('sortByManualOrder', () => {
  const todos = [todo('a'), todo('b'), todo('c')]

  it('按 manualOrder 的下标排序', () => {
    expect(sortByManualOrder(todos, ['c', 'a', 'b']).map((t) => t.id)).toEqual(['c', 'a', 'b'])
  })

  it('不在 manualOrder 里的待办排到末尾', () => {
    // 筛选后才出现的新条目不该被顶到最前面
    expect(sortByManualOrder(todos, ['c', 'a']).map((t) => t.id)).toEqual(['c', 'a', 'b'])
  })

  it('manualOrder 为空时原样返回入参', () => {
    expect(sortByManualOrder(todos, null)).toBe(todos)
    expect(sortByManualOrder(todos, undefined)).toBe(todos)
  })

  it('manualOrder 为空数组时走排序路径但顺序不变', () => {
    // 与原组件的 `if (manualOrder)` 一致：空数组是 truthy，故会排序（全部 999，
    // 稳定排序等于原顺序），只是产出新数组而非同一引用。
    expect(sortByManualOrder(todos, []).map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(sortByManualOrder(todos, [])).not.toBe(todos)
  })

  it('不修改入参数组', () => {
    const before = todos.map((t) => t.id)
    sortByManualOrder(todos, ['c', 'b', 'a'])
    expect(todos.map((t) => t.id)).toEqual(before)
  })

  it('manualOrder 含重复 id 时以后一次出现的位置为准（Map 后写覆盖）', () => {
    // new Map([[b,0],[a,1],[b,2]]) → b→2、a→1，故顺序是 a、b、c
    expect(sortByManualOrder(todos, ['b', 'a', 'b']).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('applyTagAndOrder', () => {
  const todos = [todo('a', ['工作']), todo('b', ['生活']), todo('c', ['工作'])]

  it('先筛标签再按手动顺序排', () => {
    expect(applyTagAndOrder(todos, '工作', ['c', 'a']).map((t) => t.id)).toEqual(['c', 'a'])
  })

  it('只有筛选无排序时保持原相对顺序', () => {
    expect(applyTagAndOrder(todos, '工作', null).map((t) => t.id)).toEqual(['a', 'c'])
  })
})

describe('findTodoById', () => {
  const incomplete = [todo('a'), todo('b')]
  const completed = [todo('c')]

  it('在未完成段命中', () => {
    expect(findTodoById([incomplete, completed], 'a')?.id).toBe('a')
  })

  it('跨段命中已完成里的待办', () => {
    expect(findTodoById([incomplete, completed], 'c')?.id).toBe('c')
  })

  it('id 为空或找不到时返回 null', () => {
    expect(findTodoById([incomplete, completed], null)).toBeNull()
    expect(findTodoById([incomplete, completed], undefined)).toBeNull()
    expect(findTodoById([incomplete, completed], '不存在')).toBeNull()
  })

  it('没有任何分组时返回 null', () => {
    expect(findTodoById([], 'a')).toBeNull()
  })

  it('前段命中时优先返回前段（不去后段找同名）', () => {
    const dup = todo('dup')
    expect(findTodoById([[dup], [todo('dup')]], 'dup')).toBe(dup)
  })
})

describe('ganttRange', () => {
  const today = '2026-11-17'
  const base = todo('gantt')

  it('没有计划/开始/截止日 → 不排期，不再拿 created_at 拉长条', () => {
    const r = ganttRange({ ...base, created_at: '2026-08-06T10:00:00' }, today)
    expect(r).toMatchObject({ start: null, end: null, scheduled: false, milestone: false })
  })

  it('只有计划日 → 单日里程碑', () => {
    const r = ganttRange({ ...base, planned_date: '2026-11-25' }, today)
    expect(r).toMatchObject({
      start: '2026-11-25',
      end: '2026-11-25',
      scheduled: true,
      milestone: true,
      overdue: false,
    })
  })

  it('start + due → 从开始日到截止日，而不是从创建日', () => {
    const r = ganttRange(
      { ...base, created_at: '2026-08-06T10:00:00', start_date: '2026-11-01', due_date: '2026-12-01' },
      today,
    )
    expect(r).toMatchObject({
      start: '2026-11-01',
      end: '2026-12-01',
      scheduled: true,
      milestone: false,
      overdue: false,
    })
  })

  it('只有截止日 → 里程碑；截止日已过 → 逾期', () => {
    const r = ganttRange({ ...base, due_date: '2026-11-10' }, today)
    expect(r).toMatchObject({
      start: '2026-11-10',
      end: '2026-11-10',
      milestone: true,
      overdue: true,
    })
  })

  it('起止顺序反了会自动交换', () => {
    const r = ganttRange({ ...base, start_date: '2026-12-01', due_date: '2026-11-01' }, today)
    expect(r.start).toBe('2026-11-01')
    expect(r.end).toBe('2026-12-01')
  })

  it('只有开始日的长项目不误标逾期', () => {
    const r = ganttRange({ ...base, start_date: '2026-01-01' }, today)
    expect(r).toMatchObject({ start: '2026-01-01', end: '2026-01-01', overdue: false })
  })
})