import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useT } from '../i18n'
import { MorphingIcon } from './ui/MorphingIcon'

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * 无边框窗口的自绘标题栏按钮：最小化 / 最大化-还原 / 关闭。
 * 浏览器里不渲染；关闭走 win.close()，保留 App.tsx 里关前同步的拦截逻辑。
 */
export function WindowControls() {
  const t = useT()
  const isTauri = inTauri()
  const [maximized, setMaximized] = useState(false)
  // 首次读取窗口状态前不播 morph，避免“启动即最大化”时图标先方后圆地补一次动画
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isTauri) return
    let disposed = false
    let unlisten: (() => void) | null = null

    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        if (disposed) return
        setMaximized(await win.isMaximized())
        setReady(true)
        unlisten = await win.onResized(async () => {
          try {
            setMaximized(await win.isMaximized())
          } catch {
            /* 窗口销毁过程中忽略 */
          }
        })
        if (disposed) {
          unlisten()
          unlisten = null
        }
      } catch {
        /* 非 Tauri 环境或权限缺失：保持隐藏 */
        if (!disposed) setReady(true)
      }
    })()

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [isTauri])

  if (!isTauri) return null

  async function run(action: 'minimize' | 'toggleMaximize' | 'close') {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      if (action === 'minimize') {
        await win.minimize()
      } else if (action === 'toggleMaximize') {
        await win.toggleMaximize()
        setMaximized(await win.isMaximized())
      } else {
        await win.close()
      }
    } catch {
      /* 权限缺失或窗口已关闭：忽略 */
    }
  }

  const btn =
    'flex w-[46px] items-center justify-center text-gray-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500'

  return (
    <div className="-mr-4 flex items-stretch self-stretch border-l border-gray-200">
      <button
        type="button"
        aria-label="Minimize"
        onClick={() => void run('minimize')}
        className={`${btn} hover:bg-gray-100 hover:text-gray-800`}
      >
        <Minus size={15} strokeWidth={1.6} />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void run('toggleMaximize')}
        className={`${btn} hover:bg-gray-100 hover:text-gray-800`}
      >
        {ready ? (
          <MorphingIcon
            size={14}
            active={maximized}
            from={<Square size={13} strokeWidth={1.6} />}
            to={<Copy size={14} strokeWidth={1.6} />}
          />
        ) : maximized ? (
          <Copy size={14} strokeWidth={1.6} />
        ) : (
          <Square size={13} strokeWidth={1.6} />
        )}
      </button>
      <button
        type="button"
        aria-label={t('common.close')}
        title={t('common.close')}
        onClick={() => void run('close')}
        className={`${btn} hover:bg-[#c42b1c] hover:text-white`}
      >
        <X size={16} strokeWidth={1.6} />
      </button>
    </div>
  )
}
