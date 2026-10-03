/**
 * i18n 点分 key 的编译期类型推导。
 * TxKey：简单文案 key（zh-CN 主字典里值为 string 的最深路径）。
 * PluralKey：复数文案 key（值为 PluralEntry 的路径），配 tPlural() 使用。
 * 有了这两个类型，t('写错的key') 直接是编译错误——key 拼写靠类型而不是靠运行时。
 */
import type { Dict } from './dict/zh-CN'
import type { PluralEntry } from './dict/types'

type JoinDot<K extends string, R extends string> = R extends '' ? K : `${K}.${R}`

/** 值为 string 的最深点分路径 */
type SimplePaths<T> = T extends string
  ? never
  : T extends PluralEntry
    ? never
    : {
        [K in keyof T & string]: [T[K]] extends [string]
          ? K
          : [T[K]] extends [PluralEntry]
            ? never
            : JoinDot<K, SimplePaths<T[K]>>
      }[keyof T & string]

/** 值为复数条目的点分路径 */
type PluralPaths<T> = T extends string
  ? never
  : T extends PluralEntry
    ? ''
    : {
        [K in keyof T & string]: [T[K]] extends [PluralEntry]
          ? K
          : [T[K]] extends [string]
            ? never
            : JoinDot<K, PluralPaths<T[K]>>
      }[keyof T & string]

export type TxKey = SimplePaths<Dict>
export type PluralKey = Exclude<PluralPaths<Dict>, ''>
