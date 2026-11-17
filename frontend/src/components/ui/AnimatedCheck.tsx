import * as React from 'react'
import { motion } from 'framer-motion'
import clsx from 'clsx'

export interface AnimatedCheckProps {
  checked: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  ariaLabel: string
  className?: string
  shape?: 'square' | 'circle'
  size?: number
  checkSize?: number
  checkClassName?: string
  /** 额外内联样式（卡片用主题 token 上色时传，宽高由 size 决定，这里不要覆盖） */
  style?: React.CSSProperties
}

/**
 * 待办完成按钮：盒子轻弹一下，勾号用 pathLength 自绘。
 * 只负责视觉和按钮语义，具体颜色由调用方传入，兼容列表的方形和卡片的圆形两种样式。
 */
export function AnimatedCheck({
  checked,
  onClick,
  ariaLabel,
  className,
  shape = 'square',
  size = 16,
  checkSize = 11,
  checkClassName,
  style,
}: AnimatedCheckProps) {
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      onClick={onClick}
      initial={false}
      animate={{ scale: checked ? [1, 1.08, 1] : 1 }}
      whileTap={{ scale: 0.86 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={clsx(
        'flex shrink-0 items-center justify-center transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
        shape === 'circle' ? 'rounded-full' : 'rounded',
        className,
      )}
      style={{ width: size, height: size, ...style }}
    >
      {checked && (
        <motion.svg
          viewBox="0 0 24 24"
          width={checkSize}
          height={checkSize}
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={checkClassName}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: [0.6, 1.18, 1], opacity: 1 }}
          transition={{
            scale: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
            opacity: { duration: 0.1 },
          }}
        >
          <motion.path
            d="M4 12l5 5L20 6"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.2, ease: [0.65, 0, 0.35, 1] }}
          />
        </motion.svg>
      )}
    </motion.button>
  )
}
