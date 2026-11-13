import * as React from 'react'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import { springSnappy } from '../../lib/motion-tokens'

const TRACK_WIDTH = 32
const TRACK_HEIGHT = 18
const THUMB_SIZE = 14
const TRACK_PADDING = 2
const TRAVEL = TRACK_WIDTH - THUMB_SIZE - TRACK_PADDING * 2

export interface StretchSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 供读屏使用；旁边通常已有可见文案 */
  label: string
  disabled?: boolean
  className?: string
}

/**
 * 按压时滑块轻微横向拉伸、纵向压扁，松手后弹到目标位置。
 * 尺寸保持现有的 32×18，避免侧栏行高变化。
 */
export function StretchSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  className,
}: StretchSwitchProps) {
  const [pressed, setPressed] = React.useState(false)
  const release = () => setPressed(false)

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onPointerDown={() => {
        if (!disabled) setPressed(true)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
      className={clsx(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-blue-500' : 'bg-gray-300',
        className,
      )}
      style={{ width: TRACK_WIDTH, height: TRACK_HEIGHT, paddingInline: TRACK_PADDING }}
    >
      <motion.span
        className="pointer-events-none block rounded-full bg-white shadow"
        style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
        initial={false}
        animate={{
          x: checked ? TRAVEL : 0,
          scaleX: pressed ? 1.18 : 1,
          scaleY: pressed ? 0.86 : 1,
        }}
        transition={springSnappy}
      />
    </button>
  )
}
