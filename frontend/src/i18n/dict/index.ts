/**
 * 语言字典注册表（老端版）。翻译产出一个语言就在这里挂一个（静态 import，不做懒加载）。
 * 缺席的语言在 fallback 链里自动回落到 zh-CN。
 * A4：8 种语言全部产出 —— zh-Hant/fr/es/ru 由 scripts/gen_dict.ts 从 i18n_flat.<lang>.tsv 生成。
 */
import type { Dict } from './zh-CN'
import { zhCN } from './zh-CN'
import { en } from './en'
import { ja } from './ja'
import { ko } from './ko'
import { zhHant } from './zh-Hant'
import { fr } from './fr'
import { es } from './es'
import { ru } from './ru'

export const DICTS: Partial<Record<string, Dict>> = {
  'zh-CN': zhCN,
  'zh-Hant': zhHant as Dict,
  en: en as Dict,
  ja: ja as Dict,
  ko: ko as Dict,
  fr: fr as Dict,
  es: es as Dict,
  ru: ru as Dict,
}
