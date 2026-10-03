/**
 * 语言字典注册表（老端版）。翻译产出一个语言就在这里挂一个（静态 import，不做懒加载）。
 * 缺席的语言在 fallback 链里自动回落到 zh-CN。
 * P0：仅 zh-CN（主字典）+ en（pivot）；P3 翻译阶段逐语言挂入。
 * A4：ja/ko 已产出（同源抄 Neo + 独有新翻，见各文件头注释）。
 */
import type { Dict } from './zh-CN'
import { zhCN } from './zh-CN'
import { en } from './en'
import { ja } from './ja'
import { ko } from './ko'

export const DICTS: Partial<Record<string, Dict>> = {
  'zh-CN': zhCN,
  en: en as Dict,
  ja: ja as Dict,
  ko: ko as Dict,
}
