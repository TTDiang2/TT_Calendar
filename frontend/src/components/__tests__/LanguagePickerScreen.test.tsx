import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppGate } from '../../AppGate'
import { LanguagePickerScreen } from '../LanguagePickerScreen'
import { hasChosenLang } from '../../i18n'
import { _resetForTest } from '../../i18n/store'

describe('LanguagePickerScreen（P2 首启动选择页）', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetForTest()
  })

  // vitest 未开 globals：RTL 自动清理不生效，必须显式 cleanup（否则跨用例 DOM 留存）
  afterEach(() => {
    cleanup()
  })

  it('渲染 8 语言 endonym+示例句（本体数据不走翻译）', () => {
    render(<LanguagePickerScreen />)
    expect(screen.getByText('简体中文')).toBeTruthy()
    expect(screen.getByText('繁體中文')).toBeTruthy()
    expect(screen.getByText('English')).toBeTruthy()
    expect(screen.getByText('日本語')).toBeTruthy()
    expect(screen.getByText('한국어')).toBeTruthy()
    expect(screen.getByText('Français')).toBeTruthy()
    expect(screen.getByText('Español')).toBeTruthy()
    expect(screen.getByText('Русский')).toBeTruthy()
  })
})

describe('AppGate 门控（门3 条件1：纯 UI 路径，必须穿过「开始使用」按钮）', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetForTest()
  })

  afterEach(() => {
    cleanup()
  })

  function mountGate() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <AppGate />
      </QueryClientProvider>,
    )
  }

  it('未确认 → 选择页（App 不挂载）', () => {
    mountGate()
    expect(hasChosenLang()).toBe(false)
    expect(screen.getByText('开始使用')).toBeTruthy()
  })

  it('纯 UI 确认流：点「日本語」→点「开始使用」→ tt.lang 持久化+选择页消失（App 分支挂载）', () => {
    mountGate()
    fireEvent.click(screen.getByText('日本語'))
    fireEvent.click(screen.getByText('开始使用'))
    expect(hasChosenLang()).toBe(true)
    expect(localStorage.getItem('tt.lang')).toBe('ja')
    // 选择页退场 = AppGate 切到 App 分支（删掉按钮 onClick 本用例必红）
    expect(screen.queryByText('开始使用')).toBeNull()
  })
})
