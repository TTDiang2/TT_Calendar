/**
 * 日历新建弹窗（DayEntryDialog）回归测试
 *
 * 覆盖三件事，都是容易悄悄坏掉的组合逻辑：
 *   1. 多日日程必须存成 1 条（date + end_date），而不是按天建 N 条
 *   2. 自动建待办：列表不存在要先建「日程待办」，存在则复用；多日只建 1 条
 *      （计划 = 首日、截止 = 末日）
 *   3. 涂色多日是按天写 marks（涂色没有「跨天」概念，每天都要有标记）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DayEntryDialog } from '../dialogs'
import type { Layer } from '../../types'
import {
  createScheduleItem,
  createEvent,
  createTodo,
  createTodoList,
  getTodoLists,
  upsertColoring,
  upsertMark,
} from '../../api/client'

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return {
    ...actual,
    createScheduleItem: vi.fn(),
    createEvent: vi.fn(),
    createTodo: vi.fn(),
    createTodoList: vi.fn(),
    getTodoLists: vi.fn(),
    upsertColoring: vi.fn(),
    upsertMark: vi.fn(),
  }
})

const LAYERS: Layer[] = [
  {
    layer_id: 'dot_work', display_name: '工作日程', enabled: true, color: '#3D6BFB',
    sort_order: 11, kind: 'dot', group: '自定义', config: { category: 'work' },
  },
  {
    layer_id: 'dot_other', display_name: '纪念日', enabled: true, color: '#E91E63',
    sort_order: 12, kind: 'dot', group: '自定义', config: {},
  },
  {
    layer_id: 'coloring', display_name: '充实度', enabled: true, color: null,
    sort_order: 3, kind: 'color', group: null, config: { mode: 'graded' },
  },
  {
    layer_id: 'custom_gym', display_name: '健身打卡', enabled: true, color: '#4CAF50',
    sort_order: 20, kind: 'color', group: '自定义', config: { mode: 'solid' },
  },
]

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(createScheduleItem).mockImplementation(async (i) => ({ ...i, id: 1 }))
  vi.mocked(createEvent).mockImplementation(async (e) => ({ ...e, id: 1 }))
  vi.mocked(upsertMark).mockResolvedValue({ ok: true } as never)
  vi.mocked(upsertColoring).mockResolvedValue({ ok: true } as never)
  vi.mocked(createTodo).mockImplementation(async (d) => ({
    id: 'todo-1', list_id: d.list_id, title: d.title, body: d.body ?? null,
    status: 'notStarted', importance: 'normal', due_date: d.due_date ?? null,
    planned_date: d.planned_date ?? null, start_date: null, complexity: 'medium',
    tags: null, created_at: null, completed_at: null, sort_order: 0,
  }))
  vi.mocked(createTodoList).mockImplementation(async (display_name) => ({
    id: 'list-schedule', display_name, sort_order: 0, created_at: null,
  }))
})

function renderDialog(date: string, initialKind: 'dot' | 'color' = 'dot') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <DayEntryDialog date={date} layers={LAYERS} initialKind={initialKind} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose }
}

const contentBox = () => screen.getByPlaceholderText('做什么') as HTMLTextAreaElement
const startDateBox = () => screen.getByLabelText('开始日期') as HTMLInputElement
const endDateBox = () => screen.getByLabelText('结束日期（可选，填了就是多日）') as HTMLInputElement
const autoTodoBox = () => screen.getByRole('checkbox', { name: /同时创建对应待办/ }) as HTMLInputElement
const addButton = () => screen.getByRole('button', { name: /添加|保存中/ }) as HTMLButtonElement
const layerSelect = () => screen.getByLabelText('选择图层') as HTMLSelectElement
const colorLayerSelect = () => screen.getByLabelText('选择涂色图层') as HTMLSelectElement

describe('DayEntryDialog 多日日程', () => {
  it('1. 多日日程存成 1 条（date + end_date），不是按天建 N 条', async () => {
    renderDialog('2026-09-03')
    fireEvent.change(contentBox(), { target: { value: '出差' } })
    fireEvent.change(endDateBox(), { target: { value: '2026-09-05' } })

    expect(screen.getByText(/共 3 天/)).toBeTruthy()
    fireEvent.click(addButton())

    await waitFor(() => expect(createScheduleItem).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(createScheduleItem).mock.calls[0]![0]
    expect(payload.date).toBe('2026-09-03')
    expect(payload.end_date).toBe('2026-09-05')
    expect(createEvent).not.toHaveBeenCalled()
  })

  it('2. 单日不写 end_date', async () => {
    renderDialog('2026-09-03')
    fireEvent.change(contentBox(), { target: { value: '开会' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(createScheduleItem).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(createScheduleItem).mock.calls[0]![0]
    expect(payload.end_date).toBeNull()
  })

  it('3. 非日程类点点图层（events）：多日按天建 N 条事件', async () => {
    renderDialog('2026-09-03')
    fireEvent.change(layerSelect(), { target: { value: 'dot_other' } })
    fireEvent.change(contentBox(), { target: { value: '纪念日' } })
    fireEvent.change(endDateBox(), { target: { value: '2026-09-05' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(3))
    const dates = vi.mocked(createEvent).mock.calls.map((c) => c[0].date)
    expect(dates).toEqual(['2026-09-03', '2026-09-04', '2026-09-05'])
    expect(createScheduleItem).not.toHaveBeenCalled()
  })
})

describe('DayEntryDialog 自动建待办', () => {
  it('4. 勾选后建 1 条待办：计划 = 首日，截止 = 末日', async () => {
    vi.mocked(getTodoLists).mockResolvedValue([{ id: 'list-1', display_name: '日程待办', sort_order: 0, created_at: null }])
    renderDialog('2026-09-03')
    fireEvent.change(contentBox(), { target: { value: '出差' } })
    fireEvent.change(endDateBox(), { target: { value: '2026-09-05' } })
    expect(autoTodoBox().checked).toBe(false) // 默认不勾（opt-in）
    fireEvent.click(autoTodoBox())
    expect(autoTodoBox().checked).toBe(true)

    fireEvent.click(addButton())

    await waitFor(() => expect(createTodo).toHaveBeenCalledTimes(1))
    const todo = vi.mocked(createTodo).mock.calls[0]![0]
    expect(todo.list_id).toBe('list-1')
    expect(todo.title).toBe('出差')
    expect(todo.planned_date).toBe('2026-09-03')
    expect(todo.due_date).toBe('2026-09-05')
  })

  it('5a. 「日程待办」列表不存在时自动创建', async () => {
    vi.mocked(getTodoLists).mockResolvedValue([{ id: 'list-1', display_name: '别的列表', sort_order: 0, created_at: null }])
    renderDialog('2026-09-03')
    fireEvent.change(contentBox(), { target: { value: '写周报' } })
    fireEvent.click(autoTodoBox())
    fireEvent.click(addButton())
    await waitFor(() => expect(createTodoList).toHaveBeenCalledWith('日程待办'))
    expect(vi.mocked(createTodo).mock.calls[0]![0].list_id).toBe('list-schedule')
  })

  it('5b. 「日程待办」列表已存在则复用，不重复创建', async () => {
    vi.mocked(getTodoLists).mockResolvedValue([{ id: 'list-9', display_name: '日程待办', sort_order: 0, created_at: null }])
    renderDialog('2026-09-03')
    fireEvent.change(contentBox(), { target: { value: '写周报' } })
    fireEvent.click(autoTodoBox())
    fireEvent.click(addButton())
    await waitFor(() => expect(createTodo).toHaveBeenCalledTimes(1))
    expect(createTodoList).not.toHaveBeenCalled()
    expect(vi.mocked(createTodo).mock.calls[0]![0].list_id).toBe('list-9')
  })

  it('6. 默认不勾选则不建待办', async () => {
    renderDialog('2026-09-03')
    fireEvent.change(contentBox(), { target: { value: '只是记一笔' } })
    expect(autoTodoBox().checked).toBe(false)
    fireEvent.click(addButton())

    await waitFor(() => expect(createScheduleItem).toHaveBeenCalledTimes(1))
    expect(createTodo).not.toHaveBeenCalled()
  })

  it('7. 待办勾选偏好写入 localStorage，下次打开保持', async () => {
    renderDialog('2026-09-03')
    fireEvent.click(autoTodoBox()) // 勾上
    expect(localStorage.getItem('day-entry:auto-todo')).toBe('1')
    cleanup()

    vi.mocked(getTodoLists).mockResolvedValue([{ id: 'list-1', display_name: '日程待办', sort_order: 0, created_at: null }])
    renderDialog('2026-09-04')
    expect(autoTodoBox().checked).toBe(true) // 偏好保持
    fireEvent.change(contentBox(), { target: { value: '带待办' } })
    fireEvent.click(addButton())
    await waitFor(() => expect(createTodo).toHaveBeenCalledTimes(1))
  })
})

describe('DayEntryDialog 涂色', () => {
  it('8. 涂色多日：按天写 marks（涂色没有跨天概念）', async () => {
    renderDialog('2026-09-03', 'color')
    fireEvent.change(colorLayerSelect(), { target: { value: 'custom_gym' } })
    fireEvent.change(endDateBox(), { target: { value: '2026-09-05' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(upsertMark).toHaveBeenCalledTimes(3))
    const dates = vi.mocked(upsertMark).mock.calls.map((c) => c[1])
    expect(dates).toEqual(['2026-09-03', '2026-09-04', '2026-09-05'])
  })

  it('9. 充实度多日：按天写 coloring', async () => {
    renderDialog('2026-09-03', 'color')
    fireEvent.change(endDateBox(), { target: { value: '2026-09-04' } })
    fireEvent.click(addButton())

    await waitFor(() => expect(upsertColoring).toHaveBeenCalledTimes(2))
  })
})

describe('DayEntryDialog 校验', () => {
  it('10. 结束日期早于开始日期 → 保存按钮禁用', () => {
    renderDialog('2026-09-03')
    fireEvent.change(contentBox(), { target: { value: '倒挂测试' } })
    fireEvent.change(endDateBox(), { target: { value: '2026-09-01' } })

    expect(screen.getByText('结束日期不能早于开始日期')).toBeTruthy()
    expect(addButton().disabled).toBe(true)
    expect(createScheduleItem).not.toHaveBeenCalled()
  })

  it('11. 点点模式没填内容 → 保存按钮禁用', () => {
    renderDialog('2026-09-03')
    expect(addButton().disabled).toBe(true)
    fireEvent.change(contentBox(), { target: { value: '有内容了' } })
    expect(addButton().disabled).toBe(false)
  })
})
