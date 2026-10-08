import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppGate } from '../../AppGate'
import { LanguagePickerScreen } from '../LanguagePickerScreen'
import { hasChosenLang, LANG_META, PENDING_TRANSLATIONS, SELECTABLE_LANGS } from '../../i18n'
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

  it('只渲染「已有字典」的语言（endonym+示例句走本体数据，不走翻译）', () => {
    render(<LanguagePickerScreen />)
    for (const lang of SELECTABLE_LANGS) {
      expect(screen.getByText(LANG_META[lang].endonym)).toBeTruthy()
    }
    // 台账 PENDING 的语言暂无字典，不得作为选项出现（选了只会回落中文）
    expect(SELECTABLE_LANGS).toEqual(['zh-CN', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'es', 'ru'])
    for (const lang of PENDING_TRANSLATIONS) {
      expect(screen.queryByText(LANG_META[lang].endonym)).toBeNull()
    }
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
    expect(screen.getByRole('radiogroup')).toBeTruthy()          // 选择页在
    expect(screen.queryByRole('button', { name: /开始使用|Get started|始める/ })).toBeTruthy()
  })

  it('纯 UI 确认流：点「日本語」→点「开始使用」→ tt.lang 持久化+选择页消失（App 分支挂载）', () => {
    mountGate()
    fireEvent.click(screen.getByText('日本語'))
    // 按钮文案随所选语言（ja）变化 → 按唯一 button role 定位（语言无关）
    const btns = screen.getAllByRole('button')
    const startBtn = btns.find(b => /開始使用|Get started|はじめる|始める|시작하기|Commencer|Empezar|Начать|Empezar/.test(b.textContent || ''))
    if (!startBtn) throw new Error('start button not found')
    fireEvent.click(startBtn)
    expect(hasChosenLang()).toBe(true)
    expect(localStorage.getItem('tt.lang')).toBe('ja')
    // 选择页退场 = AppGate 切到 App 分支（删掉按钮 onClick 本用例必红）
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })
})
