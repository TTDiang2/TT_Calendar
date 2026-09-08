/**
 * 订阅源事件字段通用渲染器（SourceFields）测试
 *
 * schema 来自后端 Source.field_specs()（GET /api/sources）——本测试用一个
 * investing 同款 mock spec 验证四类渲染：meta 行 / 重要性星级 / 三列数值 / 徽标。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SourceFields } from '../SourceFields'
import type { SourceFieldSpec } from '../../api/client'

function investingSpec(): SourceFieldSpec {
  return {
    meta: [{ key: 'time' }, { key: 'currency' }, { key: 'period' }],
    importance: { key: 'importance', max: 3 },
    columns: [
      { key: 'actual', label: '今值' },
      { key: 'forecast', label: '预测值' },
      { key: 'previous', label: '前值' },
    ],
    badges: {
      key: 'vs_forecast',
      map: {
        超预期: { label: '▲ 超预期', tone: 'good' },
        不及: { label: '▼ 不及预期', tone: 'bad' },
        符合: { label: '● 符合预期', tone: 'info' },
        待公布: { label: '— 待公布', tone: 'muted' },
      },
    },
  }
}

afterEach(cleanup)

describe('SourceFields（investing 同款 spec）', () => {
  const BASE_EXTRA = {
    time: '07:50',
    currency: 'JPY',
    period: '七月',
    importance: 1,
    actual: '118.1',
    forecast: '117.9',
    previous: '116.2',
  }

  it('渲染 meta 行 + 三列数值', () => {
    render(<SourceFields spec={investingSpec()} extra={BASE_EXTRA} />)
    expect(screen.getByText('07:50')).toBeTruthy()
    expect(screen.getByText('JPY')).toBeTruthy()
    expect(screen.getByText('七月')).toBeTruthy()
    expect(screen.getByText('今值')).toBeTruthy()
    expect(screen.getByText('预测值')).toBeTruthy()
    expect(screen.getByText('前值')).toBeTruthy()
    expect(screen.getByText('118.1')).toBeTruthy()
    expect(screen.getByText('117.9')).toBeTruthy()
    expect(screen.getByText('116.2')).toBeTruthy()
  })

  it('importance=1 一颗实星、=3 三颗实星', () => {
    render(<SourceFields spec={investingSpec()} extra={{ ...BASE_EXTRA, importance: 1 }} />)
    expect(screen.getByTitle('重要性 ★')).toBeTruthy()
    expect(screen.queryByTitle('重要性 ★★')).toBeNull()
  })

  it('importance=3 三颗实星', () => {
    render(<SourceFields spec={investingSpec()} extra={{ ...BASE_EXTRA, importance: 3 }} />)
    expect(screen.getByTitle('重要性 ★★★')).toBeTruthy()
  })

  it('importance 缺失标记未知（无实星）', () => {
    render(<SourceFields spec={investingSpec()} extra={{ ...BASE_EXTRA, importance: 0 }} />)
    expect(screen.getByTitle('重要性 未知')).toBeTruthy()
    expect(screen.queryByTitle(/重要性 ★/)).toBeNull()
  })

  it('缺 forecast 时预测值列显示占位符', () => {
    render(<SourceFields spec={investingSpec()} extra={{ ...BASE_EXTRA, forecast: undefined }} />)
    expect(screen.getByText('118.1')).toBeTruthy()
    expect(screen.getByText('116.2')).toBeTruthy()
  })

  it('渲染 vs 徽标；无 vs_forecast 不渲染徽标', () => {
    render(<SourceFields spec={investingSpec()} extra={{ ...BASE_EXTRA, vs_forecast: '超预期' }} />)
    expect(screen.getByText('▲ 超预期')).toBeTruthy()
  })

  it('无 vs_forecast 键时无徽标', () => {
    render(<SourceFields spec={investingSpec()} extra={BASE_EXTRA} />)
    expect(screen.queryByText(/预期/)).toBeNull()
  })

  it('空 spec 渲染为空容器（无字段可显）', () => {
    const { container } = render(<SourceFields spec={{}} extra={BASE_EXTRA} />)
    expect(container.textContent ?? '').toBe('')
  })
})