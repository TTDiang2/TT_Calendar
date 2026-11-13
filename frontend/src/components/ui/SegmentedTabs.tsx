import * as React from 'react'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import { springMorph } from '../../lib/motion-tokens'

export interface SegmentedTabItem<T extends string> {
  value: T
  label: React.ReactNode
}

export interface SegmentedTabsProps<T extends string> {
  items: readonly SegmentedTabItem<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  ariaLabel?: string
  layoutId?: string
}

/**
 * 分段切换器：白色选中底块用 shared layout 在选项之间滑动。
 * 交互与视觉按 TT Calendar 现有的 TopBar 按钮组定制，不依赖 shadcn token。
 */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  className,
  ariaLabel,
  layoutId,
}: SegmentedTabsProps<T>) {
  const generatedId = React.useId()
  const indicatorId = layoutId ?? `segment-indicator-${generatedId}`

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={clsx(
        'relative inline-flex shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-0.5',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={clsx(
              'relative flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500',
              active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {active && (
              <motion.span
                data-segment-indicator
                layoutId={indicatorId}
                className="absolute inset-0 rounded-md bg-white shadow-sm"
                transition={springMorph}
              />
            )}
            <span className="relative z-10 flex items-center gap-1 whitespace-nowrap">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
