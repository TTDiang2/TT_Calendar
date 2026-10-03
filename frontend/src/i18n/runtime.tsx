/**
 * i18n React 层：I18nProvider + useT/useTPlural/useI18n。
 * Provider 订阅语言 store（chooseLang 触发全树重渲染、即时生效、无需刷新页面）。
 * 无 Provider 的测试环境回落到按 activeLang() 的惰性单例（非响应式，够用）。
 */
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { activeLang, hasChosenLang, onLangChange } from './store'
import { makeI18n, type I18n } from './core'

const I18nCtx = createContext<I18n | null>(null)

// 无 Provider 的回落（只有旧测试/边角场景会走到）：固定 zh-CN，保证存量测试的
// 中文断言不因宿主 navigator.language（jsdom 恒 en-US）而翻转。
// 真实运行时语言由 App 挂的 I18nProvider（activeLang()）决定。
let providerlessFallback: I18n | null = null

export function I18nProvider({ children }: { children: ReactNode }) {
  // activeLang 变化（chooseLang / 首次选择）→ 整树换语言
  const lang = useSyncExternalStore(onLangChange, activeLang, () => activeLang())
  const value = useMemo(() => makeI18n(lang), [lang])
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export function useI18n(): I18n {
  const v = useContext(I18nCtx)
  if (v) return v
  if (!providerlessFallback) providerlessFallback = makeI18n('zh-CN')
  return providerlessFallback
}

/** 翻译函数。t('key') / t('key', { n: 3 })；key 写错是编译错误。 */
export function useT(): I18n['t'] {
  return useI18n().t
}

/** 复数翻译。tPlural('key', n)（{n} 自动注入）。 */
export function useTPlural(): I18n['tPlural'] {
  return useI18n().tPlural
}

/** 当前语言（做 CJK 分档、日期 locale 时用）。 */
export function useLang(): I18n['lang'] {
  return useI18n().lang
}

/** 是否已完成首次语言选择（响应式：chooseLang 后视图自动切到主界面）。 */
export function useHasChosenLang(): boolean {
  return useSyncExternalStore(onLangChange, hasChosenLang, () => hasChosenLang())
}
