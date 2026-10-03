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
import { useT, type TxKey } from '../i18n'
import { Plus, Trash2 } from 'lucide-react'
import { COLORING_COLORS, dateRange } from '../data'
import type { CalEvent, Layer, Schedule, ScheduleItem } from '../types'

/** 充实度 5 档的字典 key（labelKey 模式：渲染时 t(m.labelKey)，模块常量不存文案） */
const COLORING_LABELS: { key: string; labelKey: TxKey }[] = [
  { key: 'relaxed', labelKey: 'dialogs.coloringLevel.relaxed' },
  { key: 'mild', labelKey: 'dialogs.coloringLevel.mild' },
  { key: 'moderate', labelKey: 'dialogs.coloringLevel.moderate' },
  { key: 'busy', labelKey: 'dialogs.coloringLevel.busy' },
  { key: 'productive', labelKey: 'dialogs.coloringLevel.productive' },
]

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
  const t = useT()
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
    <Modal title={isEdit ? t('dialogs.event.titleEdit') : t('dialogs.event.titleNew')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label={t('dialogs.event.fieldTitle')}>
          <input className="tt-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <div className="flex gap-2">
          <Field label={t('dialogs.event.fieldDate')}>
            <input
              type="date"
              className="tt-input"
              value={edate}
              onChange={(e) => setEdate(e.target.value)}
            />
          </Field>
          {!fixedLayerId && (
            <Field label={t('dialogs.event.fieldLayer')}>
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
        <Field label={t('dialogs.event.fieldDesc')}>
          <textarea
            className="tt-input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label={t('dialogs.event.fieldColor')}>
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
              {t('common.delete')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => saveMut.mutate()}
              disabled={!title.trim() || saveMut.isPending}
              className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
            >
              {t('common.save')}
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
  const t = useT()
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
    <Modal title={t('dialogs.schedule.titleWithDate', { date })} onClose={onClose} width={560}>
      <div className="flex flex-col gap-2">
        {effective.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">{t('dialogs.schedule.empty')}</p>
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
                <span className="text-gray-400 text-xs">{t('dialogs.toTime')}</span>
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
                  <option value="work">{t('dialogs.schedule.cat.work')}</option>
                  <option value="course">{t('dialogs.schedule.cat.course')}</option>
                  <option value="sport">{t('dialogs.schedule.cat.sport')}</option>
                  <option value="play">{t('dialogs.schedule.cat.play')}</option>
                  <option value="other">{t('dialogs.schedule.cat.misc')}</option>
                </select>
                <input
                  className="tt-input flex-1 text-sm py-1.5"
                  placeholder={t('dialogs.schedule.what')}
                  value={r.title}
                  onChange={(e) => setRow(i, { title: e.target.value })}
                />
                <button
                  onClick={() => removeRow(i)}
                  className="text-gray-400 hover:text-red-500 p-1"
                  title={t('dialogs.deleteScheduleItem')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400 flex-shrink-0">{t('dialogs.schedule.dateLabel')}</span>
                <input
                  type="date"
                  className="tt-input w-[132px] text-sm"
                  value={r.date}
                  onChange={(e) => setRow(i, { date: e.target.value })}
                />
                <span className="text-gray-400 text-xs">{t('dialogs.toTime')}</span>
                <input
                  type="date"
                  className="tt-input w-[132px] text-sm"
                  value={r.end_date ?? ''}
                  min={r.date}
                  onChange={(e) => setRow(i, { end_date: e.target.value || null })}
                  title={t('dialogs.schedule.endDateHint')}
                />
                <span className={clsx('text-[11px]', spanBad ? 'text-red-500' : 'text-gray-400')}>
                  {spanBad ? t('dialogs.schedule.spanBad') : spanDays > 1 ? t('dialogs.schedule.multiDay', { n: spanDays }) : t('dialogs.schedule.singleDay')}
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
            <Plus size={14} /> {t('dialogs.schedule.add')}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">
              {t('common.cancel')}
            </button>
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || effective.some((r) => !r.title.trim() || (!!r.end_date && r.end_date < r.date))}
              className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
            >
              {t('common.save')}
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
  const t = useT()
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
    <Modal title={t('dialogs.coloring.titleWithDate', { date })} onClose={onClose} width={380}>
      <p className="text-xs text-gray-500 mb-2">
        {t('dialogs.coloring.current', { level: current != null ? t(COLORING_LABELS[current].labelKey) : t('dialogs.coloring.notSet') })}
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
            {t(COLORING_LABELS[i].labelKey)}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-4">
        <button
          onClick={() => clearMut.mutate()}
          disabled={current == null}
          className="text-sm text-gray-500 hover:underline disabled:opacity-40"
        >
          {t('dialogs.coloring.clear')}
        </button>
        <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">
          {t('common.close')}
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
  const t = useT()
  const [q, setQ] = useState('')
  const { data, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => searchEvents(q),
    enabled: q.trim().length > 0,
  })

  return (
    <Modal title={t('dialogs.search.title')} onClose={onClose} width={520}>
      <input
        className="tt-input mb-3"
        placeholder={t('dialogs.search.placeholder')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <div className="max-h-72 overflow-y-auto -mx-1">
        {q.trim() && !isFetching && data && data.length === 0 && (
          <p className="text-sm text-gray-400 px-1 py-2">{t('dialogs.search.nothing', { q })}</p>
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
  const t = useT()
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
      setMsg(r.ok ? t('dialogs.subscription.updatedMsg', { name: s.display_name, n: r.inserted ?? 0 }) : t('dialogs.subscription.updateFailed', { name: s.display_name, error: r.error ?? '' }))
      invalidate()
    } catch (e) {
      setMsg(t('dialogs.subscription.updateFailed', { name: s.display_name, error: e instanceof Error ? e.message : t('dialogs.unknownError') }))
    } finally { setRefreshing(null) }
  }

  const pending = subs.filter((s) => s.status === 'pending')

  return (
    <Modal title={t('dialogs.subscription.title')} onClose={onClose} width={560}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-gray-400">
          {t('dialogs.subscription.intro')}
        </p>

        {pending.length > 0 && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            <p className="font-medium mb-1">{t('dialogs.subscription.pendingCount', { n: pending.length })}</p>
            <p className="text-xs leading-relaxed">
              {t('dialogs.subscription.pendingHint')}
            </p>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-gray-400 py-4 text-center">{t('common.loading')}</p>
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
                    title={s.enabled ? t('dialogs.subscription.toggleOff') : t('dialogs.subscription.toggleOn')}
                  >
                    <span className={clsx(
                      'inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform duration-200',
                      s.enabled ? 'translate-x-[16px]' : 'translate-x-[2px]',
                    )} />
                  </button>
                  <span className="text-sm text-gray-800 font-medium flex-1 truncate">{s.display_name}</span>
                  {s.status === 'pending' && <Badge className="bg-amber-100 text-amber-700">{t('dialogs.subscription.pendingBadge')}</Badge>}
                  {s.status === 'error' && <Badge className="bg-red-100 text-red-600">{t('dialogs.subscription.errorBadge')}</Badge>}
                  {s.status === 'active' && s.last_synced_at && (
                    <span className="text-[11px] text-gray-400">{t('dialogs.subscription.updatedAt', { time: s.last_synced_at.slice(5, 16) })}</span>
                  )}
                </div>
                {s.status === 'error' && s.last_error && (
                  <p className="mt-1 text-[11px] text-red-400 truncate" title={s.last_error}>{s.last_error}</p>
                )}
                {s.status === 'pending' && (
                  <div className="mt-2 text-[11px] text-gray-500 bg-white/60 rounded p-2 space-y-0.5">
                    <p><span className="text-gray-400">{t('dialogs.subscription.urlLabel')}</span>{s.url ?? t('dialogs.subscription.emptyValue')}</p>
                    <p className="whitespace-pre-wrap"><span className="text-gray-400">{t('dialogs.subscription.rulesLabel')}</span>{s.rules_text ?? t('dialogs.subscription.emptyValue')}</p>
                  </div>
                )}
<div className="mt-2 flex items-center gap-3">
                  <label className="flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={s.auto_update}
                      onChange={(e) => toggleMut.mutate({ id: s.id, data: { auto_update: e.target.checked } })}
                    />
                    {t('dialogs.subscription.autoUpdate')}
                  </label>
                  {s.status !== 'pending' && (
                    <button
                      onClick={() => onRefresh(s)}
                      disabled={refreshing === s.id}
                      className="text-[11px] text-blue-600 hover:text-blue-700 disabled:opacity-40"
                    >
                      {refreshing === s.id ? t('dialogs.subscription.refreshing') : t('dialogs.subscription.refresh')}
                    </button>
                  )}
                  {s.id !== 'builtin:jisilu' && (
                    <button
                      onClick={() => { if (confirm(t('dialogs.subscription.deleteConfirm', { name: s.display_name }))) delMut.mutate(s.id) }}
                      className="text-[11px] text-gray-400 hover:text-red-500 ml-auto"
                    >
                      {t('common.delete')}
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
            <Field label={t('dialogs.subscription.fieldTitle')}>
              <input className="tt-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dialogs.subscription.namePlaceholder')} />
            </Field>
            <Field label={t('dialogs.subscription.fieldUrl')}>
              <input className="tt-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </Field>
            <Field label={t('dialogs.subscription.fieldRules')}>
              <textarea
                className="tt-input min-h-[72px] text-sm"
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder={t('dialogs.subscription.rulesPlaceholder')}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">{t('common.cancel')}</button>
              <button
                onClick={() => createMut.mutate()}
                disabled={!name.trim() || createMut.isPending}
                className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
              >
                {createMut.isPending ? t('dialogs.subscription.submitting') : t('dialogs.subscription.confirmAdd')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center justify-center gap-1 px-3 py-2 text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:text-blue-600"
          >
            <Plus size={14} /> {t('dialogs.subscription.addNew')}
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
  const t = useT()
  const items: { labelKey: TxKey; action: () => void }[] = [
    { labelKey: 'dialogs.menu.newEvent', action: onNew },
    { labelKey: 'dialogs.menu.editSchedule', action: onSchedule },
    { labelKey: 'dialogs.menu.setColoring', action: onColoring },
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
            key={it.labelKey}
            onClick={it.action}
            className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600"
          >
            {t(it.labelKey)}
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
/** 自动创建待办时使用的列表名；不存在则自动建（见 ensureScheduleTodoList）。
 * 持久化数据（写入 todo_lists.display_name），非 UI 文案——手册 §5.1：数据保持原样，
 * 故带行级棘轮豁免（该字面量不随抽词清除）。 */
// eslint-disable-next-line no-restricted-syntax
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
  const t = useT()
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
  const todoTitle = kind === 'dot' ? title.trim() : (colorCfg?.display_name ?? t('dialogs.dayEntry.coloringWord'))
  const todoBodyParts: string[] = []
  // 自动建待办的 body 是持久化数据（写入 todos.body，展示于待办列表），非渲染期文案——
  // 手册 §5.1/§5.2 同步提示同款边界：结构化改版涉及数据面，不在 i18n 轮内做，原样保留。
  // eslint-disable-next-line no-restricted-syntax
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
        if (!title.trim()) throw new Error(t('dialogs.dayEntry.contentRequired'))
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
          title: todoTitle || t('dialogs.dayEntry.scheduleWord'),
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

  const colorGroups: { labelKey: TxKey; items: Layer[] }[] = [
    { labelKey: 'dialogs.dayEntry.groupHabit', items: colorLayers.filter((l) => l.layer_id !== 'coloring' && (cfgOf(l).mode === 'solid' || !cfgOf(l).mode)) },
    { labelKey: 'dialogs.dayEntry.groupProgress', items: colorLayers.filter((l) => l.layer_id === 'coloring' || cfgOf(l).mode === 'graded') },
    { labelKey: 'dialogs.dayEntry.groupLinked', items: colorLayers.filter((l) => cfgOf(l).mode === 'tag') },
  ]

  return (
    <Modal title={t('dialogs.dayEntry.titleWithDate', { date })} onClose={onClose} width={520}>
      <div className="flex flex-col gap-3">
        {/* 呈现方式：决定这条内容在日历上是「涂色」还是「点点/日程」 */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
          {([['dot', 'dialogs.dayEntry.tabDot'], ['color', 'dialogs.dayEntry.tabColor']] as const).map(([k, labelKey]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={clsx(
                'flex-1 py-1.5 text-sm rounded-md transition',
                kind === k ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Field label={t('dialogs.dayEntry.fieldStart')}>
            <input
              type="date"
              className="tt-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label={t('dialogs.dayEntry.fieldEnd')}>
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
          <p className="text-[11px] text-red-500 -mt-1">{t('dialogs.dayEntry.rangeInvalid')}</p>
        )}
        {isMulti && (
          <p className="text-[11px] text-blue-600 -mt-1">
            {t('dialogs.dayEntry.multiCount', { n: dates.length, range: `${startDate} ~ ${lastDate}` })}
            {kind === 'dot' && isScheduleItem && t('dialogs.dayEntry.suffixSchedule')}
            {kind === 'dot' && !isScheduleItem && t('dialogs.dayEntry.suffixEvents', { n: dates.length })}
            {kind === 'color' && t('dialogs.dayEntry.suffixColor', { n: dates.length })}
          </p>
        )}

        {kind === 'dot' ? (
          <>
            <Field label={t('dialogs.dayEntry.pickLayer')}>
              <select className="tt-input" value={dotLayerId} onChange={(e) => setDotLayerId(e.target.value)}>
                {scheduleCatLayers.length > 0 && (
                  <optgroup label={t('dialogs.dayEntry.groupSchedule')}>
                    {scheduleCatLayers.map((l) => (
                      <option key={l.layer_id} value={l.layer_id}>{l.display_name}{l.enabled ? '' : t('dialogs.hiddenSuffix')}</option>
                    ))}
                  </optgroup>
                )}
                {otherDotLayers.length > 0 && (
                  <optgroup label={t('dialogs.dayEntry.groupOther')}>
                    {otherDotLayers.map((l) => (
                      <option key={l.layer_id} value={l.layer_id}>{l.display_name}{l.enabled ? '' : t('dialogs.hiddenSuffix')}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
                {t('dialogs.dayEntry.allDay')}
              </label>
              {!allDay && (
                <>
                  <input type="time" className="tt-input w-[104px]" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  <span className="text-gray-400 text-xs">{t('dialogs.toTime')}</span>
                  <input type="time" className="tt-input w-[104px]" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </>
              )}
              <span className="w-3 h-3 rounded-full flex-shrink-0 ml-auto" style={{ backgroundColor: dotColor }} title={t('dialogs.dayEntry.layerColorTitle')} />
            </div>

            <Field label={t('dialogs.dayEntry.fieldContent')}>
              <textarea
                className="tt-input min-h-[72px] resize-y"
                placeholder={t('dialogs.dayEntry.contentPlaceholder')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={t('dialogs.dayEntry.pickColorLayer')}>
              <select className="tt-input" value={colorLayerId} onChange={(e) => setColorLayerId(e.target.value)}>
                {colorGroups.map((g) => g.items.length > 0 ? (
                  <optgroup key={g.labelKey} label={t(g.labelKey)}>
                    {g.items.map((l) => (
                      <option key={l.layer_id} value={l.layer_id}>{l.display_name}{l.enabled ? '' : t('dialogs.hiddenSuffix')}</option>
                    ))}
                  </optgroup>
                ) : null)}
              </select>
            </Field>

            {isColoring ? (
              <Field label={t('dialogs.dayEntry.levelFullness')}>
                <div className="grid grid-cols-5 gap-2">
                  {COLORING_COLORS.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => setLevel(i)}
                      style={{ backgroundColor: c }}
                      className={clsx('h-12 rounded-lg text-xs font-medium', i >= 3 ? 'text-white' : 'text-gray-700', level === i && 'ring-2 ring-blue-400')}
                    >
                      {t(COLORING_LABELS[i].labelKey)}
                    </button>
                  ))}
                </div>
              </Field>
            ) : isGraded && palette ? (
              <Field label={t('dialogs.dayEntry.level')}>
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
              <Field label={t('dialogs.dayEntry.fixedColor')}>
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg flex-shrink-0" style={{ backgroundColor: colorValue }} />
                  <p className="text-[11px] text-gray-400">{t('dialogs.dayEntry.fixedColorHint')}</p>
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
            {t('dialogs.dayEntry.autoTodo')}
            <span className="block text-[11px] text-gray-500 mt-0.5">
              {t('dialogs.dayEntry.autoTodoDetail', { list: SCHEDULE_TODO_LIST, start: startDate, end: isMulti ? lastDate : startDate })}
              {autoTodo && !todoTitle && t('dialogs.dayEntry.autoTodoTitleHint', { title: t('dialogs.dayEntry.scheduleWord') })}
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">{t('common.cancel')}</button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={kind === 'dot' ? dotSaveDisabled : colorSaveDisabled}
            className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
          >
            {saveMut.isPending ? t('dialogs.dayEntry.saving') : t('dialogs.dayEntry.submit')}
          </button>
        </div>
        {saveMut.isError && (
          <p className="text-[11px] text-red-500">{t('dialogs.dayEntry.saveFailed', { msg: saveMut.error instanceof Error ? saveMut.error.message : t('dialogs.unknownError') })}</p>
        )}
      </div>
    </Modal>
  )
}
