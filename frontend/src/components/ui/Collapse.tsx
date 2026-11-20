import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * 高度折叠容器。
 *
 * 以前侧栏的展开/收起是「整块内容一帧内出现或消失」，216px 的高差直接跳变，
 * 眼睛会跟丢自己刚点的是哪一组。这里用 height: auto ↔ 0 的过渡把它摊到 ~220ms，
 * 同时叠一层透明度，收起时内容先淡出再让高度收，看起来是「合上」而不是「被删除」。
 *
 * 外层 overflow-hidden 是必须的：height 动画期间子元素已经按最终尺寸排好版，
 * 不裁切就会溢出到相邻分组上。
 */
export function Collapse({
  open,
  children,
  duration = 0.22,
}: {
  open: boolean
  children: ReactNode
  duration?: number
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="collapse"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: { duration, ease: [0.32, 0.72, 0, 1] },
            opacity: { duration: duration * 0.75, ease: 'easeOut' },
          }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** 折叠三角：展开时朝下，收起时朝右，旋转本身也带过渡。 */
export function CollapseChevron({ open, size = 12 }: { open: boolean; size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={{ rotate: open ? 90 : 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="flex-shrink-0"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </motion.svg>
  )
}
