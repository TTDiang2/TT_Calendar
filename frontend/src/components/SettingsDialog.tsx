import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Trash2 } from 'lucide-react'
import { Modal, Field } from './ui/Modal'
import {
  toggleLayer, importJisilu, getLayerSubActions, updateLayerConfig, deleteLayer,
  getTodoBusyConfig, setTodoBusyConfig, recomputeTodoBusy, type TodoBusyConfig,
} from '../api/client'
import type { Layer } from '../types'

interface Props {
  layers: Layer[]
  onToggleLayer: (layerId: string) => void
  defaultStart: string
  defaultEnd: string
  onClose: () => void
}

export function SettingsDialog({ layers, onToggleLayer, defaultStart, defaultEnd, onClose }: Props) {
  const qc = useQueryClient()
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(defaultEnd)
  const [result, setResult] = useState<string | null>(null)

  const importMut = useMutation({
    mutationFn: () => importJisilu(start, end),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['view'] })
      setResult(`导入 ${res.inserted} 条${res.error ? '；错误：' + res.error : ''}`)
    },
  })

  const jisilu = layers.filter((l) => l.sort_order >= 10).sort((a, b) => a.display_name.localeCompare(b.display_name))
  const customLayers = layers.filter((l) => l.layer_id.startsWith('custom_'))

  return (
    <Modal title="设置" onClose={onClose} width={720}>
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">事件导入</h3>
          <div className="flex gap-2 mb-2">
            <Field label="开始">
              <input
                type="date"
                className="tt-input"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="结束">
              <input
                type="date"
                className="tt-input"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>
          <p className="text-xs text-gray-400 mb-2">
            从集思录抓取该区间的新股/可转债/分红/期权等数据。已禁用的图层会跳过。
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => importMut.mutate()}
              disabled={importMut.isPending}
              className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
            >
              {importMut.isPending ? '导入中…' : '开始导入'}
            </button>
            {result && <span className="text-sm text-green-600">{result}</span>}
          </div>
        </section>

        {jisilu.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">集思录投资日历</h3>
            <div className="flex flex-col gap-1">
              {jisilu.map((l) => (
                <LayerAccordion key={l.layer_id} layer={l} onToggle={onToggleLayer} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">自定义图层</h3>
          {customLayers.length === 0 ? (
            <p className="text-sm text-gray-400">暂无自定义图层。可在日历左侧边栏点「新建图层」创建。</p>
          ) : (
            <div className="flex flex-col gap-1">
              {customLayers.map((l) => (
                <CustomLayerRow key={l.layer_id} layer={l} onToggle={onToggleLayer} />
              ))}
            </div>
          )}
        </section>

        <BusyConfigSection />
      </div>
      <p className="mt-5 pt-3 border-t border-gray-100 text-center text-[11px] text-gray-400 select-none">
        TT Calendar <span className="font-medium">v2.1.0</span>
      </p>
    </Modal>
  )
}

function BusyConfigSection() {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['todoBusyConfig'], queryFn: getTodoBusyConfig, staleTime: 60_000 })
  const [local, setLocal] = useState<TodoBusyConfig | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (cfg && !local) setLocal(cfg)
  }, [cfg, local])

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!local) return
      await setTodoBusyConfig(local)
      const res = await recomputeTodoBusy()
      return res.days_written
    },
    onSuccess: (days) => {
      qc.invalidateQueries({ queryKey: ['todoBusyConfig'] })
      qc.invalidateQueries({ queryKey: ['view'] })
      setMsg(`已保存并重算 ${days} 天的忙度快照`)
    },
  })

  const setNum = (path: (string | number)[], v: string) => {
    if (!local) return
    const n = Number(v)
    if (Number.isNaN(n)) return
    setLocal((prev) => {
      const next = structuredClone(prev)
      const root = next as unknown as Record<string, unknown>
      let cur: Record<string, unknown> = root
      for (let i = 0; i < path.length - 1; i++) {
        cur = cur[path[i]] as Record<string, unknown>
      }
      cur[path[path.length - 1]] = n
      return next
    })
  }

  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">待办忙度</h3>
      <p className="text-xs text-gray-400 mb-2">
        预测层：未完成待办按「截止×5 + 计划×3 + 重要度 + 复杂度」加权，用于未来日期；实际层：勾选当天计分，用于过去日期。
      </p>
      {!local ? (
        <p className="text-sm text-gray-400">加载中…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Field label="截止权重">
              <input type="number" step="0.5" className="tt-input w-full" value={local.weights.due_date}
                onChange={(e) => setNum(['weights', 'due_date'], e.target.value)} />
            </Field>
            <Field label="计划权重">
              <input type="number" step="0.5" className="tt-input w-full" value={local.weights.planned_date}
                onChange={(e) => setNum(['weights', 'planned_date'], e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Field label="重要度 高/中/低">
              <div className="flex gap-1">
                {(['high', 'medium', 'low'] as const).map((k) => (
                  <input key={k} type="number" step="0.5" className="tt-input w-14" value={local.weights.importance[k]}
                    onChange={(e) => setNum(['weights', 'importance', k], e.target.value)} />
                ))}
              </div>
            </Field>
            <Field label="复杂度 高/中/低">
              <div className="flex gap-1">
                {(['high', 'medium', 'low'] as const).map((k) => (
                  <input key={k} type="number" step="0.5" className="tt-input w-14" value={local.weights.complexity[k]}
                    onChange={(e) => setNum(['weights', 'complexity', k], e.target.value)} />
                ))}
              </div>
            </Field>
          </div>
          <Field label="分档阈值（5 个）">
            <div className="flex gap-1">
              {local.thresholds.map((t, i) => (
                <input key={i} type="number" className="tt-input w-12" value={t}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isNaN(n)) return
                    const next = structuredClone(local)
                    next.thresholds[i] = n
                    setLocal(next)
                  }} />
              ))}
            </div>
          </Field>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-gray-500 flex-shrink-0">预测层</span>
            <div className="flex gap-1">
              {local.predict_colors.map((c, i) => (
                <input key={i} type="color" value={c} title={`档位 ${i + 1}`}
                  onChange={(e) => {
                    const next = structuredClone(local)
                    next.predict_colors[i] = e.target.value
                    setLocal(next)
                  }} />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-gray-500 flex-shrink-0">实际层</span>
            <div className="flex gap-1">
              {local.done_colors.map((c, i) => (
                <input key={i} type="color" value={c} title={`档位 ${i + 1}`}
                  onChange={(e) => {
                    const next = structuredClone(local)
                    next.done_colors[i] = e.target.value
                    setLocal(next)
                  }} />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
            >
              {saveMut.isPending ? '保存中…' : '保存并重算'}
            </button>
            {msg && <span className="text-sm text-green-600">{msg}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function CustomLayerRow({ layer, onToggle }: { layer: Layer; onToggle: (id: string) => void }) {
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const delMut = useMutation({
    mutationFn: () => deleteLayer(layer.layer_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['layers'] })
      qc.invalidateQueries({ queryKey: ['view'] })
      setConfirming(false)
    },
  })
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50">
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: layer.color ?? '#9ca3af' }} />
      <span className="flex-1 text-sm text-gray-700 truncate">{layer.display_name}</span>
      <button
        onClick={() => onToggle(layer.layer_id)}
        aria-pressed={layer.enabled}
        className={clsx(
          'relative inline-flex items-center w-8 h-[18px] rounded-full transition-colors flex-shrink-0',
          layer.enabled ? 'bg-blue-500' : 'bg-gray-300',
        )}
      >
        <span
          className={clsx(
            'inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform duration-200',
            layer.enabled ? 'translate-x-[16px]' : 'translate-x-[2px]',
          )}
        />
      </button>
      {confirming ? (
        <button
          onClick={() => delMut.mutate()}
          className="text-[11px] text-red-600 bg-red-50 px-2 py-0.5 rounded hover:bg-red-100"
        >
          确认删除
        </button>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="text-gray-300 hover:text-red-500 p-1"
          title="删除图层（标记数据不会保留）"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}

function LayerAccordion({ layer, onToggle }: { layer: Layer; onToggle: (id: string) => void }) {  const [open, setOpen] = useState(false)
  return (
    <div className="border border-gray-200 rounded-md">
      <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: layer.color ?? '#9ca3af' }}
        />
        <span className="flex-1 text-sm text-gray-700 truncate">{layer.display_name}</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] text-blue-600 hover:text-blue-700 px-2"
        >
          {open ? '收起子动作' : '展开子动作'}
        </button>
        <button
          onClick={() => onToggle(layer.layer_id)}
          aria-pressed={layer.enabled}
          className={clsx(
            'relative inline-flex items-center w-8 h-[18px] rounded-full transition-colors flex-shrink-0',
            layer.enabled ? 'bg-blue-500' : 'bg-gray-300',
          )}
        >
          <span
            className={clsx(
              'inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform duration-200',
              layer.enabled ? 'translate-x-[16px]' : 'translate-x-[2px]',
            )}
          />
        </button>
      </div>
      {open && <LayerSubActions layer={layer} />}
    </div>
  )
}

function LayerSubActions({ layer }: { layer: Layer }) {
  const qc = useQueryClient()
  const { data: pairs = [], isLoading } = useQuery({
    queryKey: ['subActions', layer.layer_id],
    queryFn: () => getLayerSubActions(layer.layer_id),
  })
  // 本地乐观 state：点击立即反馈，不依赖父组件 layers props（localLayers 快照不会随 invalidate 更新）
  const [current, setCurrent] = useState<{ qtype: string; sub_action: string | null }[]>(
    () => ((layer.config as Record<string, unknown>)?.sub_qtypes as { qtype: string; sub_action: string | null }[] | undefined) ?? [],
  )
  const configMut = useMutation({
    mutationFn: (sub_qtypes: { qtype: string; sub_action: string | null }[]) =>
      updateLayerConfig(layer.layer_id, { sub_qtypes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
      qc.invalidateQueries({ queryKey: ['layers'] })
    },
    onError: () => {
      // 失败回滚为 props 里的原始值
      setCurrent(((layer.config as Record<string, unknown>)?.sub_qtypes as { qtype: string; sub_action: string | null }[] | undefined) ?? [])
    },
  })

  const currentSet = new Set(current.map((r) => `${r.qtype}::${r.sub_action ?? ''}`))
  const allKey = `${layer.layer_id.replace('jisilu_', '')}::`

  const isChecked = (q: string, s: string | null) => {
    if (current.length === 0) return true  // 空 = 不过滤 = 全选
    return currentSet.has(`${q}::${s ?? ''}`)
  }
  const isAllOn = current.length === 0
  const toggle = (q: string, s: string | null) => {
    const next = isAllOn
      ? pairs.filter((p) => !(p.qtype === q && p.sub_action === s))
      : isChecked(q, s)
        ? current.filter((r) => !(r.qtype === q && r.sub_action === s))
        : Array.from(new Set([...current.map((r) => `${r.qtype}::${r.sub_action ?? ''}`), `${q}::${s ?? ''}`])).map((k) => {
            const [qq, ss] = k.split('::')
            return { qtype: qq, sub_action: ss || null }
          })
    setCurrent(next)
    configMut.mutate(next as never)
  }
  const resetAll = () => {
    setCurrent([])
    configMut.mutate([])
  }

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-3 py-2">
      {isLoading && <p className="text-xs text-gray-400">读取子动作中…</p>}
      {!isLoading && pairs.length === 0 && (
        <p className="text-xs text-gray-400">该图层暂无事件数据，无法列出子动作。请先在「事件导入」拉取一次。</p>
      )}
      {!isLoading && pairs.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] text-gray-500">{isAllOn ? '当前全部显示' : `已过滤 ${current.length}/${pairs.length}`}</p>
            {!isAllOn && (
              <button onClick={resetAll} className="text-[11px] text-blue-600 hover:text-blue-700">恢复全部</button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pairs.map((p) => {
              const checked = isChecked(p.qtype, p.sub_action)
              return (
                <button
                  key={`${p.qtype}::${p.sub_action}`}
                  onClick={() => toggle(p.qtype, p.sub_action)}
                  className={clsx(
                    'px-2 py-0.5 text-xs rounded border transition',
                    checked ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300',
                  )}
                >
                  {p.sub_action}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}