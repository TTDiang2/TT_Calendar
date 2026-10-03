/**
 * i18n 核心（框架无关）：语言解析、fallback 链、复数、插值、t()/tPlural()。
 * React 层（runtime.tsx）只是把它接进 Context；通知/启动日志等非 React 场景
 * 直接 makeI18n(lang) 使用。
 *
 * 设计约束（2026-09-30 本地化任务书，智者评审定稿）：
 *  - fallback 链终点是 zh-CN（唯一人工可验证完整性的主字典），不是 en；
 *  - 插值只用具名参数 {name}，禁止位置参数（各语言词序不同）；
 *  - 复数走 Intl.PluralRules，类别后缀存字典；缺类别回落 other；
 *  - 缺 key：开发环境 console.warn 一次，生产静默回落。
 */
import { DICTS } from './dict/index'
import type { Dict } from './dict/zh-CN'
import { isPluralEntry, type PluralEntry } from './dict/types'
import type { PluralKey, TxKey } from './keys'

export type Lang = 'zh-CN' | 'zh-Hant' | 'en' | 'ja' | 'ko' | 'fr' | 'es' | 'ru'

export const LANGS: readonly Lang[] = ['zh-CN', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'es', 'ru']

/** 语言选择器的显示信息：endonym 与示例句是各语言的「本体数据」，永不走翻译 */
export const LANG_META: Record<Lang, { endonym: string; sample: string }> = {
  'zh-CN': { endonym: '简体中文', sample: '把重要的事都记在这里' },
  'zh-Hant': { endonym: '繁體中文', sample: '把重要的事都記在這裡' },
  en: { endonym: 'English', sample: 'Keep everything that matters' },
  ja: { endonym: '日本語', sample: '大事なことを、ここに。' },
  ko: { endonym: '한국어', sample: '중요한 일을 모두 여기에' },
  fr: { endonym: 'Français', sample: 'Gardez ce qui compte' },
  es: { endonym: 'Español', sample: 'Guarda lo que importa' },
  ru: { endonym: 'Русский', sample: 'Всё важное — в одном месте' },
}

/** 系统语言标签 → 支持的语言。精确匹配 → 主语言匹配 → zh-CN 兜底（绝不出现空白 UI）。 */
export function resolveLang(input: string | null | undefined): Lang {
  if (!input) return 'zh-CN'
  const tag = input.trim().toLowerCase()
  if (!tag) return 'zh-CN'
  // 全匹配 + 常见别名（zh 的 region/Hans-Hant 写法最多）
  const exact: Record<string, Lang> = {
    zh: 'zh-CN',
    'zh-cn': 'zh-CN',
    'zh-hans': 'zh-CN',
    'zh-sg': 'zh-CN',
    'zh-my': 'zh-CN',
    'zh-hant': 'zh-Hant',
    'zh-tw': 'zh-Hant',
    'zh-hk': 'zh-Hant',
    'zh-mo': 'zh-Hant',
    en: 'en',
    ja: 'ja',
    jp: 'ja',
    ko: 'ko',
    kr: 'ko',
    fr: 'fr',
    es: 'es',
    ru: 'ru',
  }
  if (exact[tag]) return exact[tag]
  // 含 script/region 提示的复合标签（如 zh-Hant-HK、zh-Hans-SG）先按 script 判定
  if (tag.startsWith('zh-')) {
    if (tag.includes('hant') || /-(tw|hk|mo)\b/.test(tag)) return 'zh-Hant'
    if (tag.includes('hans')) return 'zh-CN'
  }
  const primary = tag.split(/[-_]/)[0]
  if (exact[primary]) return exact[primary]
  return 'zh-CN'
}

/** fallback 链：自身 → 基础语言 → zh-CN（去重）。 */
export function fallbackChain(lang: Lang): readonly Lang[] {
  switch (lang) {
    case 'zh-CN':
      return ['zh-CN']
    case 'zh-Hant':
      return ['zh-Hant', 'zh-CN']
    default:
      return [lang, 'zh-CN']
  }
}

/** 农历/节气显示的三档策略用：中日韩语言（ja/ko 翻译显示，zh 全量汉字）。 */
export function isCJK(lang: Lang): boolean {
  return lang === 'zh-CN' || lang === 'zh-Hant' || lang === 'ja' || lang === 'ko'
}

// ── 复数 ────────────────────────────────────────────────────────────────────

const pluralRulesCache = new Map<Lang, Intl.PluralRules>()

function pluralRules(lang: Lang): Intl.PluralRules {
  let r = pluralRulesCache.get(lang)
  if (!r) {
    r = new Intl.PluralRules(lang)
    pluralRulesCache.set(lang, r)
  }
  return r
}

const categoriesCache = new Map<Lang, readonly string[]>()

/**
 * 该语言在合理数值范围内会出现哪些复数类别。
 * 采样 0..1500 加 10 的幂（覆盖 fr 的 many ≥1e6 等 CLDR 规则），结果缓存。
 * 结构测试用同一函数做「复数 key 全类别齐全」校验。
 */
export function pluralCategories(lang: Lang): readonly string[] {
  let cats = categoriesCache.get(lang)
  if (!cats) {
    const rules = pluralRules(lang)
    const set = new Set<string>(['other']) // other 是 CLDR 通用兜底类别（ru 等语言的 other 只用于小数，整数采样采不到）
    for (let n = 0; n <= 1500; n++) set.add(rules.select(n))
    for (const n of [1e3, 1e4, 1e5, 1e6, 1e9, 1e12, 1e15]) set.add(rules.select(n))
    cats = [...set]
    categoriesCache.set(lang, cats)
  }
  return cats
}

// ── 查找与插值 ──────────────────────────────────────────────────────────────

function lookup(dict: Dict | undefined, parts: readonly string[]): unknown {
  let node: unknown = dict
  for (const p of parts) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[p]
  }
  return node
}

function resolveValue(lang: Lang, key: string): unknown {
  for (const l of fallbackChain(lang)) {
    const v = lookup(DICTS[l], key.split('.'))
    if (v !== undefined) return v
  }
  return undefined
}

const warnedKeys = new Set<string>()

const DEV = typeof process !== 'undefined' && (process as { env?: Record<string, string | undefined> }).env?.NODE_ENV !== 'production'

function warnOnce(key: string, lang: Lang): void {
  if (!DEV || warnedKeys.has(key)) return
  warnedKeys.add(key)
  console.warn(`[i18n] missing key: "${key}" (lang=${lang}), fell back to zh-CN`)
}

export type TParams = Record<string, string | number>

export function interpolate(text: string, params?: TParams): string {
  if (!params) return text
  let missing: string | null = null
  const out = text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (name in params) return String(params[name])
    missing = name
    return whole
  })
  if (DEV && missing) console.warn(`[i18n] missing interpolation param: {${missing}} in "${text}"`)
  return out
}

export interface I18n {
  readonly lang: Lang
  t(key: TxKey, params?: TParams): string
  tPlural(key: PluralKey, n: number, params?: TParams): string
}

const i18nCache = new Map<Lang, I18n>()

/** makeI18n(lang)：按语言缓存；非 React 场景可反复调用无开销。 */
export function makeI18n(lang: Lang): I18n {
  let inst = i18nCache.get(lang)
  if (inst) return inst
  inst = {
    lang,
    t(key, params) {
      const v = resolveValue(lang, key)
      if (typeof v !== 'string') {
        // 复数条目/缺失都回落：显示 key 本身，dev 告警
        warnOnce(key, lang)
        return interpolate(key, params)
      }
      return interpolate(v, params)
    },
    tPlural(key, n, params) {
      const v = resolveValue(lang, key)
      if (!isPluralEntry(v)) {
        warnOnce(`${key}[*]`, lang)
        return interpolate(key, { ...params, n })
      }
      const cat = pluralRules(lang).select(n)
      const text = (v as PluralEntry)[cat as keyof PluralEntry] ?? v.other
      return interpolate(text, { ...params, n })
    },
  }
  i18nCache.set(lang, inst)
  return inst
}
