import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Modal, Field } from './ui/Modal'
import {
  createEvent,
  updateEvent,
  deleteEvent,
  upsertSchedule,
  upsertColoring,
  deleteColoring,
  upsertMark,
  deleteMark,
  searchEvents,
  getSubscriptions,
  createSubscription,
  patchSubscription,
  deleteSubscription,
  refreshSubscription,
  type Subscription,
  getScheduleItems,
  createScheduleItem,
  updateScheduleItem,
  deleteScheduleItem,
} from '../api/client'
import { Plus, Trash2 } from 'lucide-react'
import { COLORING_COLORS } from '../data'
import type { CalEvent, Layer, Schedule, ScheduleItem } from '../types'

const COLORING_LABELS = ['放松', '轻松', '适中', '充实', '高产']

// ===========================================================================
// 事件编辑器（新建 / 编辑）
// ===========================================================================

export function EventEditor({
  date,
  layers,
  event,
  onClose,
  fixedLayerId,
}: {
  date: string
  layers: Layer[]
  event?: CalEvent | null
  onClose: () => void
  fixedLayerId?: string
}) {
  const qc = useQueryClient()
  const isEdit = !!event
  const builtinLayers = layers.filter((l) => l.sort_order < 10)

  const [title, setTitle] = useState(event?.title ?? '')
  const [edate, setEdate] = useState(event?.date ?? date)
  const [layerId, setLayerId] = useState(event?.layer_id ?? fixedLayerId ?? 'important')
  const [description, setDescription] = useState(event?.description ?? '')
  const [color, setColor] = useState(event?.color ?? '')

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: CalEvent = {
        id: event?.id ?? null,
        layer_id: layerId,
        source: event?.source ?? 'manual',
        date: edate,
        title: title.trim(),
        description: description.trim() || null,
        color: color.trim() || null,
        extra: event?.extra ?? {},
        source_ref: event?.source_ref ?? null,
        sort_key: event?.sort_key ?? 0,
      }
      if (isEdit && event?.id) await updateEvent(event.id, payload)
      else await createEvent(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
      qc.invalidateQueries({ queryKey: ['countdown'] })
      onClose()
    },
  })

  const delMut = useMutation({
    mutationFn: () => (event?.id ? deleteEvent(event.id) : Promise.resolve({ ok: true })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
      qc.invalidateQueries({ queryKey: ['countdown'] })
      onClose()
    },
  })

  return (
    <Modal title={isEdit ? '编辑事件' : '新建事件'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="标题">
          <input className="tt-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <div className="flex gap-2">
          <Field label="日期">
            <input
              type="date"
              className="tt-input"
              value={edate}
              onChange={(e) => setEdate(e.target.value)}
            />
          </Field>
          {!fixedLayerId && (
            <Field label="图层">
              <select className="tt-input" value={layerId} onChange={(e) => setLayerId(e.target.value)}>
                {builtinLayers.map((l) => (
                  <option key={l.layer_id} value={l.layer_id}>
                    {l.display_name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Field label="描述（可选）">
          <textarea
            className="tt-input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="颜色（可选，#RRGGBB）">
          <input
            className="tt-input"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="#FF4D4D"
          />
        </Field>
        <div className="flex justify-between items-center mt-2">
          {isEdit ? (
            <button
              onClick={() => delMut.mutate()}
              className="text-sm text-red-500 hover:underline"
            >
              删除
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg"
            >
              取消
            </button>
            <button
              onClick={() => saveMut.mutate()}
              disabled={!title.trim() || saveMut.isPending}
              className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ===========================================================================
// 日程编辑器（多时段：每条含起止时间 + 标题，可增删）
// ===========================================================================

export function ScheduleEditor({
  date,
  onClose,
}: {
  date: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { data: items = [] } = useQuery({
    queryKey: ['scheduleItems', date],
    queryFn: () => getScheduleItems(date),
  })
  const [rows, setRows] = useState<ScheduleItem[] | null>(null)
  const effective = rows ?? items

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['scheduleItems'] })
    qc.invalidateQueries({ queryKey: ['view'] })
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      for (const r of effective) {
        if (r.id) await updateScheduleItem(r.id, r)
        else await createScheduleItem(r)
      }
    },
    onSuccess: () => {
      invalidate()
      onClose()
    },
  })

  const setRow = (i: number, patch: Partial<ScheduleItem>) => {
    setRows((prev) => {
      const base = prev ?? items
      const next = base.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
      return next
    })
  }

  const addRow = () => {
    setRows((prev) => {
      const base = prev ?? items
      return [...base, { id: null, date, start_time: '09:00', end_time: '10:00', title: '', color: null, category: 'work', sort_order: base.length }]
    })
  }

  const removeRow = (i: number) => {
    setRows((prev) => {
      const base = prev ?? items
      const target = base[i]
      if (target?.id) deleteScheduleItem(target.id).then(() => invalidate()).catch(() => {})
      return base.filter((_, idx) => idx !== i)
    })
  }

  return (
    <Modal title={`日程 ${date}`} onClose={onClose} width={560}>
      <div className="flex flex-col gap-2">
        {effective.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">当天没有日程，点「添加日程」开始</p>
        )}
        {effective.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="flex items-center gap-2 border border-gray-200 rounded-lg px-2 py-2">
            <input
              type="time"
              className="tt-input w-[90px] text-sm"
              value={r.start_time ?? ''}
              onChange={(e) => setRow(i, { start_time: e.target.value || null })}
            />
            <span className="text-gray-400 text-xs">至</span>
            <input
              type="time"
              className="tt-input w-[90px] text-sm"
              value={r.end_time ?? ''}
              onChange={(e) => setRow(i, { end_time: e.target.value || null })}
            />
            <select
              className="tt-input w-[72px] text-sm"
              value={r.category ?? 'work'}
              onChange={(e) => setRow(i, { category: e.target.value })}
            >
              <option value="work">工作</option>
              <option value="course">课程</option>
              <option value="sport">运动</option>
              <option value="play">玩耍</option>
              <option value="other">其他</option>
            </select>
            <input
              className="tt-input flex-1 text-sm py-1.5"
              placeholder="做什么"
              value={r.title}
              onChange={(e) => setRow(i, { title: e.target.value })}
            />
            <button
              onClick={() => removeRow(i)}
              className="text-gray-400 hover:text-red-500 p-1"
              title="删除这条日程"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="flex justify-between items-center mt-2">
          <button
            onClick={addRow}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
          >
            <Plus size={14} /> 添加日程
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">
              取消
            </button>
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || effective.some((r) => !r.title.trim())}
              className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ===========================================================================
// 充实度选择器（5 档 + 清除）
// ===========================================================================

export function ColoringPicker({
  date,
  current,
  onClose,
}: {
  date: string
  current: number | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const setMut = useMutation({
    mutationFn: (lvl: number) => upsertColoring(date, lvl),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
      onClose()
    },
  })
  const clearMut = useMutation({
    mutationFn: () => deleteColoring(date),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
      onClose()
    },
  })

  return (
    <Modal title={`充实度 ${date}`} onClose={onClose} width={380}>
      <p className="text-xs text-gray-500 mb-2">
        当前：{current != null ? COLORING_LABELS[current] : '未设'}
      </p>
      <div className="grid grid-cols-5 gap-2">
        {COLORING_COLORS.map((c, i) => (
          <button
            key={i}
            onClick={() => setMut.mutate(i)}
            style={{ backgroundColor: c }}
            className={`h-14 rounded-lg text-xs font-medium transition hover:scale-105 ${
              i >= 3 ? 'text-white' : 'text-gray-700'
            } ${current === i ? 'ring-2 ring-blue-400' : ''}`}
          >
            {COLORING_LABELS[i]}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-4">
        <button
          onClick={() => clearMut.mutate()}
          disabled={current == null}
          className="text-sm text-gray-500 hover:underline disabled:opacity-40"
        >
          清除
        </button>
        <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">
          关闭
        </button>
      </div>
    </Modal>
  )
}

// ===========================================================================
// 搜索对话框
// ===========================================================================

export function SearchDialog({
  onClose,
  onJump,
}: {
  onClose: () => void
  onJump: (ev: CalEvent) => void
}) {
  const [q, setQ] = useState('')
  const { data, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => searchEvents(q),
    enabled: q.trim().length > 0,
  })

  return (
    <Modal title="搜索事件" onClose={onClose} width={520}>
      <input
        className="tt-input mb-3"
        placeholder="输入关键词…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <div className="max-h-72 overflow-y-auto -mx-1">
        {q.trim() && !isFetching && data && data.length === 0 && (
          <p className="text-sm text-gray-400 px-1 py-2">未找到匹配「{q}」的事件</p>
        )}
        {data?.map((ev, i) => (
          <button
            key={ev.id ?? i}
            onClick={() => onJump(ev)}
            className="w-full flex items-center gap-2 px-2 py-2 hover:bg-gray-50 rounded-md text-left"
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: ev.color ?? '#9ca3af' }}
            />
            <span className="flex-1 text-sm text-gray-700 truncate">{ev.title}</span>
            <span className="text-xs text-gray-400">{ev.date}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

// ===========================================================================
// 订阅面板（外部日历数据源；适配流程见 docs/SUBSCRIPTION_SPEC.md）
// ===========================================================================

export function SubscriptionDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data: subs = [], isLoading } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: getSubscriptions,
  })
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [rules, setRules] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState<string | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['subscriptions'] })
    qc.invalidateQueries({ queryKey: ['view'] })
  }

  const createMut = useMutation({
    mutationFn: () => createSubscription({
      display_name: name, url, rules_text: rules, auto_update: true,
    }),
    onSuccess: () => {
      setAdding(false); setName(''); setUrl(''); setRules('')
      invalidate()
    },
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { enabled?: boolean; auto_update?: boolean } }) =>
      patchSubscription(id, data),
    onSuccess: invalidate,
  })

  const delMut = useMutation({
    mutationFn: deleteSubscription,
    onSuccess: invalidate,
  })

  const onRefresh = async (s: Subscription) => {
    setRefreshing(s.id); setMsg(null)
    try {
      const r = await refreshSubscription(s.id)
      setMsg(r.ok ? `「${s.display_name}」已更新（新增 ${r.inserted ?? 0} 条）` : `「${s.display_name}」更新失败：${r.error}`)
      invalidate()
    } catch (e) {
      setMsg(`「${s.display_name}」更新失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally { setRefreshing(null) }
  }

  const pending = subs.filter((s) => s.status === 'pending')

  return (
    <Modal title="订阅" onClose={onClose} width={560}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-gray-400">
          订阅外部日历数据源，打开日历时自动保持最新。新增自定义订阅后需由你的 agent 完成适配（应用内会提示）。
        </p>

        {pending.length > 0 && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            <p className="font-medium mb-1">有 {pending.length} 个订阅待适配</p>
            <p className="text-xs leading-relaxed">
              请把 TT_Calendar 文件夹用您的 agent 软件打开，并提醒 agent 有新的订阅要做适配
              （agent 将读取下方「待适配」卡片里的登记信息，按 docs/SUBSCRIPTION_SPEC.md 完成适配）。
            </p>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-gray-400 py-4 text-center">加载中…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {subs.map((s) => (
              <div key={s.id} className={`p-3 rounded-lg border ${s.status === 'pending' ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200'}`}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleMut.mutate({ id: s.id, data: { enabled: !s.enabled } })}
                    aria-pressed={s.enabled}
                    className={clsx(
                      'relative inline-flex items-center w-8 h-[18px] rounded-full transition-colors flex-shrink-0',
                      s.enabled ? 'bg-blue-500' : 'bg-gray-300',
                    )}
                    title={s.enabled ? '关闭订阅' : '开启订阅'}
                  >
                    <span className={clsx(
                      'inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform duration-200',
                      s.enabled ? 'translate-x-[16px]' : 'translate-x-[2px]',
                    )} />
                  </button>
                  <span className="text-sm text-gray-800 font-medium flex-1 truncate">{s.display_name}</span>
                  {s.status === 'pending' && <Badge className="bg-amber-100 text-amber-700">待适配</Badge>}
                  {s.status === 'error' && <Badge className="bg-red-100 text-red-600">出错</Badge>}
                  {s.status === 'active' && s.last_synced_at && (
                    <span className="text-[11px] text-gray-400">更新于 {s.last_synced_at.slice(5, 16)}</span>
                  )}
                </div>
                {s.status === 'error' && s.last_error && (
                  <p className="mt-1 text-[11px] text-red-400 truncate" title={s.last_error}>{s.last_error}</p>
                )}
                {s.status === 'pending' && (
                  <div className="mt-2 text-[11px] text-gray-500 bg-white/60 rounded p-2 space-y-0.5">
                    <p><span className="text-gray-400">网址：</span>{s.url ?? '（无）'}</p>
                    <p className="whitespace-pre-wrap"><span className="text-gray-400">规则：</span>{s.rules_text ?? '（无）'}</p>
                  </div>
                )}
                <div className="mt-2 flex items-center gap-3">
                  <label className="flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={s.auto_update}
                      onChange={(e) => toggleMut.mutate({ id: s.id, data: { auto_update: e.target.checked } })}
                    />
                    打开时自动更新
                  </label>
                  {s.status === 'active' && (
                    <button
                      onClick={() => onRefresh(s)}
                      disabled={refreshing === s.id}
                      className="text-[11px] text-blue-600 hover:text-blue-700 disabled:opacity-40"
                    >
                      {refreshing === s.id ? '更新中…' : '立即更新'}
                    </button>
                  )}
                  {s.id !== 'builtin:jisilu' && (
                    <button
                      onClick={() => { if (confirm(`删除订阅「${s.display_name}」？（已抓取的事件数据保留）`)) delMut.mutate(s.id) }}
                      className="text-[11px] text-gray-400 hover:text-red-500 ml-auto"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {msg && <p className="text-xs text-gray-600 bg-gray-50 rounded-md px-3 py-2">{msg}</p>}

        {adding ? (
          <div className="p-3 rounded-lg border border-blue-100 bg-blue-50/40 space-y-2">
            <Field label="标题">
              <input className="tt-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：高金讲座日历" />
            </Field>
            <Field label="网址">
              <input className="tt-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </Field>
            <Field label="订阅规则（自然语言，给你的 agent 读）">
              <textarea
                className="tt-input min-h-[72px] text-sm"
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder="描述这个日历在哪、怎么抓、哪些字段、什么频率更新……"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">取消</button>
              <button
                onClick={() => createMut.mutate()}
                disabled={!name.trim() || createMut.isPending}
                className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
              >
                {createMut.isPending ? '提交中…' : '确认订阅'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center justify-center gap-1 px-3 py-2 text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:text-blue-600"
          >
            <Plus size={14} /> 新增订阅
          </button>
        )}
      </div>
    </Modal>
  )
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${className ?? 'bg-gray-100 text-gray-500'}`}>{children}</span>
}

// ===========================================================================
// 右键上下文菜单（定位浮层，非 Modal）
// ===========================================================================

export function ContextMenu({
  x,
  y,
  date,
  onNew,
  onSchedule,
  onColoring,
  onClose,
}: {
  x: number
  y: number
  date: string
  onNew: () => void
  onSchedule: () => void
  onColoring: () => void
  onClose: () => void
}) {
  const items = [
    { label: '新建事件', action: onNew },
    { label: '编辑日程', action: onSchedule },
    { label: '设置充实度', action: onColoring },
  ]
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[180px]"
        style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 140) }}
      >
        <div className="px-3 py-1 text-[11px] text-gray-400 border-b border-gray-100 mb-1">{date}</div>
        {items.map((it) => (
          <button
            key={it.label}
            onClick={it.action}
            className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600"
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  )
}

// ===========================================================================
// 当日新增：点点条目（选点点图层 + 时间 + 标题）
// ===========================================================================

export function DotEntryDialog({
  date,
  layers,
  onClose,
}: {
  date: string
  layers: Layer[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  // 点点图层候选：自定义 dot 图层（含日程类）、其他非外部数据源的 dot 图层。
  // 不限 enabled（让用户能给隐藏中的图层添加内容），排除 jisilu_* 外部数据源（手动加会被同步覆盖）
  // 和顶层 schedule 图层（已弃用，AM/PM/EV 结构被 schedule_items 取代）。
  const SCHEDULE_CATEGORIES = ['work', 'course', 'sport', 'play', 'other']
  const dotLayers = layers.filter((l) =>
    l.kind === 'dot'
    && !l.layer_id.startsWith('jisilu_')
    && l.layer_id !== 'schedule',
  )
  // 日程类点点图层：config.category 属于 5 种日程分类之一
  const scheduleCatLayers = dotLayers.filter((l) => {
    const cat = (l.config as Record<string, unknown>)?.category as string | undefined
    return SCHEDULE_CATEGORIES.includes(cat ?? '')
  })
  const otherDotLayers = dotLayers.filter((l) => {
    const cat = (l.config as Record<string, unknown>)?.category as string | undefined
    return !SCHEDULE_CATEGORIES.includes(cat ?? '')
  })
  const firstOpt = scheduleCatLayers.find((l) => l.enabled) ?? otherDotLayers.find((l) => l.enabled) ?? scheduleCatLayers[0] ?? otherDotLayers[0]
  const [targetLayer, setTargetLayer] = useState<string>(firstOpt?.layer_id ?? '')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [title, setTitle] = useState('')

  const targetCfg = layers.find((l) => l.layer_id === targetLayer)
  const targetCategory = (targetCfg?.config as Record<string, unknown>)?.category as string | undefined
  const isSchedule = SCHEDULE_CATEGORIES.includes(targetCategory ?? '')
  const targetColor = targetCfg?.color ?? '#3D6BFB'

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error('请填写内容')
      if (isSchedule) {
        await createScheduleItem({
          id: null, date, start_time: startTime || null, end_time: endTime || null,
          title: title.trim(), color: targetColor, category: targetCategory ?? 'other', sort_order: 0,
        })
      } else {
        await createEvent({
          id: null, layer_id: targetLayer, source: 'manual', date, title: title.trim(),
          description: null, color: targetColor, extra: {}, source_ref: null, sort_key: 0,
        })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
      qc.invalidateQueries({ queryKey: ['scheduleItems'] })
      onClose()
    },
  })

  return (
    <Modal title={`新增点点 ${date}`} onClose={onClose} width={480}>
      <div className="flex flex-col gap-3">
        <Field label="选择图层">
          <select className="tt-input" value={targetLayer} onChange={(e) => setTargetLayer(e.target.value)}>
            {scheduleCatLayers.length > 0 && (
              <optgroup label="日程">
                {scheduleCatLayers.map((l) => (
                  <option key={l.layer_id} value={l.layer_id}>
                    {l.display_name}{l.enabled ? '' : '（隐藏）'}
                  </option>
                ))}
              </optgroup>
            )}
            {otherDotLayers.length > 0 && (
              <optgroup label="其他">
                {otherDotLayers.map((l) => (
                  <option key={l.layer_id} value={l.layer_id}>
                    {l.display_name}{l.enabled ? '' : '（隐藏）'}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>

        <div className="flex items-center gap-2">
          <input type="time" className="tt-input w-[110px]" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <span className="text-gray-400 text-xs">至</span>
          <input type="time" className="tt-input w-[110px]" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: targetColor }} title="图层颜色" />
        </div>

        <Field label="内容">
          <textarea
            className="tt-input min-h-[72px] resize-y"
            placeholder="做什么（可多行）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">取消</button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !title.trim()}
            className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
          >
            添加
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ===========================================================================
// 当日新增：涂色（选涂色图层 + 颜色档位）
// ===========================================================================

export function ColorEntryDialog({
  date,
  layers,
  onClose,
}: {
  date: string
  layers: Layer[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  // 自动涂色图层（holiday/important/todo/todo_done）和外部数据源（jisilu_*）不允许手动新增标记
  const AUTO_LAYERS = ['holiday', 'important', 'todo', 'todo_done']
  const colorLayers = layers.filter((l) =>
    l.kind === 'color'
    && !l.layer_id.startsWith('jisilu_')
    && !AUTO_LAYERS.includes(l.layer_id),
  )
  const firstOpt =
    colorLayers.find((l) => l.layer_id === 'coloring') ??
    colorLayers.find((l) => l.layer_id.startsWith('custom_') && l.enabled) ??
    colorLayers.find((l) => l.layer_id === 'important') ??
    colorLayers[0]
  const [targetLayer, setTargetLayer] = useState<string>(firstOpt?.layer_id ?? '')
  const [level, setLevel] = useState<number>(2)

  const targetCfg = layers.find((l) => l.layer_id === targetLayer)
  const mode = (targetCfg?.config as Record<string, unknown>)?.mode as string | undefined
  const isColoring = targetLayer === 'coloring'
  const isGraded = mode === 'graded'
  const palette = (targetCfg?.config as Record<string, unknown>)?.palette as string[] | undefined

  const saveMut = useMutation({
    mutationFn: async () => {
      if (isColoring) {
        await upsertColoring(date, level)
        return
      }
      // 自定义涂色图层走 marks 表（打卡/完成度），不进 events
      await upsertMark(targetLayer, date, isGraded ? level : null)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
      onClose()
    },
  })

  // 按 mode 分组：打卡（solid）/ 完成度（graded + 内置 coloring）/ 关联（tag）
  const grouped: { label: string; items: typeof colorLayers }[] = [
    { label: '习惯打卡', items: colorLayers.filter((l) => {
        if (l.layer_id === 'coloring') return false
        const m = (l.config as Record<string, unknown>)?.mode as string | undefined
        return m === 'solid' || !m
      }) },
    { label: '工作完成度', items: colorLayers.filter((l) => {
        if (l.layer_id === 'coloring') return true
        const m = (l.config as Record<string, unknown>)?.mode as string | undefined
        return m === 'graded'
      }) },
    { label: '关联涂色', items: colorLayers.filter((l) => {
        const m = (l.config as Record<string, unknown>)?.mode as string | undefined
        return m === 'tag'
      }) },
  ]

  return (
    <Modal title={`新增涂色 ${date}`} onClose={onClose} width={440}>
      <div className="flex flex-col gap-3">
        <Field label="选择涂色图层">
          <select className="tt-input" value={targetLayer} onChange={(e) => setTargetLayer(e.target.value)}>
            {grouped.map((g) =>
              g.items.length > 0 ? (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((l) => (
                    <option key={l.layer_id} value={l.layer_id}>
                      {l.display_name}{l.enabled ? '' : '（隐藏）'}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </select>
        </Field>

        {isColoring ? (
          <Field label="充实度档位">
            <div className="grid grid-cols-5 gap-2">
              {COLORING_COLORS.map((c, i) => (
                <button
                  key={i}
                  onClick={() => setLevel(i)}
                  style={{ backgroundColor: c }}
                  className={clsx('h-12 rounded-lg text-xs font-medium', i >= 3 ? 'text-white' : 'text-gray-700', level === i && 'ring-2 ring-blue-400')}
                >
                  {COLORING_LABELS[i]}
                </button>
              ))}
            </div>
          </Field>
        ) : isGraded && palette ? (
          <Field label="档位">
            <div className="grid grid-cols-5 gap-2">
              {palette.map((c, i) => (
                <button
                  key={i}
                  onClick={() => setLevel(i)}
                  style={{ backgroundColor: c }}
                  className={clsx('h-12 rounded-lg', level === i && 'ring-2 ring-blue-400')}
                />
              ))}
            </div>
          </Field>
        ) : (
          <Field label="图层颜色（固定）">
            <div className="flex items-center gap-2">
              <span
                className="w-8 h-8 rounded-lg flex-shrink-0"
                style={{ backgroundColor: targetCfg?.color ?? '#9ca3af' }}
              />
              <p className="text-[11px] text-gray-400">
                标记将使用图层预设颜色，不可在此修改。如需改色请到设置页编辑图层。
              </p>
            </div>
          </Field>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">取消</button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
          >
            标记
          </button>
        </div>
      </div>
    </Modal>
  )
}
