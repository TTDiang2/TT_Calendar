/**
 * 从扁平对照表生成 dict/<lang>.ts（老端 i18n 批量翻译流水线）。
 *
 * 用法：npx vite-node scripts/gen_dict.ts zh-Hant
 *
 * 输入：i18n_flat.<lang>.tsv —— 每行 "路径\t值"；值含 "|" 时视为复数条目，
 *      变体顺序固定 other|one|two|few|many（第一个必为 other）。
 * 输出：src/i18n/dict/<lang>.ts，嵌套结构与 zh-CN 主字典逐层对齐。
 *
 * 生成前做三项校验（与 i18n-structure 门禁同口径，先在脚本里拦一次）：
 *   1. 路径集合与 zh-CN 主字典完全一致（不多不少）；
 *   2. 复数条目提供该语言 pluralCategories() 采样到的全部类别；
 *   3. 每条的 {占位符} 集合与 zh-CN 对应条目一致。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { zhCN } from '../src/i18n/dict/zh-CN'
import { isPluralEntry } from '../src/i18n/dict/types'
import { pluralCategories, type Lang } from '../src/i18n/core'

/** TSV 里复数变体的书写顺序；生成时按 PluralEntry 声明顺序输出。 */
const VARIANTS = ['other', 'one', 'two', 'few', 'many'] as const

const EXPORT_NAME: Record<string, string> = {
  'zh-Hant': 'zhHant',
  fr: 'fr',
  es: 'es',
  ru: 'ru',
}

type Value = string | Record<string, string>

// ── 基准：zh-CN 摊平（保持字典声明顺序，输出顺序即它） ──────────────────────
const ZH: { path: string; value: Value }[] = []
;(function walk(node: Record<string, unknown>, prefix: string) {
  for (const [k, v] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (isPluralEntry(v)) {
      ZH.push({ path, value: { ...(v as unknown as Record<string, string>) } })
    } else if (typeof v === 'object' && v !== null) {
      walk(v as Record<string, unknown>, path)
    } else {
      ZH.push({ path, value: v as string })
    }
  }
})(zhCN as unknown as Record<string, unknown>, '')

/** zh-CN 里的复数路径集合：对照表对这些路径即便只写一段文本，也按 other 处理。 */
const ZH_PLURAL = new Set(ZH.filter((z) => typeof z.value !== 'string').map((z) => z.path))

// ── 读对照表 ──────────────────────────────────────────────────────────────
function readTsv(lang: string): Map<string, Value> {
  const raw = readFileSync(`i18n_flat.${lang}.tsv`, 'utf-8')
  const out = new Map<string, Value>()
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const tab = line.indexOf('\t')
    if (tab < 0) throw new Error(`[${lang}] 缺 Tab 分隔：${line.slice(0, 60)}`)
    const path = line.slice(0, tab).trim()
    const rest = line.slice(tab + 1).replace(/\\s/g, ' ')
    if (out.has(path)) throw new Error(`[${lang}] 路径重复：${path}`)
    if (!rest.includes('|')) {
      out.set(path, ZH_PLURAL.has(path) ? { other: rest } : rest)
      continue
    }
    const parts = rest.split('|')
    const entry: Record<string, string> = {}
    VARIANTS.forEach((name, i) => {
      if (parts[i]) entry[name] = parts[i]
    })
    if (entry.other === undefined) throw new Error(`[${lang}] 复数条目缺 other：${path}`)
    out.set(path, entry)
  }
  return out
}

// ── 校验 ──────────────────────────────────────────────────────────────────
function placeholdersOf(v: Value): Set<string> {
  const text = typeof v === 'string' ? v : Object.values(v).join('|')
  return new Set((text.match(/\{(\w+)\}/g) ?? []).map((s) => s.slice(1, -1)))
}

function edgeSpace(s: string): string {
  return `${s.length - s.trimStart().length}:${s.length - s.trimEnd().length}`
}

function edgesOf(v: Value): string[] {
  return typeof v === 'string' ? [edgeSpace(v)] : Object.values(v).map(edgeSpace)
}

function validate(lang: Lang, table: Map<string, Value>): void {
  const errors: string[] = []
  const missing: string[] = []
  const extra: string[] = []
  for (const { path } of ZH) if (!table.has(path)) missing.push(path)
  for (const path of table.keys()) if (!ZH.some((z) => z.path === path)) extra.push(path)
  if (missing.length) errors.push(`缺 ${missing.length} 条：${missing.slice(0, 10).join(', ')}`)
  if (extra.length) errors.push(`多 ${extra.length} 条：${extra.slice(0, 10).join(', ')}`)

  const needCats = pluralCategories(lang)
  for (const { path, value: zhVal } of ZH) {
    const got = table.get(path)
    if (got === undefined) continue
    const zhPlural = typeof zhVal !== 'string'
    const gotPlural = typeof got !== 'string'
    if (zhPlural !== gotPlural) {
      errors.push(`${path}: 复数/非复数形态与 zh-CN 不符`)
      continue
    }
    if (gotPlural) {
      const lack = needCats.filter((c) => typeof (got as Record<string, string>)[c] !== 'string')
      if (lack.length) errors.push(`${path}: 缺复数类别 ${lack.join(',')}`)
    }
    const zhPh = placeholdersOf(zhVal)
    const gotPh = placeholdersOf(got)
    const more = [...gotPh].filter((p) => !zhPh.has(p))
    const less = [...zhPh].filter((p) => !gotPh.has(p))
    if (more.length || less.length) errors.push(`${path}: 占位符多[${more}]少[${less}]`)

    const zhEdge = edgesOf(zhVal)[0]
    const offEdge = typeof got === 'string' ? edgesOf(got) : Object.values(got).map(edgeSpace)
    if (offEdge.some((e) => e !== zhEdge)) errors.push(`${path}: 首尾空格与 zh-CN 不符（需 ${zhEdge}）`)
  }
  if (errors.length) {
    console.error(`[${lang}] 校验未通过，共 ${errors.length} 处：`)
    for (const e of errors.slice(0, 40)) console.error('  - ' + e)
    process.exit(1)
  }
}

// ── 输出嵌套 TS ───────────────────────────────────────────────────────────
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function quoteKey(k: string): string {
  return IDENT.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`
}

function quoteStr(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function emitValue(v: Value): string {
  if (typeof v === 'string') return quoteStr(v)
  const inner = VARIANTS.filter((c) => typeof v[c] === 'string')
    .map((c) => `${c}: ${quoteStr(v[c])}`)
    .join(', ')
  return `{ ${inner} }`
}

function buildTree(table: Map<string, Value>): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  for (const { path, value } of ZH) {
    const parts = path.split('.')
    let node = root
    for (const part of parts.slice(0, -1)) {
      const next = node[part]
      if (typeof next !== 'object' || next === null) node[part] = {}
      node = node[part] as Record<string, unknown>
    }
    node[parts[parts.length - 1]] = table.get(path) ?? value
  }
  return root
}

function serialize(node: Record<string, unknown>, depth: number): string[] {
  const pad = '  '.repeat(depth + 1)
  const closePad = '  '.repeat(depth)
  const lines: string[] = []
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'object' && v !== null) {
      lines.push(`${pad}${quoteKey(k)}: {`)
      lines.push(...serialize(v as Record<string, unknown>, depth + 1))
      lines.push(`${pad}},`)
    } else {
      lines.push(`${pad}${quoteKey(k)}: ${emitValue(v as Value)},`)
    }
  }
  void closePad
  return lines
}

// ── main ──────────────────────────────────────────────────────────────────
const lang = process.argv[2] as Lang | undefined
if (!lang || !EXPORT_NAME[lang]) {
  console.error(`用法：npx vite-node scripts/gen_dict.ts <${Object.keys(EXPORT_NAME).join('|')}>`)
  process.exit(1)
}

const table = readTsv(lang)
validate(lang, table)

const name = EXPORT_NAME[lang]
const body = serialize(buildTree(table), 0).join('\n')
const header = [
  '/**',
  ` * ${lang} 字典（老端 A4 批次；语义基准：zh-CN 主字典全量摊平，共 ${ZH.length} 条）。`,
  ' *',
  ' * 本文件由 scripts/gen_dict.ts 从 i18n_flat.' + lang + '.tsv 生成 ——',
  ' * 改译文请改对照表后重新跑生成器，不要直接改这个文件（会被覆盖）。',
  ' */',
  "import type { DeepPartialDict } from './types'",
  "import type { Dict } from './zh-CN'",
  '',
  `export const ${name}: DeepPartialDict<Dict> = {`,
].join('\n')

writeFileSync(`src/i18n/dict/${lang}.ts`, `${header}\n${body}\n}\n`, 'utf-8')
console.log(`[${lang}] 已生成 src/i18n/dict/${lang}.ts（${ZH.length} 条，对照表 ${table.size} 条）`)