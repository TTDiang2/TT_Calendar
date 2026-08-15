import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// D0：golden vectors 消费壳。merge.ts 在 D1 实现后注册到 globalThis.__TT_CORE_MERGE__，
// 此测试自动从「跳过」变「全量对拍」。
// 向量文件由 Python 参考实现生成（tests/gen_golden.py，幂等），语义见 docs/SYNC_PROTOCOL.md。

interface VectorExpect {
  data: Record<string, Array<Record<string, unknown>>>
  tombstones: Record<string, string>
  report: Record<string, number>
}

interface Vector {
  name: string
  kind: 'merge' | 'first_bind'
  input: Record<string, unknown>
  expect: VectorExpect
}

type CoreMergeFn = (input: Record<string, unknown>) => VectorExpect

declare global {
  // eslint-disable-next-line no-var
  var __TT_CORE_MERGE__: CoreMergeFn | undefined
}

const here = dirname(fileURLToPath(import.meta.url))
const vectorsPath = resolve(here, '../../../../tests/golden/merge_vectors.json')
const vectors: Vector[] = JSON.parse(readFileSync(vectorsPath, 'utf-8')).vectors

const mergeFn: CoreMergeFn | undefined = globalThis.__TT_CORE_MERGE__

describe.skipIf(typeof mergeFn !== 'function')('golden vectors', () => {
  it('vectors file loads with >=24 cases', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(24)
  })

  for (const v of vectors) {
    it(v.name, () => {
      const result = mergeFn!(v.input)
      expect(result).toEqual(v.expect)
    })
  }
})

describe('golden vectors (D0 shell)', () => {
  it('file is loadable and structurally valid', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(24)
    for (const v of vectors) {
      expect(v.name).toBeTruthy()
      expect(['merge', 'first_bind']).toContain(v.kind)
      expect(v.expect.data).toBeTypeOf('object')
    }
  })
})
