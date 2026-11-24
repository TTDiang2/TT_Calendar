import { describe, expect, it } from 'vitest'
import {
  DETAIL_ANCHOR_PX,
  LAYOUT_ANCHOR_VW,
  SIDEBAR_ANCHOR_PX,
  detailWidthFor,
  scaledWidth,
  sidebarWidthFor,
} from '../layout-metrics'

describe('侧栏宽度标尺', () => {
  it('1949 宽时回到用户实测的最佳比例：左 360 / 右 420', () => {
    expect(sidebarWidthFor(1949)).toBe(360)
    expect(detailWidthFor(1949)).toBe(420)
  })

  it('锚点比例是 18.471% / 21.550%，而不是旧的 12.3% / 14.8%', () => {
    expect(SIDEBAR_ANCHOR_PX / LAYOUT_ANCHOR_VW).toBeCloseTo(0.18471, 5)
    expect(DETAIL_ANCHOR_PX / LAYOUT_ANCHOR_VW).toBeCloseTo(0.21550, 5)
  })

  it('窗口变宽时等比变宽', () => {
    // 2560 = 1949 × 1.3135 → 360 × 1.3135 ≈ 473，420 × 1.3135 ≈ 552
    expect(sidebarWidthFor(2560)).toBe(473)
    expect(detailWidthFor(2560)).toBe(552)
    // 1400：360 × 1400/1949 = 258.6 → 259；420 × 1400/1949 = 301.7 → 302
    expect(sidebarWidthFor(1400)).toBe(259)
    expect(detailWidthFor(1400)).toBe(302)
  })

  it('150% 缩放下换算回物理像素仍是 360（用户量的那个数）', () => {
    // 1949 物理窗口 @1.5 → CSS 视口 1299
    const cssWidth = sidebarWidthFor(1299)
    expect(cssWidth).toBe(240)
    expect(Math.round(cssWidth * 1.5)).toBe(360)
  })

  it('窄窗口停在下限，不把主区挤没', () => {
    expect(sidebarWidthFor(900)).toBe(180)
    expect(sidebarWidthFor(600)).toBe(180)
    expect(detailWidthFor(900)).toBe(216)
    expect(detailWidthFor(400)).toBe(216)
  })

  it('异常视口宽度回落到锚点值，不产生 NaN', () => {
    expect(scaledWidth(360, 180, 0)).toBe(360)
    expect(scaledWidth(360, 180, Number.NaN)).toBe(360)
    expect(scaledWidth(360, 180, -100)).toBe(360)
  })
})
