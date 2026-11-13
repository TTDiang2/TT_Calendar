import * as React from 'react'
import { motion } from 'framer-motion'
import clsx from 'clsx'

export interface MorphingIconProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  from: React.ReactNode
  to: React.ReactNode
  active?: boolean
  duration?: number
  size?: number
}

/**
 * 两个图标层做旋转 + 缩放 + 交叉淡入淡出。
 * 改自 EasyUI 的 MorphingIcon（MIT），去掉了 shadcn 的 cn/tailwind-merge 依赖。
 */
export function MorphingIcon({
  from,
  to,
  active = false,
  duration = 0.3,
  size = 20,
  className,
  ...props
}: MorphingIconProps) {
  return (
    <div
      className={clsx('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <motion.div
        data-layer="from"
        className="absolute inset-0 flex items-center justify-center"
        initial={false}
        animate={{
          opacity: active ? 0 : 1,
          scale: active ? 0.65 : 1,
          rotate: active ? -90 : 0,
        }}
        transition={{ duration, ease: [0.4, 0, 0.2, 1] }}
        aria-hidden={active}
      >
        {from}
      </motion.div>

      <motion.div
        data-layer="to"
        className="absolute inset-0 flex items-center justify-center"
        initial={false}
        animate={{
          opacity: active ? 1 : 0,
          scale: active ? 1 : 0.65,
          rotate: active ? 0 : 90,
        }}
        transition={{ duration, ease: [0.4, 0, 0.2, 1] }}
        aria-hidden={!active}
      >
        {to}
      </motion.div>
    </div>
  )
}
