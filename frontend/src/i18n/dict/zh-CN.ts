/**
 * zh-CN 主字典（翻译基准，老端版）。
 * 由各命名空间 fragment 的 zh 部分组装；fragment 按抽词批次归属（一个批次一个文件，避免并行冲突）。
 * TxKey/PluralKey 类型从本字典推导，key 拼错是编译错误。
 * P0 骨架：A2 抽词逐批扩充（dialogs/todoEditor/SettingsDialog → 日历视图 → 杂项）。
 */
import { common } from './fragments/common'

export const zhCN = {
  common: common.zh,
} as const

export type Dict = typeof zhCN
