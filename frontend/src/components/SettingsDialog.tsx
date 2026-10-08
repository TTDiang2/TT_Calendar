import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Trash2 } from 'lucide-react'
import { Modal, Field } from './ui/Modal'
import {
  toggleLayer, importSource, getSources, getLayerSubActions, updateLayerConfig, deleteLayer,
  getTodoBusyConfig, setTodoBusyConfig, recomputeTodoBusy, type TodoBusyConfig,
  getTodoReminderConfig, setTodoReminderConfig, type TodoReminderConfig,
  getSyncConfig, getSyncStatus, saveSyncConfig, testSync, syncNow, resolveSync,
  type SyncResult,
} from '../api/client'
import { useT, useTPlural, chooseLang, activeLang, SELECTABLE_LANGS, LANG_META, type I18n, type Lang, type TxKey } from '../i18n'
import type { Layer } from '../types'

interface Props {
  layers: Layer[]
  onToggleLayer: (layerId: string) => void
  defaultStart: string
  defaultEnd: string
  onClose: () => void
}

export function SettingsDialog({ layers, onToggleLayer, defaultStart, defaultEnd, onClose }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(defaultEnd)
  const [result, setResult] = useState<string | null>(null)
  const [importSourceId, setImportSourceId] = useState('')
  const { data: sources } = useQuery({ queryKey: ['sources'], queryFn: getSources })

  const importMut = useMutation({
    mutationFn: () => importSource(importSourceId, start, end),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['view'] })
      setResult(res.error ? t('settings.import.resultError', { n: res.inserted, error: res.error }) : t('settings.import.resultOk', { n: res.inserted }))
    },
  })

  // 数据源图层：由插件声明 manual_pickable=false（不靠 sort_order / 图层 id 前缀猜）
  const sourceLayers = layers
    .filter((l) => (l.config as Record<string, unknown> | undefined)?.manual_pickable === false)
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
  const customLayers = layers.filter((l) => l.layer_id.startsWith('custom_'))

  // 默认导入第一个可用源（单源安装下无需用户选择）
  useEffect(() => {
    if (!importSourceId && sources?.length) setImportSourceId(sources[0].source_id)
  }, [sources, importSourceId])

  return (
    <Modal title={t('settings.title')} onClose={onClose} width={720}>
      <div className="flex flex-col gap-5">
        <LanguageSection />
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('settings.import.sectionTitle')}</h3>
          <div className="flex gap-2 mb-2">
            <Field label={t('settings.import.fieldSource')}>
              <select
                className="tt-input"
                value={importSourceId}
                onChange={(e) => { setImportSourceId(e.target.value); setResult(null) }}
              >
                {(sources ?? []).map((s) => (
                  <option key={s.source_id} value={s.source_id}>{s.display_name}</option>
                ))}
              </select>
            </Field>
            <Field label={t('settings.import.fieldStart')}>
              <input
                type="date"
                className="tt-input"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label={t('settings.import.fieldEnd')}>
              <input
                type="date"
                className="tt-input"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>
          <p className="text-xs text-gray-400 mb-2">
            {t('settings.import.desc')}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => importMut.mutate()}
              disabled={importMut.isPending || !importSourceId}
              className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
            >
              {importMut.isPending ? t('settings.import.running') : t('settings.import.start')}
            </button>
            {result && <span className="text-sm text-green-600">{result}</span>}
          </div>
        </section>

        {sourceLayers.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('settings.layerFilters.sectionTitle')}</h3>
            <div className="flex flex-col gap-1">
              {sourceLayers.map((l) => (
                <LayerAccordion key={l.layer_id} layer={l} onToggle={onToggleLayer} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('settings.layers.sectionTitle')}</h3>
          {customLayers.length === 0 ? (
            <p className="text-sm text-gray-400">{t('settings.layers.empty')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {customLayers.map((l) => (
                <CustomLayerRow key={l.layer_id} layer={l} onToggle={onToggleLayer} />
              ))}
            </div>
          )}
        </section>

        <BusyConfigSection />
        <ReminderConfigSection />
        <SyncConfigSection />
      </div>
      <p className="mt-5 pt-3 border-t border-gray-100 text-center text-[11px] text-gray-400 select-none">
        TT Calendar <span className="font-medium">v2.2.0</span>
      </p>
    </Modal>
  )
}

function BusyConfigSection() {
  const t = useT()
  const tPlural = useTPlural()
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
      setMsg(tPlural('settings.busy.savedDays', days ?? 0))
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
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('settings.busy.sectionTitle')}</h3>
      <p className="text-xs text-gray-400 mb-2">
        {t('settings.busy.desc')}
      </p>
      {!local ? (
        <p className="text-sm text-gray-400">{t('settings.loading')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Field label={t('settings.busy.fieldDue')}>
              <input type="number" step="0.5" className="tt-input w-full" value={local.weights.due_date}
                onChange={(e) => setNum(['weights', 'due_date'], e.target.value)} />
            </Field>
            <Field label={t('settings.busy.fieldPlanned')}>
              <input type="number" step="0.5" className="tt-input w-full" value={local.weights.planned_date}
                onChange={(e) => setNum(['weights', 'planned_date'], e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Field label={t('settings.busy.fieldImportance')}>
              <div className="flex gap-1">
                {(['high', 'medium', 'low'] as const).map((k) => (
                  <input key={k} type="number" step="0.5" className="tt-input w-14" value={local.weights.importance[k]}
                    onChange={(e) => setNum(['weights', 'importance', k], e.target.value)} />
                ))}
              </div>
            </Field>
            <Field label={t('settings.busy.fieldComplexity')}>
              <div className="flex gap-1">
                {(['high', 'medium', 'low'] as const).map((k) => (
                  <input key={k} type="number" step="0.5" className="tt-input w-14" value={local.weights.complexity[k]}
                    onChange={(e) => setNum(['weights', 'complexity', k], e.target.value)} />
                ))}
              </div>
            </Field>
          </div>
          <Field label={t('settings.busy.fieldThresholds')}>
            <div className="flex gap-1">
              {local.thresholds.map((th, i) => (
                <input key={i} type="number" className="tt-input w-12" value={th}
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
            <span className="text-[11px] text-gray-500 flex-shrink-0">{t('settings.busy.predictLayer')}</span>
            <div className="flex gap-1">
              {local.predict_colors.map((c, i) => (
                <input key={i} type="color" value={c} title={t('settings.busy.levelTitle', { n: i + 1 })}
                  onChange={(e) => {
                    const next = structuredClone(local)
                    next.predict_colors[i] = e.target.value
                    setLocal(next)
                  }} />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-gray-500 flex-shrink-0">{t('settings.busy.actualLayer')}</span>
            <div className="flex gap-1">
              {local.done_colors.map((c, i) => (
                <input key={i} type="color" value={c} title={t('settings.busy.levelTitle', { n: i + 1 })}
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
              {saveMut.isPending ? t('settings.saving') : t('settings.busy.save')}
            </button>
            {msg && <span className="text-sm text-green-600">{msg}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function reportText(r: SyncResult, t: I18n['t']): string {
  return t('settings.sync.report', { pulled: r.pulled ?? 0, pushed: r.pushed ?? 0, conflicts: r.conflicts ?? 0, deleted: r.deleted ?? 0 })
    + (r.warning ? t('settings.sync.reportWarning', { warning: r.warning }) : '')
}

/**
 * syncNow 失败的显示文案：client.ts 的结构化错误码 `sync_failed:<status>` 按码翻译
 *（errors.syncFailed，手册决策 #10）；后端 detail 串与其余错误原样透传（后端数据）。
 */
function syncFailText(e: unknown, t: I18n['t']): string {
  const m = e instanceof Error ? e.message : String(e)
  const hit = /^sync_failed:(\d+)$/.exec(m)
  return hit ? t('errors.syncFailed', { status: hit[1]! }) : String(e)
}

function ReminderConfigSection() {
  const t = useT()
  const qc = useQueryClient()
  const { data: cfg } = useQuery({
    queryKey: ['todoReminderConfig'],
    queryFn: getTodoReminderConfig,
    staleTime: 60_000,
  })
  const [local, setLocal] = useState<TodoReminderConfig | null>(null)
  useEffect(() => { if (cfg && !local) setLocal(cfg) }, [cfg, local])

  const saveMut = useMutation({
    mutationFn: async (next: TodoReminderConfig) => {
      const saved = await setTodoReminderConfig(next)
      setLocal(saved)
      qc.invalidateQueries({ queryKey: ['todoReminderConfig'] })
      qc.invalidateQueries({ queryKey: ['reminderBanner'] })
      return saved
    },
  })

  if (!local) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('settings.reminder.sectionTitle')}</h3>
        <p className="text-sm text-gray-400">{t('settings.loading')}</p>
      </section>
    )
  }

  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('settings.reminder.sectionTitle')}</h3>
      <p className="text-xs text-gray-400 mb-2">
        {t('settings.reminder.desc')}
      </p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={local.enabled}
            onChange={(e) => saveMut.mutate({ ...local, enabled: e.target.checked })}
            disabled={saveMut.isPending}
            className="rounded border-gray-300 text-blue-500 focus:ring-blue-400"
          />
          <span className="text-sm text-gray-700">{t('settings.reminder.enable')}</span>
        </label>
        <Field label={t('settings.reminder.fieldTime')}>
          <input
            type="time"
            value={local.time}
            onChange={(e) => setLocal({ ...local, time: e.target.value })}
            onBlur={() => {
              if (local.time !== cfg?.time) saveMut.mutate(local)
            }}
            disabled={!local.enabled || saveMut.isPending}
            className="tt-input"
          />
        </Field>
      </div>
    </section>
  )
}

function SyncConfigSection() {
  const t = useT()
  const tPlural = useTPlural()
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['syncConfig'], queryFn: getSyncConfig })
  const { data: status } = useQuery({ queryKey: ['syncStatus'], queryFn: getSyncStatus })
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('main')
  const [token, setToken] = useState('')
  const [auto, setAuto] = useState(true)
  const [closeSync, setCloseSync] = useState(true)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<'save' | 'test' | 'sync' | null>(null)
  const [decision, setDecision] = useState<number | null>(null)
  const loaded = useRef(false)

  useEffect(() => {
    if (cfg && !loaded.current) {
      loaded.current = true
      setRepo(cfg.repo)
      setBranch(cfg.branch)
      setAuto(cfg.auto_on_start)
      setCloseSync(cfg.sync_on_close)
    }
  }, [cfg])

  const persist = () => saveSyncConfig({
    repo, branch, token: token || undefined, auto_on_start: auto, sync_on_close: closeSync,
  })

  const onSave = async () => {
    setBusy('save'); setMsg(null)
    try {
      await persist()
      setToken('')
      qc.invalidateQueries({ queryKey: ['syncConfig'] })
      setMsg({ ok: true, text: t('settings.sync.savedMsg') })
    } catch (e) { setMsg({ ok: false, text: String(e) }) } finally { setBusy(null) }
  }

  const onTest = async () => {
    setBusy('test'); setMsg(null)
    try {
      await persist()
      setToken('')
      const r = await testSync()
      qc.invalidateQueries({ queryKey: ['syncConfig'] })
      setMsg({ ok: r.ok, text: r.detail })
    } catch (e) { setMsg({ ok: false, text: String(e) }) } finally { setBusy(null) }
  }

  const onSync = async () => {
    setBusy('sync'); setMsg(null)
    try {
      const r = await syncNow()
      if (r.result === 'needs_decision') {
        setDecision(r.remote_rows ?? 0)
      } else if (r.result === 'initialized') {
        setMsg({ ok: true, text: tPlural('settings.sync.initDone', r.pushed ?? 0) })
      } else {
        setMsg({ ok: true, text: reportText(r, t) })
      }
      qc.invalidateQueries()
    } catch (e) { setMsg({ ok: false, text: syncFailText(e, t) }) } finally { setBusy(null) }
  }

  const onResolve = async (mode: 'pull_overwrite' | 'merge_push') => {
    setBusy('sync'); setMsg(null)
    try {
      const r = await resolveSync(mode)
      setDecision(null)
      setMsg({ ok: true, text: t('settings.sync.resolvedDone', { report: reportText(r, t) }) })
      qc.invalidateQueries()
    } catch (e) { setMsg({ ok: false, text: String(e) }) } finally { setBusy(null) }
  }

  const lastLine = status?.at
    ? t(status.ok ? 'settings.sync.lastSyncOk' : 'settings.sync.lastSyncWarn', { time: status.at.slice(11, 19) })
    : t('settings.sync.lastSyncNever')

  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('settings.sync.sectionTitle')}</h3>
      <p className="text-xs text-gray-400 mb-2">
        {t('settings.sync.desc')}
      </p>
      {decision !== null && (
        <div className="mb-3 p-3 rounded-md bg-amber-50 border border-amber-200 text-sm">
          <p className="mb-2">{t('settings.sync.decisionPrompt', { n: decision })}</p>
          <div className="flex gap-2">
            <button disabled={busy !== null} onClick={() => onResolve('merge_push')}
              className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40">
              {t('settings.sync.resolveMerge')}
            </button>
            <button disabled={busy !== null} onClick={() => onResolve('pull_overwrite')}
              className="px-3 py-1.5 text-sm bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-40">
              {t('settings.sync.resolveOverwrite')}
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-20 flex-shrink-0">{status?.configured ? lastLine : t('settings.sync.notConfigured')}</span>
        </div>
        <div className="flex gap-2">
          <Field label={t('settings.sync.fieldRepo')}>
            <input className="tt-input w-full" placeholder="TTDiang2/tt-calendar-data"
              value={repo} onChange={(e) => setRepo(e.target.value)} />
          </Field>
          <Field label={t('settings.sync.fieldBranch')}>
            <input className="tt-input w-24" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </Field>
        </div>
        <Field label={t('settings.sync.patLabel', { state: cfg?.has_token ? t('settings.sync.patStored') : t('settings.sync.patMissing') })}>
          <input type="password" className="tt-input w-full" placeholder={cfg?.has_token ? '••••••••' : 'github_pat_...'}
            value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          {t('settings.sync.autoOnStart')}
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
          <input type="checkbox" checked={closeSync} onChange={(e) => setCloseSync(e.target.checked)} />
          {t('settings.sync.syncOnClose')}
        </label>
        <div className="flex items-center gap-2">
          <button onClick={onSave} disabled={busy !== null || !repo}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-40">
            {busy === 'save' ? t('settings.saving') : t('common.save')}
          </button>
          <button onClick={onTest} disabled={busy !== null || !repo || (!token && !cfg?.has_token)}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-40">
            {busy === 'test' ? t('settings.sync.testing') : t('settings.sync.test')}
          </button>
          <button onClick={onSync} disabled={busy !== null || !repo || !cfg?.has_token}
            className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40">
            {busy === 'sync' ? t('settings.sync.syncing') : t('settings.sync.syncNow')}
          </button>
          {msg && <span className={`text-sm ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</span>}
        </div>
      </div>
    </section>
  )
}

function CustomLayerRow({ layer, onToggle }: { layer: Layer; onToggle: (id: string) => void }) {
  const t = useT()
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
          {t('settings.layers.confirmDelete')}
        </button>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="text-gray-300 hover:text-red-500 p-1"
          title={t('settings.layers.deleteTitle')}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}

function LayerAccordion({ layer, onToggle }: { layer: Layer; onToggle: (id: string) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const hasMinImportance = layer.config?.min_importance !== undefined
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
          {open ? t('settings.layerFilters.collapse') : hasMinImportance ? t('settings.layerFilters.expandStar') : t('settings.layerFilters.expandSub')}
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
      {open && (hasMinImportance ? <LayerMinImportance layer={layer} /> : <LayerSubActions layer={layer} />)}
    </div>
  )
}

function LayerMinImportance({ layer }: { layer: Layer }) {
  const t = useT()
  const qc = useQueryClient()
  // 本地乐观 state：点击立即反馈（同 LayerSubActions 模式，不依赖 props 快照刷新）
  const [current, setCurrent] = useState<number>(Number(layer.config?.min_importance ?? 0))
  const configMut = useMutation({
    mutationFn: (v: number) => updateLayerConfig(layer.layer_id, { min_importance: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
      qc.invalidateQueries({ queryKey: ['layers'] })
    },
    onError: () => {
      // 失败回滚为 props 里的原始值
      setCurrent(Number(layer.config?.min_importance ?? 0))
    },
  })
  const options: { v: number; labelKey: TxKey }[] = [
    { v: 0, labelKey: 'settings.layerFilters.starAll' },
    { v: 1, labelKey: 'settings.layerFilters.star1' },
    { v: 2, labelKey: 'settings.layerFilters.star2' },
    { v: 3, labelKey: 'settings.layerFilters.star3' },
  ]
  return (
    <div className="border-t border-gray-200 bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] text-gray-500">{t('settings.layerFilters.minStar')}</span>
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => {
              setCurrent(o.v)
              configMut.mutate(o.v)
            }}
            className={clsx(
              'px-2 py-0.5 text-xs rounded border transition',
              o.v === current
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300',
            )}
          >
            {t(o.labelKey)}
          </button>
        ))}
      </div>
    </div>
  )
}

function LayerSubActions({ layer }: { layer: Layer }) {
  const t = useT()
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
      {isLoading && <p className="text-xs text-gray-400">{t('settings.layerFilters.subLoading')}</p>}
      {!isLoading && pairs.length === 0 && (
        <p className="text-xs text-gray-400">{t('settings.layerFilters.subEmpty')}</p>
      )}
      {!isLoading && pairs.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] text-gray-500">{isAllOn ? t('settings.layerFilters.subAllOn') : t('settings.layerFilters.subFiltered', { n: current.length, total: pairs.length })}</p>
            {!isAllOn && (
              <button onClick={resetAll} className="text-[11px] text-blue-600 hover:text-blue-700">{t('settings.layerFilters.subReset')}</button>
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


function LanguageSection() {
  const t = useT()
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('language.settingsLabel')}</h3>
      <select
        className="tt-input"
        value={activeLang()}
        onChange={(e) => chooseLang(e.target.value as Lang)}
      >
        {SELECTABLE_LANGS.map((lang) => (
          <option key={lang} value={lang}>{LANG_META[lang].endonym}</option>
        ))}
      </select>
    </section>
  )
}
