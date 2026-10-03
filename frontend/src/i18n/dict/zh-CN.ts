/**
 * zh-CN 主字典（翻译基准，老端版）。
 * 由各命名空间 fragment 的 zh 部分组装；fragment 按抽词批次归属（一个批次一个文件）。
 * TxKey/PluralKey 类型从本字典推导，key 拼错是编译错误。
 * A2 抽词进度：批① dialogs/todoDetail/settings 已入库；批② 日历视图；批③ 杂项+data.ts 双盲。
 */
import { common } from './fragments/common'
import { dialogs } from './fragments/dialogs'
import { todoDetail } from './fragments/todoDetail'
import { settings } from './fragments/settings'

export const zhCN = {
  common: common.zh,
  dialogs: dialogs.zh,
  todoDetail: todoDetail.zh,
  settings: settings.zh,
} as const

export type Dict = typeof zhCN
