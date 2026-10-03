/**
 * English 字典（pivot 语言。老端版）。
 * 由各 fragment 的 en 部分组装；结构测试保证 key 与 zh-CN 深度一致、复数类别齐全。
 */
import type { DeepPartialDict } from './types'
import type { Dict } from './zh-CN'
import { common } from './fragments/common'
import { dialogs } from './fragments/dialogs'
import { todoDetail } from './fragments/todoDetail'
import { settings } from './fragments/settings'

export const en: DeepPartialDict<Dict> = {
  common: common.en,
  dialogs: dialogs.en,
  todoDetail: todoDetail.en,
  settings: settings.en,
}
