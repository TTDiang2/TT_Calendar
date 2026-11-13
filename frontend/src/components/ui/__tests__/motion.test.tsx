import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MorphingIcon } from '../MorphingIcon'
import { SegmentedTabs } from '../SegmentedTabs'
import { StretchSwitch } from '../StretchSwitch'
import { AnimatedCheck } from '../AnimatedCheck'

afterEach(cleanup)

describe('MorphingIcon', () => {
  it('根据 active 切换两层图标的可访问性', () => {
    const { container, rerender } = render(
      <MorphingIcon from={<span>square</span>} to={<span>copy</span>} active={false} />,
    )
    const from = container.querySelector('[data-layer="from"]')
    const to = container.querySelector('[data-layer="to"]')
    expect(from?.getAttribute('aria-hidden')).toBe('false')
    expect(to?.getAttribute('aria-hidden')).toBe('true')

    rerender(<MorphingIcon from={<span>square</span>} to={<span>copy</span>} active />)
    expect(from?.getAttribute('aria-hidden')).toBe('true')
    expect(to?.getAttribute('aria-hidden')).toBe('false')
  })
})

describe('SegmentedTabs', () => {
  const items = [
    { value: 'month' as const, label: '月' },
    { value: 'week' as const, label: '周' },
  ]

  it('标记当前项并在点击时回调', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(
      <SegmentedTabs items={items} value="month" onChange={onChange} ariaLabel="视图" />,
    )
    const month = screen.getByRole('button', { name: '月' })
    const week = screen.getByRole('button', { name: '周' })
    expect(month.getAttribute('aria-pressed')).toBe('true')
    expect(week.getAttribute('aria-pressed')).toBe('false')
    expect(month.querySelector('[data-segment-indicator]')).not.toBeNull()
    expect(container.querySelectorAll('[data-segment-indicator]')).toHaveLength(1)

    await user.click(week)
    expect(onChange).toHaveBeenCalledWith('week')
  })
})

describe('StretchSwitch', () => {
  it('渲染 switch 语义并在点击时反转', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StretchSwitch checked={false} onChange={onChange} label="图层" />)
    const sw = screen.getByRole('switch', { name: '图层' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    await user.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('禁用时不触发', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StretchSwitch checked={false} onChange={onChange} label="图层" disabled />)
    await user.click(screen.getByRole('switch', { name: '图层' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('AnimatedCheck', () => {
  it('根据 checked 暴露状态并在点击时回调', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(
      <AnimatedCheck checked={false} onClick={onClick} ariaLabel="完成" />,
    )
    const button = screen.getByRole('button', { name: '完成' })
    expect(button.getAttribute('data-state')).toBe('unchecked')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(<AnimatedCheck checked onClick={onClick} ariaLabel="完成" />)
    expect(button.getAttribute('data-state')).toBe('checked')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.querySelector('svg')).not.toBeNull()
  })
})
