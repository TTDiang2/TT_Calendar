/**
 * 界面缩放。
 *
 * 为什么是整体缩放而不是调字号：全仓有 200 处绝对像素字号（text-[11px] /
 * text-[10px] 之类），它们不跟根字号走；而侧栏 w-60、右抽屉 288px 也是死值。
 * 只改字号会得到「字变大了、但格子还是那么窄」的错位。WebView 的整体缩放
 * 让 CSS px 按比例变大，侧栏占比与字号一起回到原本调好的样子。
 *
 * 快捷键按档位跳，不用 WebView2 自带的 20% 步进——那步子太粗，125% 这种
 * 常用值根本踩不到。
 */

const STORAGE_KEY = 'tt.uiZoom'

/** 五档。90% 给小屏留余量，150% 对应 4K 全屏。 */
export const ZOOM_STEPS = [0.9, 1, 1.1, 1.25, 1.5] as const
export type UiZoom = (typeof ZOOM_STEPS)[number]
export const DEFAULT_ZOOM: UiZoom = 1

function isStep(v: number): v is UiZoom {
  return (ZOOM_STEPS as readonly number[]).includes(v)
}

export function readUiZoom(): UiZoom {
  if (typeof localStorage === 'undefined') return DEFAULT_ZOOM
  const raw = Number(localStorage.getItem(STORAGE_KEY))
  return isStep(raw) ? raw : DEFAULT_ZOOM
}

export function writeUiZoom(zoom: UiZoom): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, String(zoom))
}

/** 把缩放应用到 WebView。浏览器里（vite 直开）没有这个命令，静默跳过。 */
export async function applyUiZoom(zoom: UiZoom): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_ui_zoom', { scale: zoom })
  } catch {
    // 非 Tauri 环境（浏览器调试 / 单测）没有这个命令，忽略即可。
  }
}

/** 档位内加减。到顶/到底就停在边界，不循环——循环会让"已经最大了"变成意外变小。 */
export function stepUiZoom(current: UiZoom, direction: 1 | -1): UiZoom {
  const i = ZOOM_STEPS.indexOf(current)
  const next = i + direction
  if (next < 0 || next >= ZOOM_STEPS.length) return current
  return ZOOM_STEPS[next]
}
