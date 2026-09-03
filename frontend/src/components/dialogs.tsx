import { useMemo, useState } from 'react'
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
  createTodo,
  getTodoLists,
  createTodoList,
} from '../api/client'
import { Plus, Trash2 } from 'lucide-react'
import { COLORING_COLORS, dateRange } from '../data'
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
      return [...base, {
        id: null, date, end_date: null, start_time: '09:00', end_time: '10:00',
        title: '', color: null, category: 'work', sort_order: base.length,
      }]
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
        {effective.map((r, i) => {
          const spanBad = !!r.end_date && r.end_date < r.date
          const spanDays = r.end_date && !spanBad ? dateRange(r.date, r.end_date).length : 1
          return (
            <div key={r.id ?? `new-${i}`} className="flex flex-col gap-1.5 border border-gray-200 rounded-lg px-2 py-2">
              <div className="flex items-center gap-2">
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
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400 flex-shrink-0">日期</span>
                <input
                  type="date"
                  className="tt-input w-[132px] text-sm"
                  value={r.date}
                  onChange={(e) => setRow(i, { date: e.target.value })}
                />
                <span className="text-gray-400 text-xs">至</span>
                <input
                  type="date"
                  className="tt-input w-[132px] text-sm"
                  value={r.end_date ?? ''}
                  min={r.date}
                  onChange={(e) => setRow(i, { end_date: e.target.value || null })}
                  title="留空 = 单日；填了就是多日日程，每天都显示"
                />
                <span className={clsx('text-[11px]', spanBad ? 'text-red-500' : 'text-gray-400')}>
                  {spanBad ? '结束日期早于开始日期' : spanDays > 1 ? `多日 · 共 ${spanDays} 天` : '单日'}
                </span>
              </div>
            </div>
          )
        })}
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
              disabled={saveMut.isPending || effective.some((r) => !r.title.trim() || (!!r.end_date && r.end_date < r.date))}
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
// 当日新增：统一入口（呈现方式 = 涂色 / 点点 + 多日区间 + 自动建待办）
// ===========================================================================

const SCHEDULE_CATEGORIES = ['work', 'course', 'sport', 'play', 'other']
/** 自动创建待办时使用的列表名；不存在则自动建（见 ensureScheduleTodoList） */
const SCHEDULE_TODO_LIST = '日程待办'
const AUTO_TODO_PREF_KEY = 'day-entry:auto-todo'

function cfgOf(layer: Layer | undefined): Record<string, unknown> {
  return (layer?.config ?? {}) as Record<string, unknown>
}

/** 找到「日程待办」列表，没有就建一个；并发/重复调用以服务端已有为准 */
async function ensureScheduleTodoList() {
  const lists = await getTodoLists()
  return lists.find((l) => l.display_name === SCHEDULE_TODO_LIST)
    ?? (await createTodoList(SCHEDULE_TODO_LIST))
}

export function DayEntryDialog({
  date,
  layers,
  initialKind = 'dot',
  onClose,
}: {
  date: string
  layers: Layer[]
  /** 双击默认「点点」（多数时候是记日程）；侧栏「涂色」按钮传 'color' */
  initialKind?: 'dot' | 'color'
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [kind, setKind] = useState<'dot' | 'color'>(initialKind)

  // ---- 日期区间：endDate 为空 = 单日 ----
  const [startDate, setStartDate] = useState(date)
  const [endDate, setEndDate] = useState('')
  const rangeInvalid = !!endDate && endDate < startDate
  const dates = useMemo(
    () => (rangeInvalid ? [startDate] : dateRange(startDate, endDate || null)),
    [startDate, endDate, rangeInvalid],
  )
  const isMulti = dates.length > 1
  const lastDate = dates[dates.length - 1]!

  // ---- 点点侧 ----
  // 排除 jisilu_* 外部数据源（手动加会被同步覆盖）和已弃用的顶层 schedule 图层
  const dotLayers = layers.filter((l) =>
    l.kind === 'dot' && !l.layer_id.startsWith('jisilu_') && l.layer_id !== 'schedule',
  )
  const scheduleCatLayers = dotLayers.filter((l) => SCHEDULE_CATEGORIES.includes(cfgOf(l).category as string ?? ''))
  const otherDotLayers = dotLayers.filter((l) => !SCHEDULE_CATEGORIES.includes(cfgOf(l).category as string ?? ''))
  const firstDot = scheduleCatLayers.find((l) => l.enabled) ?? otherDotLayers.find((l) => l.enabled) ?? scheduleCatLayers[0] ?? otherDotLayers[0]
  const [dotLayerId, setDotLayerId] = useState(firstDot?.layer_id ?? '')
  const [allDay, setAllDay] = useState(false)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [title, setTitle] = useState('')

  const dotCfg = layers.find((l) => l.layer_id === dotLayerId)
  const dotCategory = cfgOf(dotCfg).category as string | undefined
  const isScheduleItem = SCHEDULE_CATEGORIES.includes(dotCategory ?? '')
  const dotColor = dotCfg?.color ?? '#3D6BFB'

  // ---- 涂色侧 ----
  const AUTO_LAYERS = ['holiday', 'important', 'todo', 'todo_done']
  const colorLayers = layers.filter((l) =>
    l.kind === 'color' && !l.layer_id.startsWith('jisilu_') && !AUTO_LAYERS.includes(l.layer_id),
  )
  const firstColor =
    colorLayers.find((l) => l.layer_id === 'coloring') ??
    colorLayers.find((l) => l.layer_id.startsWith('custom_') && l.enabled) ??
    colorLayers[0]
  const [colorLayerId, setColorLayerId] = useState(firstColor?.layer_id ?? '')
  const [level, setLevel] = useState(2)

  const colorCfg = layers.find((l) => l.layer_id === colorLayerId)
  const cmode = cfgOf(colorCfg).mode as string | undefined
  const isColoring = colorLayerId === 'coloring'
  const isGraded = cmode === 'graded'
  const palette = cfgOf(colorCfg).palette as string[] | undefined
  const colorValue = isColoring
    ? COLORING_COLORS[level]
    : isGraded && palette
      ? palette[level] ?? colorCfg?.color ?? '#9ca3af'
      : colorCfg?.color ?? '#9ca3af'

  // ---- 自动建待办 ----
  // 默认不勾（opt-in）：用户明确要求「允许选择是否自动创建」，默认开会让没注意到的人
  // 待办列表被日程刷屏；勾选状态用 localStorage 记住，勾过一次以后保持。
  const [autoTodo, setAutoTodo] = useState<boolean>(() => {
    return localStorage.getItem(AUTO_TODO_PREF_KEY) === '1'
  })
  const setAutoTodoPersist = (v: boolean) => {
    setAutoTodo(v)
    localStorage.setItem(AUTO_TODO_PREF_KEY, v ? '1' : '0')
  }
  const todoTitle = kind === 'dot' ? title.trim() : (colorCfg?.display_name ?? '涂色')
  const todoBodyParts: string[] = []
  if (isMulti) todoBodyParts.push(`${startDate} ~ ${lastDate}（${dates.length} 天）`)
  if (kind === 'dot' && !allDay) todoBodyParts.push(`${startTime}-${endTime}`)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['view'] })
    qc.invalidateQueries({ queryKey: ['scheduleItems'] })
    qc.invalidateQueries({ queryKey: ['todos'] })
    qc.invalidateQueries({ queryKey: ['todoStats'] })
    qc.invalidateQueries({ queryKey: ['todoLists'] })
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (kind === 'dot') {
        if (!title.trim()) throw new Error('请填写内容')
        if (isScheduleItem) {
          // 多日日程：库里只存一行（date=起始日 + end_date），由后端聚合层展开到每一天
          await createScheduleItem({
            id: null,
            date: startDate,
            end_date: isMulti ? lastDate : null,
            start_time: allDay ? null : startTime || null,
            end_time: allDay ? null : endTime || null,
            title: title.trim(),
            color: dotColor,
            category: dotCategory ?? 'other',
            sort_order: 0,
          })
        } else {
          // 非日程类点点图层落在 events 表（按天一行），多日就每天建一条
          for (const d of dates) {
            await createEvent({
              id: null, layer_id: dotLayerId, source: 'manual', date: d, title: title.trim(),
              description: null, color: dotColor, extra: {}, source_ref: null, sort_key: 0,
            })
          }
        }
      } else if (isColoring) {
        for (const d of dates) await upsertColoring(d, level)
      } else {
        // 自定义涂色图层走 marks 表（打卡/完成度），同样按天写
        for (const d of dates) await upsertMark(colorLayerId, d, isGraded ? level : null)
      }

      if (autoTodo) {
        const list = await ensureScheduleTodoList()
        await createTodo({
          list_id: list.id,
          title: todoTitle || '日程',
          body: todoBodyParts.join(' · ') || null,
          planned_date: startDate,
          due_date: lastDate,
        })
      }
    },
    onSuccess: () => {
      invalidate()
      onClose()
    },
  })

  const canSave = kind === 'color' || title.trim().length > 0
  const dotSaveDisabled = saveMut.isPending || !canSave || rangeInvalid || !dotLayerId
  const colorSaveDisabled = saveMut.isPending || !colorLayerId || rangeInvalid

  return (
    <Modal title={`新建 ${date}`} onClose={onClose} width={520}>
      <div className="flex flex-col gap-3">
        {/* 呈现方式：决定这条内容在日历上是「涂色」还是「点点/日程」 */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
          {([['dot', '点点 / 日程'], ['color', '涂色']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={clsx(
                'flex-1 py-1.5 text-sm rounded-md transition',
                kind === k ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Field label="开始日期">
            <input
              type="date"
              className="tt-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="结束日期（可选，填了就是多日）">
            <input
              type="date"
              className="tt-input"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
        </div>
        {rangeInvalid && (
          <p className="text-[11px] text-red-500 -mt-1">结束日期不能早于开始日期</p>
        )}
        {isMulti && (
          <p className="text-[11px] text-blue-600 -mt-1">
            共 {dates.length} 天（{startDate} ~ {lastDate}）
            {kind === 'dot' && isScheduleItem && ' · 存为 1 条多日日程，每天都可见'}
            {kind === 'dot' && !isScheduleItem && ` · 按天建 ${dates.length} 条事件`}
            {kind === 'color' && ` · 连续 ${dates.length} 天都做标记`}
          </p>
        )}

        {kind === 'dot' ? (
          <>
            <Field label="选择图层">
              <select className="tt-input" value={dotLayerId} onChange={(e) => setDotLayerId(e.target.value)}>
                {scheduleCatLayers.length > 0 && (
                  <optgroup label="日程">
                    {scheduleCatLayers.map((l) => (
                      <option key={l.layer_id} value={l.layer_id}>{l.display_name}{l.enabled ? '' : '（隐藏）'}</option>
                    ))}
                  </optgroup>
                )}
                {otherDotLayers.length > 0 && (
                  <optgroup label="其他">
                    {otherDotLayers.map((l) => (
                      <option key={l.layer_id} value={l.layer_id}>{l.display_name}{l.enabled ? '' : '（隐藏）'}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
                全天
              </label>
              {!allDay && (
                <>
                  <input type="time" className="tt-input w-[104px]" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  <span className="text-gray-400 text-xs">至</span>
                  <input type="time" className="tt-input w-[104px]" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </>
              )}
              <span className="w-3 h-3 rounded-full flex-shrink-0 ml-auto" style={{ backgroundColor: dotColor }} title="图层颜色" />
            </div>

            <Field label="内容">
              <textarea
                className="tt-input min-h-[72px] resize-y"
                placeholder="做什么"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="选择涂色图层">
              <select className="tt-input" value={colorLayerId} onChange={(e) => setColorLayerId(e.target.value)}>
                {[
                  { label: '习惯打卡', items: colorLayers.filter((l) => l.layer_id !== 'coloring' && (cfgOf(l).mode === 'solid' || !cfgOf(l).mode)) },
                  { label: '工作完成度', items: colorLayers.filter((l) => l.layer_id === 'coloring' || cfgOf(l).mode === 'graded') },
                  { label: '关联涂色', items: colorLayers.filter((l) => cfgOf(l).mode === 'tag') },
                ].map((g) => g.items.length > 0 ? (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map((l) => (
                      <option key={l.layer_id} value={l.layer_id}>{l.display_name}{l.enabled ? '' : '（隐藏）'}</option>
                    ))}
                  </optgroup>
                ) : null)}
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
                  <span className="w-8 h-8 rounded-lg flex-shrink-0" style={{ backgroundColor: colorValue }} />
                  <p className="text-[11px] text-gray-400">标记使用图层预设颜色，如需改色请到设置页编辑图层。</p>
                </div>
              </Field>
            )}
          </>
        )}

        <label className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50/60 border border-amber-100 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={autoTodo}
            onChange={(e) => setAutoTodoPersist(e.target.checked)}
          />
          <span className="text-sm text-gray-700">
            同时创建对应待办
            <span className="block text-[11px] text-gray-500 mt-0.5">
              放入「{SCHEDULE_TODO_LIST}」列表（没有会自动创建）；
              计划日期 {startDate}
              {isMulti ? `、截止日期 ${lastDate}` : `、截止日期 ${startDate}`}
              {autoTodo && !todoTitle && ' · 标题将用「日程」'}
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">取消</button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={kind === 'dot' ? dotSaveDisabled : colorSaveDisabled}
            className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
          >
            {saveMut.isPending ? '保存中…' : '添加'}
          </button>
        </div>
        {saveMut.isError && (
          <p className="text-[11px] text-red-500">保存失败：{saveMut.error instanceof Error ? saveMut.error.message : '未知错误'}</p>
        )}
      </div>
    </Modal>
  )
}
