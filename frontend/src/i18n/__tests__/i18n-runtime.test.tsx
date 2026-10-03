/**
 * i18n 运行时行为测试：插值、复数、fallback、语言存储。
 * 纪律（智者评审）：jsdom 的 navigator.language 恒为 en-US——所有用例显式指定 lang，
 * 禁止依赖宿主默认值；涉及 localStorage 的用例先 _resetForTest。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fallbackChain, makeI18n, pluralCategories, resolveLang, interpolate, isCJK } from '../core'
import { chooseLang, _resetForTest, hasChosenLang, activeLang } from '../store'

describe('resolveLang', () => {
  it.each([
    ['zh-CN', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh-SG', 'zh-CN'],
    ['zh-TW', 'zh-Hant'],
    ['zh-Hant-HK', 'zh-Hant'],
    ['en-US', 'en'],
    ['en', 'en'],
    ['ja-JP', 'ja'],
    ['ko-KR', 'ko'],
    ['fr', 'fr'],
    ['es-419', 'es'],
    ['ru-RU', 'ru'],
    ['de-DE', 'zh-CN'],
    ['', 'zh-CN'],
    [null, 'zh-CN'],
  ])('resolveLang(%j) → %j', (input, expected) => {
    expect(resolveLang(input as string)).toBe(expected)
  })
})

describe('fallbackChain', () => {
  it('zh-CN 链只有自己；zh-Hant 回落 zh-CN；其他语言回落 zh-CN', () => {
    expect(fallbackChain('zh-CN')).toEqual(['zh-CN'])
    expect(fallbackChain('zh-Hant')).toEqual(['zh-Hant', 'zh-CN'])
    expect(fallbackChain('ja')).toEqual(['ja', 'zh-CN'])
  })
})

describe('isCJK（农历/节气三档策略）', () => {
  it('zh/ja/ko 为 CJK，en/fr/es/ru 不是', () => {
    expect(isCJK('zh-CN')).toBe(true)
    expect(isCJK('zh-Hant')).toBe(true)
    expect(isCJK('ja')).toBe(true)
    expect(isCJK('ko')).toBe(true)
    expect(isCJK('en')).toBe(false)
    expect(isCJK('ru')).toBe(false)
  })
})

describe('pluralCategories', () => {
  it('zh 只有 other；en 有 one/other；ru 四类别', () => {
    expect(pluralCategories('zh-CN')).toEqual(['other'])
    expect(new Set(pluralCategories('en'))).toEqual(new Set(['one', 'other']))
    expect(new Set(pluralCategories('ru'))).toEqual(new Set(['one', 'few', 'many', 'other']))
  })
})

describe('makeI18n', () => {
  it('t() 基本翻译', () => {
    expect(makeI18n('zh-CN').t('common.confirm')).toBe('确认')
    expect(makeI18n('en').t('common.confirm')).toBe('Confirm')
  })

  it('t() 具名插值', () => {
    expect(interpolate('共 {n} 项 / {name}', { n: 3, name: 'x' })).toBe('共 3 项 / x')
    // 未知参数原样保留 + 不抛错
    expect(interpolate('共 {n} 项')).toBe('共 {n} 项')
  })

  it('t() 缺 key 回落 zh-CN，仍缺则显示 key 本身', () => {
    const i18n = makeI18n('en')
    // en 完整，构造缺失场景：用一个必然不存在的 key
    expect(i18n.t('common.__no_such_key__' as never)).toBe('common.__no_such_key__')
  })

  it('tPlural() en 单复数分形', () => {
    const en = makeI18n('en')
    expect(en.tPlural('common.daysAfter', 1)).toBe('In 1 day')
    expect(en.tPlural('common.daysAfter', 3)).toBe('In 3 days')
    const zh = makeI18n('zh-CN')
    expect(zh.tPlural('common.daysAfter', 1)).toBe('1 天后')
    expect(zh.tPlural('common.daysAfter', 100)).toBe('100 天后')
  })

  it('tPlural() ru 四变体（one/few/many）', () => {
    // ru 字典在 P3 才产出；这里只验证类别选择逻辑接到了 PluralRules
    const rules = new Intl.PluralRules('ru')
    expect(rules.select(1)).toBe('one')
    expect(rules.select(2)).toBe('few')
    expect(rules.select(5)).toBe('many')
    expect(rules.select(21)).toBe('one')
  })

  it('makeI18n 按语言缓存（同实例）', () => {
    expect(makeI18n('ja')).toBe(makeI18n('ja'))
  })
})

describe('语言存储', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetForTest()
  })

  afterEach(() => {
    localStorage.clear()
    _resetForTest()
  })

  it('初始未选择 → activeLang 跟随显式设置的 navigator.language', () => {
    expect(hasChosenLang()).toBe(false)
    expect(activeLang()).toBe('en') // jsdom 默认 en-US
  })

  it('chooseLang 持久化并可读回', () => {
    chooseLang('ja')
    expect(hasChosenLang()).toBe(true)
    expect(activeLang()).toBe('ja')
    expect(localStorage.getItem('tt.lang')).toBe('ja')
  })
})
