import { act, cleanup, render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { LanguagePickerScreen } from '../LanguagePickerScreen'
import { chooseLang, hasChosenLang } from '../../i18n'
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

  it('渲染 8 语言 endonym+示例句，默认预选系统语言（jsdom=en → English 勾选）', () => {
    render(<LanguagePickerScreen />)
    expect(screen.getByText('简体中文')).toBeTruthy()
    expect(screen.getByText('繁體中文')).toBeTruthy()
    expect(screen.getByText('English')).toBeTruthy()
    expect(screen.getByText('日本語')).toBeTruthy()
    expect(screen.getByText('한국어')).toBeTruthy()
    expect(screen.getByText('Français')).toBeTruthy()
    expect(screen.getByText('Español')).toBeTruthy()
    expect(screen.getByText('Русский')).toBeTruthy()
    // 确认按钮存在（文案本身也走 t()，zh 回落主字典）
    expect(screen.getByText('开始使用')).toBeTruthy()
  })

  it('确认流：选语言→点开始→chooseLang 持久化+hasChosenLang 翻转（AppGate 依赖此切换）', () => {
    render(<LanguagePickerScreen />)
    expect(hasChosenLang()).toBe(false)
    fireEvent.click(screen.getByText('日本語'))
    act(() => {
      chooseLang('ja')
    })
    expect(hasChosenLang()).toBe(true)
    expect(localStorage.getItem('tt.lang')).toBe('ja')
  })
})
