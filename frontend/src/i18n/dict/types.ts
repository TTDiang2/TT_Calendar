/**
 * i18n 字典的类型基建（2026-09-30 本地化任务书 P0）。
 *
 * 字典是纯嵌套对象：叶子为 string；复数条目是 PluralEntry（值为「类别 → 文案」）；
 * 其余节点是分组。分组名不得使用 other/one/two/few/many/zero（会被误判为复数条目）。
 */

/** CLDR 复数类别（cardinal）。zh/ja/ko 只有 other；en 有 one/other；ru 有 one/few/many/other。 */
export interface PluralEntry {
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
}

export function isPluralEntry(v: unknown): v is PluralEntry {
  return typeof v === 'object' && v !== null && typeof (v as PluralEntry).other === 'string'
}

/** 语言字典允许的结构（翻译产出可能落后于 zh-CN 主字典，故除复数 other 外均可缺省）。 */
export type DeepPartialDict<T> = {
  [K in keyof T]?: T[K] extends string
    ? string
    : T[K] extends PluralEntry
      ? Partial<PluralEntry>
      : DeepPartialDict<T[K]>
}

/** 复数条目 → 补齐 other 后的完整形态（结构测试要求全类别齐全，运行时也按此读取）。 */
export type ResolvedPlural = Required<PluralEntry>
