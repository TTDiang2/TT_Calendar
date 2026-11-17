import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { springDrawer } from '../../lib/motion-tokens'

interface Props {
  /** 抽屉是否滑出 */
  open: boolean
  /** 完全滑出后的宽度（默认 288 = 原 w-72 面板） */
  width?: number
  children: ReactNode
}

/**
 * 右抽屉。
 *
 * 以前右侧详情栏是「常驻占位」：没选中东西时要么留一块 288px 的空白，要么收成一条
 * 36px 的窄边挂个图标。两种都在提醒用户「这里本来有东西」，但信息量为零。
 *
 * 现在统一按抽屉处理：不在场时就真的不占位，进出场用一个弹簧同时改宽度和透明度。
 * 之所以不直接 `width: 0 → 288` 硬切，是因为主区是 flex-1，宽度突变会让整片内容
 * 一帧之内重排（表格/看板列宽跳动）；弹簧把重排摊到 ~300ms 里，眼睛跟得上。
 *
 * 内层固定宽度、外层 overflow-hidden：动画期间文字不会跟着压缩重排，
 * 看起来是「整块面板从右边缘被推出来」，而不是「面板被压扁」。
 */
export function RightDrawer({ open, width = 288, children }: Props) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="right-drawer"
          className="relative flex-shrink-0 overflow-hidden"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={springDrawer}
        >
          <motion.div
            className="h-full"
            style={{ width }}
            initial={{ x: 18 }}
            animate={{ x: 0 }}
            exit={{ x: 18 }}
            transition={springDrawer}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
