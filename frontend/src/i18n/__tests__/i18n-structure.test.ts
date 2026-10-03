/**
 * i18n 字典结构守门（智者评审第 10 项定稿规则）：
 *  1. 非复数 key：所有已注册语言与 zh-CN 的 key 路径集合深度相等（双向：不多不少）；
 *  2. 复数 key：每个语言必须提供 pluralCategories(lang) 产出的全部类别（含 other）；
 *  3. 每条译文里的 {placeholder} 集合 = zh-CN 对应条目的占位符集合（复数条目额外含 n）；
 *  4. mutation 验证：删掉任意语言的任意 key 本测试必须红（下方自测用例模拟）。
 * 新语言在 dict/index.ts 注册后自动纳入校验。
 */
import { describe, expect, it } from 'vitest'
import { DICTS } from '../dict/index'
import { zhCN } from '../dict/zh-CN'
import { isPluralEntry, type PluralEntry } from '../dict/types'
import { pluralCategories, type Lang } from '../core'

type Node = Record<string, unknown>

function isNode(v: unknown): v is Node {
  return typeof v === 'object' && v !== null && !isPluralEntry(v)
}

/** 收集点分路径 → 节点。复数条目按「单 key」收集，类别在 value 里。 */
function collectPaths(dict: Node, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [k, v] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (isNode(v)) {
      for (const [p, val] of collectPaths(v, path)) out.set(p, val)
    } else {
      out.set(path, v)
    }
  }
  return out
}

const ZH_PATHS = collectPaths(zhCN as unknown as Node)

function placeholderOf(v: unknown): Set<string> {
  const text = typeof v === 'string' ? v : isPluralEntry(v) ? Object.values(v).join('|') : ''
  return new Set((text.match(/\{(\w+)\}/g) ?? []).map((s) => s.slice(1, -1)))
}

function registeredLangs(): [Lang, Node][] {
  return Object.entries(DICTS).filter(([k, v]) => k !== 'zh-CN' && v) as [Lang, Node][]
}

describe('i18n 字典结构', () => {
  it('zh-CN 主字典存在且非空', () => {
    expect(ZH_PATHS.size).toBeGreaterThan(0)
  })

  for (const [lang, dict] of registeredLangs()) {
    describe(`语言 ${lang}`, () => {
      const paths = collectPaths(dict)

      it('key 集合与 zh-CN 完全一致（不多不少）', () => {
        const missing = [...ZH_PATHS.keys()].filter((k) => !paths.has(k))
        const extra = [...paths.keys()].filter((k) => !ZH_PATHS.has(k))
        expect({ missing, extra }).toEqual({ missing: [], extra: [] })
      })

      it('复数条目类别齐全（含 other）', () => {
        const problems: string[] = []
        for (const [key, zhVal] of ZH_PATHS) {
          if (!isPluralEntry(zhVal)) continue
          const val = paths.get(key)
          if (!isPluralEntry(val)) {
            problems.push(`${key}: 不是复数条目`)
            continue
          }
          const need = pluralCategories(lang)
          const lack = need.filter((c) => typeof val[c as keyof PluralEntry] !== 'string')
          if (lack.length) problems.push(`${key}: 缺类别 ${lack.join(',')}`)
        }
        expect(problems).toEqual([])
      })

      it('简单条目值都是字符串', () => {
        const bad: string[] = []
        for (const [key, zhVal] of ZH_PATHS) {
          if (isPluralEntry(zhVal)) continue
          if (typeof paths.get(key) !== 'string') bad.push(key)
        }
        expect(bad).toEqual([])
      })

      it('插值占位符与 zh-CN 一致', () => {
        const bad: string[] = []
        for (const [key, zhVal] of ZH_PATHS) {
          const zhSet = placeholderOf(zhVal)
          const val = paths.get(key)
          const set = placeholderOf(val)
          const extra = [...set].filter((p) => !zhSet.has(p))
          const lack = [...zhSet].filter((p) => !set.has(p))
          if (extra.length || lack.length) bad.push(`${key}: 多${extra}少${lack}`)
        }
        expect(bad).toEqual([])
      })
    })
  }

  it('mutation 自检：缺 key 的字典必须被判红（守门本身可守门）', () => {
    // 模拟「某语言丢了一个 key」：直接构造坏字典跑同一套检查
    const broken = structuredClone(DICTS.en) as unknown as Node
    const common = broken.common as Node
    delete common.confirm
    const paths = collectPaths(broken)
    const missing = [...ZH_PATHS.keys()].filter((k) => !paths.has(k))
    expect(missing).toContain('common.confirm')
  })
})
