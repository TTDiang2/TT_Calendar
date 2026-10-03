/**
 * i18n 公共出口。
 * 组件内：useT()/useTPlural()/useLang()；非 React：makeI18n(lang)/activeLang()。
 */
export { resolveLang, fallbackChain, isCJK, pluralCategories, makeI18n, interpolate } from './core'
export type { Lang, I18n, TParams } from './core'
export { LANGS, LANG_META } from './core'
export {
  getChosenLang,
  systemLang,
  activeLang,
  chooseLang,
  hasChosenLang,
  onLangChange,
} from './store'
export { fmtDate, fmtWeekday, fmtMonthName, fmtNumber, fmtRelativeDays } from './format'
export { I18nProvider, useI18n, useT, useTPlural, useLang, useHasChosenLang } from './runtime'
export type { TxKey, PluralKey } from './keys'
export { DICTS } from './dict/index'
export type { Dict } from './dict/zh-CN'
export type { PluralEntry } from './dict/types'
