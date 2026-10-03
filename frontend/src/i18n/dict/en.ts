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
import { terms } from './fragments/terms'
import { topbar } from './fragments/topbar'
import { shell } from './fragments/shell'
import { countdown } from './fragments/countdown'
import { calendar } from './fragments/calendar'
import { app } from './fragments/app'

export const en: DeepPartialDict<Dict> = {
  common: common.en,
  dialogs: dialogs.en,
  todoDetail: todoDetail.en,
  settings: settings.en,
  terms: terms.en,
  topbar: topbar.en,
  shell: shell.en,
  countdown: countdown.en,
  calendar: calendar.en,
  app: app.en,
}
