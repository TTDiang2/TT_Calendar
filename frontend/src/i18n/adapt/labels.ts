/**
 * 显示层映射（老端版，沿 Neo adapt/labels.ts 的定位）：面向用户的数据 → 按语言组装。
 * 图层名/节假日名/倒数日结构化标签等待 Python 侧结构化后按需补充。
 */
import type { TxKey } from '../index'
import { isCJK, type Lang } from '../core'

/**
 * 台账 C2：GRADED_PALETTES ASCII key → palette.* 字典 key（静态表防动态拼 key）。
 * data.ts 的键是逻辑键（不持久化——Sidebar 存 config 的是色值数组），显示经此映射。
 */
const PALETTE_LABEL_KEYS: Record<string, TxKey> = {
  green: 'palette.green',
  blue: 'palette.blue',
  orange: 'palette.orange',
  purple: 'palette.purple',
  red: 'palette.red',
  cyan: 'palette.cyan',
  indigo: 'palette.indigo',
  gray: 'palette.gray',
}

/** 调色板逻辑键 → 字典 key（未知键回落原值，同 layerLabel 未知图层名语义） */
export function paletteLabelKey(pk: string): TxKey {
  return PALETTE_LABEL_KEYS[pk] ?? (pk as TxKey)
}

/**
 * 农历显示（过渡版回归钉，台账 C3）：老端 Day.lunar 是后端拼好的中文串
 * （tt_calendar/utils/lunar_utils.py lunar_display：「七月初四/闰七月初四/初一只显月名」），
 * 前端拿不到结构化 {year,month,day,leap}，Neo 版 lunarText（ja/ko 旧暦/음력 组装、
 * en/fr/es/ru 隐藏）需等 Python 侧把 Day 载荷改结构化后再落地（已列入 Python 侧
 * 勘察清单，不改本次实现）。本函数先落决策 #9 的默认隐藏档：CJK（zh/ja/ko）
 * 原样透传（ja/ko 的翻译显示待结构化数据），非 CJK 隐藏。
 */
export function lunarDisplay(lang: Lang, lunarStr: string | null | undefined): string {
  if (!lunarStr || !isCJK(lang)) return ''
  return lunarStr
}
