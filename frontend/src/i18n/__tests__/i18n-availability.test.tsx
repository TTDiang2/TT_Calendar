/**
 * 语言可选性守门（20261008 用户实测修复配套）：
 *
 * 事故：core.ts 的 LANGS 声明了 8 种语言，dict/index.ts 只注册了 4 种（zh-CN/en/ja/ko）。
 * 首启动选择页与设置页都按 LANGS 渲染 → 繁中/法语/西语/俄语出现在 UI 上，
 * 但 t() 在 fallback 链里静默回落中文，用户点了界面毫无变化（"切不了"）。
 * 已发布的选择页/设置页还不止虚假选项：用户点过一次后 localStorage 里存的就是
 * 无字典语言，activeLang() 返回它 → <select> 的 value 匹配不到任何 option（显示空白）。
 *
 * 守门规则：
 *  1. 台账 PENDING_TRANSLATIONS === LANGS 中没有字典的语言（翻译产出后须同步移除）；
 *  2. SELECTABLE_LANGS 只能包含有字典的语言（UI 列表的真源）；
 *  3. store 层不得把无字典语言作为生效语言或写进 localStorage。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DICTS,
  LANGS,
  LANG_META,
  PENDING_TRANSLATIONS,
  SELECTABLE_LANGS,
  isLangAvailable,
} from '../index'
import { _resetForTest, activeLang, chooseLang, hasChosenLang, systemLang } from '../store'

describe('i18n 语言可选性', () => {
  it('台账 PENDING 清单 === LANGS 中缺字典的语言', () => {
    const missing = LANGS.filter((l) => !DICTS[l])
    expect([...missing].sort()).toEqual([...PENDING_TRANSLATIONS].sort())
  })

  it('PENDING 里的语言确实都缺字典（清单不是过时的）', () => {
    for (const lang of PENDING_TRANSLATIONS) {
      expect(isLangAvailable(lang)).toBe(false)
      expect(LANG_META[lang]).toBeTruthy() // 本体数据仍在，仅缺字典
    }
  })

  it('SELECTABLE_LANGS ⊆ LANGS 且每项都有字典', () => {
    for (const lang of SELECTABLE_LANGS) {
      expect(LANGS).toContain(lang)
      expect(isLangAvailable(lang)).toBe(true)
      expect(DICTS[lang]).toBeTruthy()
    }
  })

  it('当前可选语言恰为 4 种已产出语言', () => {
    expect([...SELECTABLE_LANGS]).toEqual(['zh-CN', 'en', 'ja', 'ko'])
  })
})

describe('store 语言快照：无字典语言不得生效', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetForTest()
  })
  afterEach(() => {
    _resetForTest()
  })

  it('chooseLang 拒绝无字典语言（不写 localStorage、不改生效语言）', () => {
    chooseLang('zh-CN')
    chooseLang('fr')
    expect(localStorage.getItem('tt.lang')).toBe('zh-CN')
    expect(activeLang()).toBe('zh-CN')
  })

  it('localStorage 里的旧无效值（fr）读取时快照到 zh-CN', async () => {
    // 旧版本 UI 提供过 fr 选项，用户点过一次就留下了 tt.lang=fr
    localStorage.setItem('tt.lang', 'fr')
    vi.resetModules() // 让 store 模块级 chosen = readStored() 重新执行
    const store = await import('../store')
    expect(store.activeLang()).toBe('zh-CN')
    expect(store.hasChosenLang()).toBe(true) // 不再弹一次语言选择页
    expect(store.getChosenLang()).toBe('zh-CN')
  })

  it('localStorage 里的有效值（ja）照常生效', async () => {
    localStorage.setItem('tt.lang', 'ja')
    vi.resetModules()
    const store = await import('../store')
    expect(store.activeLang()).toBe('ja')
  })

  it('系统语言无字典时快照到中文主字典，有字典时原样跟随', () => {
    const orig = navigator.language
    const setLang = (v: string) =>
      Object.defineProperty(navigator, 'language', { value: v, configurable: true })
    try {
      setLang('fr-FR')
      expect(systemLang()).toBe('zh-CN') // 法语无字典 → 中文，绝不空白
      setLang('ru-RU')
      expect(systemLang()).toBe('zh-CN')
      setLang('ja-JP')
      expect(systemLang()).toBe('ja') // 有字典 → 跟随系统
      setLang('en-US')
      expect(systemLang()).toBe('en')
    } finally {
      setLang(orig)
    }
  })
})