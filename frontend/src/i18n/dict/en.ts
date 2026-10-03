/**
 * English 字典（pivot 语言：ja/ko 参照 zh 直译，fr/es/ru 由 en 转译。老端版）。
 * 由各 fragment 的 en 部分组装；结构测试保证 key 与 zh-CN 深度一致、复数类别齐全。
 */
import type { DeepPartialDict } from './types'
import type { Dict } from './zh-CN'
import { common } from './fragments/common'

export const en: DeepPartialDict<Dict> = {
  common: common.en,
}
