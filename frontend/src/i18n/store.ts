/**
 * 语言选择的状态存储（框架无关）：localStorage 持久化 + 订阅。
 * - null = 用户尚未选择语言（首启动）→ activeLang() 回落系统语言；
 * - chooseLang() 持久化并广播；I18nProvider 用 useSyncExternalStore 订阅，
 *   移动端壳用 onLangChange 同步 App Group / 重排通知。
 */
import { isLangAvailable, resolveLang, type Lang } from './core'

const LS_KEY = 'tt.lang'

let chosen: Lang | null = readStored()
const subs = new Set<() => void>()

function readStored(): Lang | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null
    if (!raw) return null
    const lang = resolveLang(raw)
    // 旧版本可能把「无字典」的语言写进来（UI 曾提供 fr/es/ru/zh-Hant 选项）：
    // 快照到 zh-CN 而不是 null——用户已做过选择，不必再弹一次语言选择页
    return isLangAvailable(lang) ? lang : 'zh-CN'
  } catch {
    return null
  }
}

export function getChosenLang(): Lang | null {
  return chosen
}

/** 系统语言（无 navigator 的测试/SSR 环境回落 zh-CN；jsdom 测试须显式传 locale，勿依赖此值）。 */
export function systemLang(): Lang {
  try {
    if (typeof navigator !== 'undefined' && navigator.language) {
      const lang = resolveLang(navigator.language)
      // 法语/俄语系统等：字典还没产出，快照到中文主字典，绝不出现空白 UI
      if (isLangAvailable(lang)) return lang
    }
  } catch {
    /* ignore */
  }
  return 'zh-CN'
}

/** 当前生效语言：用户选择优先，未选择时跟随系统。 */
export function activeLang(): Lang {
  return chosen ?? systemLang()
}

/** 用户确认语言（首启动选择页与设置页都走这里）。 */
export function chooseLang(lang: Lang): void {
  // 无字典的语言不接受：否则界面语言标记与实际渲染（回落中文）不一致，
  // 且会写入一个下拉框里不存在的值
  if (!isLangAvailable(lang)) return
  if (chosen === lang) return
  chosen = lang
  try {
    localStorage.setItem(LS_KEY, lang)
  } catch {
    /* 隐私模式等：只影响持久化，不影响本次会话 */
  }
  subs.forEach((fn) => fn())
}

/** 是否已完成首次语言选择（决定是否显示首启动语言选择页）。 */
export function hasChosenLang(): boolean {
  return chosen !== null
}

export function onLangChange(fn: () => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}

/** 测试专用：重置到「未选择」状态。 */
export function _resetForTest(): void {
  chosen = null
  try {
    localStorage.removeItem(LS_KEY)
  } catch {
    /* ignore */
  }
}
