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

  it('当前可选语言恰为全部 8 种已产出语言', () => {
    expect([...SELECTABLE_LANGS]).toEqual(['zh-CN', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'es', 'ru'])
  })
})

describe('store 语言快照', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetForTest()
  })
  afterEach(() => {
    _resetForTest()
  })

  it('chooseLang 接受每种可选语言并落盘', () => {
    for (const lang of SELECTABLE_LANGS) {
      chooseLang(lang)
      expect(localStorage.getItem('tt.lang')).toBe(lang)
      expect(activeLang()).toBe(lang)
    }
  })

  it('chooseLang 拒绝无字典语言（不写 localStorage、不改生效语言）', () => {
    // 8 种语言现已全部产出，用临时摘掉字典来真实触发这条守卫（防「新增语言忘配字典」回归）
    const held = DICTS.fr
    delete DICTS.fr
    try {
      expect(isLangAvailable('fr')).toBe(false)
      chooseLang('zh-CN')
      chooseLang('fr')
      expect(localStorage.getItem('tt.lang')).toBe('zh-CN')
      expect(activeLang()).toBe('zh-CN')
    } finally {
      DICTS.fr = held as NonNullable<typeof held>
    }
  })

  it('localStorage 里的每个可选语言都照常生效', async () => {
    for (const lang of SELECTABLE_LANGS) {
      localStorage.setItem('tt.lang', lang)
      vi.resetModules() // 让 store 模块级 chosen = readStored() 重新执行
      const store = await import('../store')
      expect(store.activeLang()).toBe(lang)
    }
  })

  it('系统语言有字典时原样跟随', () => {
    const orig = navigator.language
    const setLang = (v: string) =>
      Object.defineProperty(navigator, 'language', { value: v, configurable: true })
    try {
      setLang('fr-FR')
      expect(systemLang()).toBe('fr')
      setLang('ru-RU')
      expect(systemLang()).toBe('ru')
      setLang('zh-Hant-HK')
      expect(systemLang()).toBe('zh-Hant')
      setLang('ja-JP')
      expect(systemLang()).toBe('ja')
      setLang('en-US')
      expect(systemLang()).toBe('en')
    } finally {
      setLang(orig)
    }
  })

  it('系统语言无字典或无法识别时回落中文，绝不空白', () => {
    const orig = navigator.language
    const setLang = (v: string) =>
      Object.defineProperty(navigator, 'language', { value: v, configurable: true })
    const held = DICTS.ru
    delete DICTS.ru
    try {
      setLang('ru-RU')
      expect(systemLang()).toBe('zh-CN')
      setLang('xx-XX') // 完全不认识的标签（与上一行「标签可识别但字典缺席」是两条分支）
      expect(systemLang()).toBe('zh-CN')
    } finally {
      DICTS.ru = held as NonNullable<typeof held>
      setLang(orig)
    }
  })
})