import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, CheckCircle2, CircleAlert, ListTodo } from 'lucide-react'
import clsx from 'clsx'
import { getStatsSummary } from '../api/client'

const IMPORTANCE_COLOR: Record<string, string> = {
  high: '#ef4444',
  normal: '#eab308',
  low: '#22c55e',
}

export function StatsView() {
  const { data, isLoading } = useQuery({
    queryKey: ['stats', 'summary'],
    queryFn: getStatsSummary,
    staleTime: 30_000,
  })

  const { quadrantPoints, maxDaily, avgDaily } = useMemo(() => {
    if (!data) return { quadrantPoints: [], maxDaily: 0, avgDaily: 0 }
    const points = data.quadrant.map((q) => {
      // x: 紧迫度（0=最紧急，1=最不紧急）。已逾期 -> 0；未来 -> 按 30 天内线性归一，超过 30 天都算 1
      const days = q.days_to_due ?? 365
      const urgency = days < 0 ? 0 : Math.min(days / 30, 1)
      // y: 重要性（0=最高，1=最低）
      const imp = q.importance === 'high' ? 0 : q.importance === 'low' ? 1 : 0.5
      return { ...q, x: urgency, y: imp }
    })
    const counts = data.daily_done.map((d) => d.count)
    return { quadrantPoints: points, maxDaily: Math.max(1, ...counts), avgDaily: counts.reduce((a, b) => a + b, 0) / Math.max(counts.length, 1) }
  }, [data])

  if (isLoading || !data) {
    return <main className="flex-1 flex items-center justify-center text-gray-400">加载中…</main>
  }

  const { stats, daily_done, list_names } = data
  const doneTotal = daily_done.reduce((a, d) => a + d.count, 0)

  // SVG 折线：近 90 天
  const W = 900
  const H = 160
  const PAD = 8
  const n = daily_done.length
  const stepX = n > 1 ? (W - PAD * 2) / (n - 1) : 0
  const pts = daily_done.map((d, i) => ({
    x: PAD + i * stepX,
    y: H - PAD - (d.count / maxDaily) * (H - PAD * 2),
    count: d.count,
  }))
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${(PAD + (n - 1) * stepX).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`

  return (
    <main className="flex-1 flex flex-col p-4 overflow-y-auto min-w-0">
      <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5 mb-4">
        <BarChart3 size={16} /> 统计
      </h2>

      {/* 概览卡片 */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard icon={<ListTodo size={16} />} label="总待办" value={stats.total} color="text-blue-600" />
        <StatCard icon={<CircleAlert size={16} />} label="未完成" value={stats.incomplete} color="text-orange-600" />
        <StatCard icon={<CheckCircle2 size={16} />} label="已完成" value={stats.completed} color="text-green-600" />
        <StatCard icon={<BarChart3 size={16} />} label="近90天完成" value={doneTotal} color="text-purple-600" />
      </div>

      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        {/* 四象限 */}
        <section className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col min-h-0">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">待办四象限</h3>
          <p className="text-[11px] text-gray-400 mb-2">横轴：到期紧迫度 →　纵轴：重要性 ↑（点 = 未完成待办）</p>
          <div className="relative flex-1 min-h-[240px] border border-gray-100 rounded bg-gray-50/50">
            {/* 象限分割线 */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-200" />
            <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-200" />
            {/* 象限标签 */}
            <span className="absolute top-1.5 left-2 text-[10px] text-red-400">紧急·重要</span>
            <span className="absolute top-1.5 right-2 text-[10px] text-orange-400">不紧急·重要</span>
            <span className="absolute bottom-1.5 left-2 text-[10px] text-yellow-500">紧急·次要</span>
            <span className="absolute bottom-1.5 right-2 text-[10px] text-gray-400">不紧急·次要</span>
            {/* 散点 */}
            {quadrantPoints.map((p) => (
              <div
                key={p.id}
                title={`${p.title}${p.days_to_due != null ? `（${p.days_to_due < 0 ? '已逾期' + (-p.days_to_due) + '天' : p.days_to_due + '天后到期'}）` : '（无到期日）'}`}
                className="absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 border border-white shadow cursor-pointer"
                style={{
                  left: `${(p.x * 85 + 7.5).toFixed(1)}%`,
                  top: `${(p.y * 78 + 8).toFixed(1)}%`,
                  backgroundColor: IMPORTANCE_COLOR[p.importance] ?? '#eab308',
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full inline-block" style={{ background: '#ef4444' }} />高</span>
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full inline-block" style={{ background: '#eab308' }} />普通</span>
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full inline-block" style={{ background: '#22c55e' }} />低</span>
            <span className="ml-auto">{quadrantPoints.length} 个未完成</span>
          </div>
        </section>

        {/* 逐日完成 */}
        <section className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col min-h-0">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">逐日完成数量（近 90 天）</h3>
          <div className="flex-1 min-h-[240px]">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="doneArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#e5e7eb" strokeWidth="1" />
              <path d={areaPath} fill="url(#doneArea)" />
              <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" />
              {pts.filter((p) => p.count > 0).map((p) => (
                <circle key={p.x} cx={p.x} cy={p.y} r="2" fill="#3b82f6" />
              ))}
              {/* 均值参考线 */}
              <line
                x1={PAD} y1={H - PAD - (avgDaily / maxDaily) * (H - PAD * 2)}
                x2={W - PAD} y2={H - PAD - (avgDaily / maxDaily) * (H - PAD * 2)}
                stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 3"
              />
              <text x={W - PAD - 2} y={H - PAD - (avgDaily / maxDaily) * (H - PAD * 2) - 3} fontSize="9" fill="#f59e0b" textAnchor="end">
                日均 {avgDaily.toFixed(1)}
              </text>
            </svg>
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-gray-400">
            <span>{daily_done[0]?.date ?? ''}</span>
            <span>峰值 {maxDaily}/天</span>
            <span>{daily_done[daily_done.length - 1]?.date ?? ''}</span>
          </div>
        </section>
      </div>

      {/* 列表分布 */}
      <section className="bg-white border border-gray-200 rounded-lg p-4 mt-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">未完成待办分布（按列表）</h3>
        <div className="flex flex-col gap-1.5">
          {Object.entries(list_names).map(([id, name]) => {
            const count = data.quadrant.filter((q) => q.list_id === id).length
            if (count === 0) return null
            const pct = (count / Math.max(data.quadrant.length, 1)) * 100
            return (
              <div key={id} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-28 truncate">{name}</span>
                <div className="flex-1 h-3 bg-gray-100 rounded overflow-hidden">
                  <div className="h-full bg-blue-400 rounded" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-gray-400 w-8 text-right">{count}</span>
              </div>
            )
          })}
        </div>
      </section>
    </main>
  )
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
        {icon} {label}
      </div>
      <p className={clsx('text-2xl font-semibold', color)}>{value}</p>
    </div>
  )
}
