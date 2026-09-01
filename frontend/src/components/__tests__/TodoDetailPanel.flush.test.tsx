/**
 * TodoDetailPanel「离开编辑态自动保存」回归测试
 *
 * 背景：新建待办时面板里装的是一个幻影 todo（id=''），此前三次修复都在
 * 「切走时自动保存」上翻车 —— v1 重复创建、v2 完全丢失、v3 只在「切到无选中」
 * 一条路径上生效。这里把所有离开路径钉死成断言，任一条路径回归都会立刻变红。
 *
 * 覆盖路径：
 *   1. 点 X 关闭          2. 点侧栏切走（→ null）   3. 点另一个待办（→ 真实 id）
 *   4. 整个面板卸载（切视图）5. 点保存按钮             6. Ctrl+Enter
 *   7. 点删除              8. 真实任务无改动关闭       9. 真实任务改后切走
 *  10. 幻影空标题切走
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { TodoDetailPanel } from '../TodoDetailPanel'
import type { Todo, TodoList } from '../../types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const LISTS: TodoList[] = [{ id: 'list-1', display_name: '任务', sort_order: 0, created_at: null }]

const makeTodo = (over: Partial<Todo> = {}): Todo => ({
  id: 'real-1',
  list_id: 'list-1',
  title: '已有任务',
  body: null,
  status: 'notStarted',
  importance: 'normal',
  due_date: null,
  planned_date: null,
  start_date: null,
  complexity: 'medium',
  tags: null,
  created_at: null,
  completed_at: null,
  sort_order: 0,
  ...over,
})

/** 新建待办时父组件塞进来的幻影对象 */
const PHANTOM = makeTodo({ id: '', title: '' })
const OTHER = makeTodo({ id: 'real-2', title: '另一条任务' })

type HostApi = {
  /** 模拟点击另一个待办 */
  selectOther: () => void
  /** 模拟点侧栏「全部」/其他列表：把选中置空 */
  selectNone: () => void
  /** 模拟切到日历 tab：整个面板卸载 */
  unmountPanel: () => void
}

/**
 * 复刻 TodoView 对面板的用法：选中态由父组件持有，onClose 把选中置空，
 * 点另一个待办 / 切视图分别对应「换 todo」和「卸载」两种离开方式。
 */
function renderPanel(startWith: Todo | null) {
  const saves: Todo[] = []
  const deletes: string[] = []
  const api: HostApi = { selectOther: () => {}, selectNone: () => {}, unmountPanel: () => {} }

  function Host() {
    const [todo, setTodo] = useState<Todo | null>(startWith)
    const [mounted, setMounted] = useState(true)
    // 必须包 act：这些 setState 来自测试代码而非 DOM 事件，否则 React 18 只调度不提交，
    // effect cleanup（也就是落盘逻辑）根本没机会执行，断言会假红。
    api.selectOther = () => act(() => setTodo(OTHER))
    api.selectNone = () => act(() => setTodo(null))
    api.unmountPanel = () => act(() => setMounted(false))
    return (
      <>
        {mounted && (
          <TodoDetailPanel
            todo={todo}
            lists={LISTS}
            onClose={() => setTodo(null)}
            onSave={(d) => saves.push(d)}
            onDelete={(id) => deletes.push(id)}
          />
        )}
      </>
    )
  }

  render(<Host />)
  return { api, saves, deletes }
}

const titleBox = () => screen.getByPlaceholderText('标题') as HTMLTextAreaElement
const typeTitle = (v: string) => fireEvent.change(titleBox(), { target: { value: v } })
/** 幻影 → create；真实任务 → update */
const isCreate = (t: Todo) => t.id === ''

describe('TodoDetailPanel 离开编辑态落盘', () => {
  it('1. 点 X 关闭 —— 自动创建 1 条', () => {
    const { saves } = renderPanel(PHANTOM)
    typeTitle('测试任务一')
    fireEvent.click(screen.getByTitle('关闭'))
    expect(saves).toHaveLength(1)
    expect(isCreate(saves[0])).toBe(true)
    expect(saves[0].title).toBe('测试任务一')
  })

  it('2. 点侧栏切走（选中置空）—— 自动创建 1 条', () => {
    const { api, saves } = renderPanel(PHANTOM)
    typeTitle('测试任务二')
    api.selectNone() // 等价于点左侧「全部」/其它列表，TodoView 会把选中置空
    expect(saves).toHaveLength(1)
    expect(isCreate(saves[0])).toBe(true)
    expect(saves[0].title).toBe('测试任务二')
  })

  it('3. 点另一个待办 —— 自动创建 1 条（v3 在此丢失输入）', () => {
    const { api, saves } = renderPanel(PHANTOM)
    typeTitle('测试任务三')
    api.selectOther()
    expect(saves).toHaveLength(1)
    expect(isCreate(saves[0])).toBe(true)
    expect(saves[0].title).toBe('测试任务三')
  })

  it('4. 切换视图导致面板卸载 —— 自动创建 1 条', () => {
    const { api, saves } = renderPanel(PHANTOM)
    typeTitle('测试任务四')
    api.unmountPanel()
    expect(saves).toHaveLength(1)
    expect(isCreate(saves[0])).toBe(true)
    expect(saves[0].title).toBe('测试任务四')
  })

  it('5. 点「保存」—— 只创建 1 条，cleanup 不重复提交', () => {
    const { saves } = renderPanel(PHANTOM)
    typeTitle('测试任务五')
    fireEvent.click(screen.getByText('保存'))
    expect(saves).toHaveLength(1)
    expect(isCreate(saves[0])).toBe(true)
    expect(saves[0].title).toBe('测试任务五')
  })

  it('6. Ctrl+Enter —— 只创建 1 条', () => {
    const { saves } = renderPanel(PHANTOM)
    typeTitle('测试任务六')
    fireEvent.keyDown(titleBox(), { key: 'Enter', ctrlKey: true })
    expect(saves).toHaveLength(1)
    expect(isCreate(saves[0])).toBe(true)
    expect(saves[0].title).toBe('测试任务六')
  })

  it('7. 点删除 —— 不产生任何保存/创建', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { deletes, saves } = renderPanel(makeTodo())
    fireEvent.click(screen.getByText('删除'))
    expect(deletes).toEqual(['real-1'])
    expect(saves).toHaveLength(0)
  })

  it('8. 真实任务打开后未改动直接关 —— 不发 update', () => {
    const { saves } = renderPanel(makeTodo())
    fireEvent.click(screen.getByTitle('关闭'))
    expect(saves).toHaveLength(0)
  })

  it('9. 真实任务改标题后点另一个待办 —— 发 1 次 update', () => {
    const { api, saves } = renderPanel(makeTodo())
    typeTitle('改过的标题')
    api.selectOther()
    expect(saves).toHaveLength(1)
    expect(isCreate(saves[0])).toBe(false)
    expect(saves[0].id).toBe('real-1')
    expect(saves[0].title).toBe('改过的标题')
  })

  it('10. 幻影未输入标题就切走 —— 不建空任务', () => {
    const { api, saves } = renderPanel(PHANTOM)
    api.selectOther()
    expect(saves).toHaveLength(0)
  })

  it('11. 连续切换 A → B → C 不漏保存', () => {
    const { api, saves } = renderPanel(makeTodo())
    typeTitle('改过的 A')
    api.selectOther() // → B
    typeTitle('改过的 B')
    api.selectNone() // → null
    expect(saves).toHaveLength(2)
    expect(saves[0].id).toBe('real-1')
    expect(saves[0].title).toBe('改过的 A')
    expect(saves[1].id).toBe('real-2')
    expect(saves[1].title).toBe('改过的 B')
  })
})
