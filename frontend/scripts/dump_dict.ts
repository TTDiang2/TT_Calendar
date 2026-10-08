/** 把 zh-CN 主字典摊平为 JSON，作为 4 语翻译的底稿（键路径 → 值/复数条目）。 */
import { writeFileSync } from 'node:fs'
import { zhCN } from '../src/i18n/dict/zh-CN'
import { isPluralEntry } from '../src/i18n/dict/types'

type Node = Record<string, unknown>

function walk(node: Node, prefix: string, out: Record<string, unknown>) {
  for (const [k, v] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (isPluralEntry(v)) out[path] = { plural: true, ...(v as Record<string, string>) }
    else if (typeof v === 'object' && v !== null) walk(v as Node, path, out)
    else out[path] = v
  }
}

const out: Record<string, unknown> = {}
walk(zhCN as unknown as Node, '', out)
const keys = Object.keys(out)
const plurals = keys.filter((k) => (out[k] as { plural?: boolean }).plural)
writeFileSync('i18n_flat.json', JSON.stringify(out, null, 1), 'utf-8')
console.log('leaves:', keys.length, '| plural entries:', plurals.length, '| simple:', keys.length - plurals.length)
console.log('placeholder-bearing keys:', keys.filter((k) => JSON.stringify(out[k]).includes('{')).length)