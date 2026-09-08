import type { SourceFieldSpec } from '../api/client'

/**
 * 订阅源事件字段的通用渲染器（schema 驱动）。
 *
 * 规格来自后端 Source.field_specs()（GET /api/sources），插件只需声明
 * extra 里的键如何展示，无需写前端组件：
 *   - meta:       首行小字序列（如 时间/货币/统计周期）
 *   - importance: 星级（如 重要性 1-3）
 *   - columns:    多列表格（如 今值/预测值/前值）
 *   - badges:     徽标映射（如 vs 预期 → ▲超预期/▼不及/●符合/—待公布）
 */

const TONE_CLS: Record<string, string> = {
  good: 'bg-green-50 text-green-600 border-green-200',
  bad: 'bg-red-50 text-red-500 border-red-200',
  info: 'bg-blue-50 text-blue-600 border-blue-200',
  muted: 'bg-gray-100 text-gray-500 border-gray-200',
}

function ImportanceDots({ level, max = 3 }: { level: number; max?: number }) {
  const stars = level >= 1 && level <= max ? level : 0
  return (
    <span className="inline-flex gap-px align-middle" title={`重要性 ${'★'.repeat(stars) || '未知'}`}>
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={i < stars ? 'text-amber-500' : 'text-gray-300'}>★</span>
      ))}
    </span>
  )
}

export function SourceFields({ spec, extra }: { spec: SourceFieldSpec; extra: Record<string, unknown> }) {
  const s = (k: string) => (extra[k] == null ? undefined : String(extra[k]))
  const metaVals = (spec.meta ?? []).map((m) => s(m.key)).filter((v): v is string => Boolean(v))
  const columns = spec.columns ?? []
  const hasColumnData = columns.some((c) => s(c.key) != null)
  const impKey = spec.importance?.key
  const impLevel = impKey ? Number(extra[impKey] ?? 0) : 0
  const badgeKey = spec.badges?.key
  const badgeVal = badgeKey ? s(badgeKey) : undefined
  const badgeMeta = badgeVal ? spec.badges?.map[badgeVal] : undefined

  return (
    <div className="mt-1.5 space-y-1">
      {metaVals.length > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          {metaVals.map((v, i) => (
            <span key={i} className={i === 0 ? 'tabular-nums' : 'text-gray-400'}>{v}</span>
          ))}
          {spec.importance && <ImportanceDots level={impLevel} max={spec.importance.max ?? 3} />}
        </div>
      )}
      {hasColumnData && (
        <div
          className="grid gap-x-2 text-[11px]"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {columns.map((c) => {
            const v = s(c.key)
            return (
              <div key={c.key}>
                <div className="text-gray-400">{c.label ?? c.key}</div>
                <div className={`tabular-nums ${v ? 'text-gray-700' : 'text-gray-300'}`}>
                  {v || '—'}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {badgeMeta && (
        <span className={`inline-block px-1.5 py-px rounded border text-[10px] ${TONE_CLS[badgeMeta.tone ?? 'muted'] ?? TONE_CLS.muted}`}>
          {badgeMeta.label ?? badgeVal}
        </span>
      )}
    </div>
  )
}