/**
 * 两侧栏的宽度标尺。
 *
 * 基准来自用户在一台 150% 系统缩放的机器上、对旧版本 1949×1225 窗口的实测：
 * 左栏 360px、右详情栏 420px（PowerToys 量的屏幕物理像素）。
 * 老版本 CSS 里那是 `w-60`(240)/`w-72`(288)，在 150% 下正好渲染成 360/432，对得上。
 *
 * 规则：以「1949 宽窗口 → 左 360 / 右 420」这条比例为准，随视口等比缩放。
 *
 *   左栏 360 / 1949 = 18.471%
 *   右栏 420 / 1949 = 21.550%
 *
 * 比例与 devicePixelRatio 无关——CSS 视口和物理视口是同一套线性关系，
 * 所以这里直接喂 window.innerWidth（CSS px）即可，算出来的 CSS px 乘回缩放
 * 就是用户量到的物理像素。
 *
 * 下限 180/216 只在窗口很窄时兜底，防止图层名被截断。
 *
 * CSS 侧见 index.css 的 `--cal-sidebar-w` / `--cal-detail-w`，两处公式必须同源；
 * 右抽屉要走 framer-motion 的数值动画，没法直接吃 CSS 变量，所以在这里算。
 */

/** 锚点窗口宽度（用户实测那一档） */
export const LAYOUT_ANCHOR_VW = 1949
/** 锚点下的左栏宽度（实测 360 物理像素） */
export const SIDEBAR_ANCHOR_PX = 360
/** 锚点下的右详情栏宽度（实测 420 物理像素） */
export const DETAIL_ANCHOR_PX = 420
/** 左栏下限：再窄图层名就截断了 */
export const SIDEBAR_MIN_PX = 180
/** 右栏下限：保持与左栏 1.2 倍的节奏 */
export const DETAIL_MIN_PX = 216

/** 按锚点比例算宽度，并在下限处兜住；四舍五入到整数像素避免亚像素抖动 */
export function scaledWidth(anchorPx: number, minPx: number, viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return anchorPx
  return Math.max(minPx, Math.round((viewportWidth * anchorPx) / LAYOUT_ANCHOR_VW))
}

/** 右详情栏在当前视口下应有的宽度（CSS px） */
export function detailWidthFor(viewportWidth: number): number {
  return scaledWidth(DETAIL_ANCHOR_PX, DETAIL_MIN_PX, viewportWidth)
}

/** 左栏在当前视口下应有的宽度（CSS px，给需要数值的地方用） */
export function sidebarWidthFor(viewportWidth: number): number {
  return scaledWidth(SIDEBAR_ANCHOR_PX, SIDEBAR_MIN_PX, viewportWidth)
}
