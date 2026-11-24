import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ZOOM, ZOOM_STEPS, readUiZoom, stepUiZoom, writeUiZoom } from '../ui-zoom'

describe('界面缩放档位', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('五档覆盖 90% 到 150%，包含常用的 100% 与 125%', () => {
    expect([...ZOOM_STEPS]).toEqual([0.9, 1, 1.1, 1.25, 1.5])
    expect(ZOOM_STEPS).toContain(DEFAULT_ZOOM)
  })

  it('加减档位不会越界，也不会绕回另一端', () => {
    expect(stepUiZoom(0.9, -1)).toBe(0.9)
    expect(stepUiZoom(1.5, 1)).toBe(1.5)
    expect(stepUiZoom(1, 1)).toBe(1.1)
    expect(stepUiZoom(1, -1)).toBe(0.9)
  })

  it('读不到或读到脏值时退回 100%', () => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
    })
    expect(readUiZoom()).toBe(1)

    store['tt.uiZoom'] = '1.25'
    expect(readUiZoom()).toBe(1.25)

    // 手改过 localStorage 的、或者旧版本留下的奇怪值，不能被当成有效档位
    store['tt.uiZoom'] = '0.77'
    expect(readUiZoom()).toBe(1)
    store['tt.uiZoom'] = 'NaN'
    expect(readUiZoom()).toBe(1)
  })

  it('写入后能原样读回', () => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
    })
    writeUiZoom(1.5)
    expect(store['tt.uiZoom']).toBe('1.5')
    expect(readUiZoom()).toBe(1.5)
  })
})
