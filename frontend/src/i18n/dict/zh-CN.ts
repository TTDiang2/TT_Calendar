/**
 * zh-CN 主字典（翻译基准，老端版）。
 * 由各命名空间 fragment 的 zh 部分组装；fragment 按抽词批次归属（一个批次一个文件）。
 * TxKey/PluralKey 类型从本字典推导，key 拼错是编译错误。
 * A2 抽词进度：批① dialogs/todoDetail/settings、批② 日历视图组（terms/topbar/shell/
 * countdown/calendar/app）、批③ 杂项+双盲（stats/detail/todoEditor/todo/palette/
 * sourceFields/errors）已入库。
 */
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
import { stats } from './fragments/stats'
import { detail } from './fragments/detail'
import { todoEditor } from './fragments/todoEditor'
import { todo } from './fragments/todo'
import { palette } from './fragments/palette'
import { sourceFields } from './fragments/sourceFields'
import { errors } from './fragments/errors'

export const zhCN = {
  common: common.zh,
  dialogs: dialogs.zh,
  todoDetail: todoDetail.zh,
  settings: settings.zh,
  terms: terms.zh,
  topbar: topbar.zh,
  shell: shell.zh,
  countdown: countdown.zh,
  calendar: calendar.zh,
  app: app.zh,
  stats: stats.zh,
  detail: detail.zh,
  todoEditor: todoEditor.zh,
  todo: todo.zh,
  palette: palette.zh,
  sourceFields: sourceFields.zh,
  errors: errors.zh,
} as const

export type Dict = typeof zhCN
