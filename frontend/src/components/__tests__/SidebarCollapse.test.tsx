/**
 * 侧栏默认折叠（20261120 用户反馈：第一次打开左侧铺满十几个图层，主次全乱）。
 *
 * 这里只守两条行为契约：
 *  1. 首次进入（localStorage 没有记录）时，分组默认是收起的；
 *  2. 点一下标题能展开，且这个选择会被记住。
 * 展开动画本身交给 framer-motion，不在单测里断言中间帧。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Sidebar } from '../Sidebar'
import { CalendarThemeProvider } from '../../lib/calendar-theme'

const api = vi.hoisted(() => ({
  getSubscriptions: vi.fn(async () => []),
  getTodoBusyConfig: vi.fn(async () => null),
  createLayer: vi.fn(),
}))

vi.mock('../../api/client', () => api)
// 翻译层与主题对这次断言无关，统一退化成「返回 key 本身」，避免测试绑死文案。
vi.mock('../../i18n', () => ({
  useT: () => (key: string) => key,
}))

const LAYERS = [
  { layer_id: 'important', display_name: '重要日期', color: '#e11', kind: 'color', group: null, enabled: true, sort_order: 1, config: null },
  { layer_id: 'coloring', display_name: '充实度染色', color: '#3a3', kind: 'color', group: null, enabled: false, sort_order: 2, config: null },
  { layer_id: 'work', display_name: '工作', color: '#36f', kind: 'dot', group: '日程', enabled: true, sort_order: 10, config: null },
] as never[]

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <CalendarThemeProvider>
        <Sidebar layers={LAYERS} onToggle={() => {}} countdown="…" />
      </CalendarThemeProvider>
    </QueryClientProvider>,
  )
}

function kindButtons() {
  return [...document.querySelectorAll('aside button[aria-expanded]')] as HTMLButtonElement[]
}

describe('Sidebar 默认折叠', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('首次进入时分组全部收起，图层不直接铺出来', async () => {
    mount()
    // 默认收起是在 effect 里补的（要等图层到齐才知道有哪些分组），所以等一拍
    await waitFor(() => {
      const buttons = kindButtons()
      expect(buttons.length).toBeGreaterThan(0)
      expect(buttons.every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true)
    })
    expect(screen.queryByText('layers.important')).toBeNull()
  })

  it('点标题展开后能看到图层，并把选择写进 localStorage', () => {
    mount()
    const colorKind = kindButtons().find((b) => b.textContent?.includes('shell.kind.color'))!
    fireEvent.click(colorKind)

    expect(colorKind.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('layers.important')).toBeTruthy()

    const saved = JSON.parse(localStorage.getItem('sidebar_collapsed_v2') || '{}')
    expect(saved['kind:color']).toBe(false)
  })

  it('已有记录时尊重用户的展开状态，不重新收起', () => {
    localStorage.setItem('sidebar_collapsed_v2', JSON.stringify({ 'kind:color': false }))
    mount()
    const colorKind = kindButtons().find((b) => b.textContent?.includes('shell.kind.color'))!
    expect(colorKind.getAttribute('aria-expanded')).toBe('true')
  })
})
