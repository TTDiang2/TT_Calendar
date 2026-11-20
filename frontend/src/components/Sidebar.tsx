import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Plus } from 'lucide-react'
import type { Layer } from '../types'
import { createLayer, getSubscriptions, getTodoBusyConfig } from '../api/client'
import { COLOR_PRESETS, PALETTE_KEYS, type PaletteKey } from '../data'
import { Modal, Field } from './ui/Modal'
import { StretchSwitch } from './ui/StretchSwitch'
import { Collapse, CollapseChevron } from './ui/Collapse'
import { useT, type TxKey } from '../i18n'
import { paletteLabelKey } from '../i18n/adapt/labels'
import { layerLabel } from '../i18n/adapt/layerLabel'
import { resolveBusyRamps, useCalendarTheme } from '../lib/calendar-theme'

interface Props {
  layers: Layer[]
  onToggle: (layerId: string) => void
  countdown: string
  /** 后端 /api/countdown 的结构化横幅（P2.5）；缺省时回落 text */
  banner?: { kind: string; name: string | null; days: number | null } | null
}

// v2：语义从「记住哪些被收起」变成「默认全部收起 + 记住用户展开过哪些」。
// 换 key 让升级上来的老用户也走一次新的默认值（否则他们会一直看到全展开的侧栏）。
const COLLAPSE_KEY = 'sidebar_collapsed_v2'

function readCollapsed(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(COLLAPSE_KEY)
    const parsed = saved ? JSON.parse(saved) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

const kindOf = (l: Layer) => (l.kind === 'dot' ? 'dot' : 'color')

/** 侧栏里所有可折叠节点的 id（kind 级 + group 级 + 订阅超级组）。 */
function collectNodeIds(layers: Layer[]): string[] {
  const ids = new Set<string>(['subs:color', 'subs:dot'])
  for (const l of layers) {
    const kind = kindOf(l)
    ids.add(`kind:${kind}`)
    if (l.group) ids.add(`group:${kind}:${l.group}`)
  }
  return [...ids]
}

export function Sidebar({ layers, onToggle, countdown, banner }: Props) {
  const t = useT()
  // 侧栏倒计时横幅：后端 banner 结构化 → 前端按语言组装；旧 text 兜底
  const bannerText = banner
    ? (banner.kind === 'today' ? t('countdown.banner.today', { name: banner.name ?? '' })
      : banner.kind === 'until' ? t('countdown.banner.until', { name: banner.name ?? '', n: banner.days ?? 0 })
      : banner.kind === 'passed' ? t('countdown.banner.passed', { name: banner.name ?? '', n: banner.days ?? 0 })
      : t('countdown.banner.empty'))
    : countdown
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed)

  // 默认全部收起（20261120 用户反馈：第一次打开侧栏就铺满十几个图层，主次全乱）。
  // 这里只补「状态里还没有的节点」为收起：用户手动展开过的（值为 false）不动，
  // 之后新建的分组也会自动是收起态，不需要再想默认值。
  useEffect(() => {
    const ids = collectNodeIds(layers)
    setCollapsed((prev) => {
      let changed = false
      const next = { ...prev }
      for (const id of ids) {
        if (!(id in next)) {
          next[id] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [layers])

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed))
    } catch {
      /* 隐私模式等写不了就算了，只是下次回到默认收起 */
    }
  }, [collapsed])

  // 只有显式 false 才算「展开」：首帧状态表还是空的，若按 truthy 判断收起，
  // 会先渲染成全部展开、再被 effect 收起来，用户能看见闪一下。
  const isOpen = (id: string) => collapsed[id] === false
  const toggleGroup = (id: string) => {
    // 值语义：true=收起、false=展开。当前展开(false) → 收起(true)，其余（收起/未记录）→ 展开(false)
    setCollapsed((prev) => ({ ...prev, [id]: prev[id] === false }))
  }

  // 第一级：涂色 / 点点（基于 layer.kind）；第二级：group（layer.group）；第三级：图层本身
  const tree = useMemo(() => {
    const byKind: Record<string, Record<string, Layer[]>> = { color: {}, dot: {} }
    for (const l of layers) {
      const kind = kindOf(l)
      const grp = l.group ?? ''
      ;(byKind[kind][grp] ??= []).push(l)
    }
    for (const k of Object.keys(byKind)) {
      for (const g of Object.keys(byKind[k])) {
        byKind[k][g].sort((a, b) => a.sort_order - b.sort_order)
      }
    }
    return byKind
  }, [layers])

  // 订阅超级组：组名与订阅 display_name 相同的图层组挂在「订阅」下
  const { data: subs = [] } = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions })
  const subNames = useMemo(() => new Set(subs.map((s) => s.display_name)), [subs])

  // labelKey 模式：模块常量不存文案，渲染时 t(m.titleKey)
  const kindMeta: Record<string, { titleKey: TxKey }> = {
    color: { titleKey: 'shell.kind.color' },
    dot: { titleKey: 'shell.kind.dot' },
  }

  const onCreated = () => {
    setShowCreate(false)
    qc.invalidateQueries({ queryKey: ['layers'] })
    qc.invalidateQueries({ queryKey: ['view'] })
  }

  return (
    <aside data-tour="sidebar" className="w-60 cal-panel-bg border-r cal-line-r p-4 overflow-y-auto flex flex-col">
      <h2 className="text-xs font-semibold cal-muted uppercase tracking-wide mb-2">{t('shell.navHeading')}</h2>

      <div className="flex flex-col gap-1 mb-4">
        {(['color', 'dot'] as const).map((kind) => {
          const groups = tree[kind]
          const groupKeys = Object.keys(groups)
          if (groupKeys.length === 0) return null
          const kindId = `kind:${kind}`
          const kindOpen = isOpen(kindId)
          const kindCount = groupKeys.reduce((n, g) => n + groups[g].length, 0)
          return (
            <div key={kind}>
              <button
                onClick={() => toggleGroup(kindId)}
                aria-expanded={kindOpen}
                className="w-full flex items-center gap-1.5 px-1 py-1.5 rounded-md text-[11px] font-semibold cal-muted hover:text-[color:var(--cal-ink)] cal-hover-bg"
              >
                <CollapseChevron open={kindOpen} />
                {t(kindMeta[kind].titleKey)}
                <span className="text-[10px] font-normal text-gray-300">{kindCount}</span>
              </button>
              <Collapse open={kindOpen}>
                <div className="flex flex-col gap-1 ml-1 pt-0.5">
                  {(() => {
                    const sorted = [...groupKeys].sort()
                    const normalGroups = sorted.filter((g) => !subNames.has(g))
                    const subGroupKeys = sorted.filter((g) => subNames.has(g))
                    return (
                      <>
                        {normalGroups.map((grp) => {
                          const members = groups[grp]
                          const hasGroup = grp !== ''
                          const grpId = `group:${kind}:${grp}`
                          const grpTitle = hasGroup ? grp : t('shell.groupOther')
                          const grpOpen = isOpen(grpId)
                          return (
                            <div key={grp}>
                              {hasGroup && (
                                <button
                                  onClick={() => toggleGroup(grpId)}
                                  aria-expanded={grpOpen}
                                  className="w-full flex items-center gap-1.5 px-1 py-1 rounded-md text-[11px] cal-muted hover:text-[color:var(--cal-ink)] cal-hover-bg"
                                >
                                  <CollapseChevron open={grpOpen} size={10} />
                                  {grpTitle}
                                  <span className="text-[10px] text-gray-300">{members.length}</span>
                                </button>
                              )}
                              <Collapse open={!hasGroup || grpOpen}>
                                <div className={clsx('flex flex-col gap-0.5', hasGroup && 'ml-2')}>
                                  {members.map((l) => (
                                    <LayerRow key={l.layer_id} layer={l} onToggle={onToggle} />
                                  ))}
                                </div>
                              </Collapse>
                            </div>
                          )
                        })}
                        {subGroupKeys.length > 0 && (
                          <div>
                            <button
                              onClick={() => toggleGroup(`subs:${kind}`)}
                              aria-expanded={isOpen(`subs:${kind}`)}
                              className="w-full flex items-center gap-1.5 px-1 py-1 rounded-md text-[11px] cal-muted hover:text-[color:var(--cal-ink)] cal-hover-bg"
                            >
                              <CollapseChevron open={isOpen(`subs:${kind}`)} size={10} />
                              {t('terms.subscription')}
                              <span className="text-[10px] text-gray-300">
                                {subGroupKeys.reduce((n, g) => n + groups[g].length, 0)}
                              </span>
                            </button>
                            <Collapse open={isOpen(`subs:${kind}`)}>
                              <div className="ml-1">
                                {subGroupKeys.sort().map((grp) => {
                                  const members = groups[grp]
                                  const grpId = `group:${kind}:${grp}`
                                  const grpOpen = isOpen(grpId)
                                  return (
                                    <div key={grp} className="mb-0.5">
                                      <button
                                        onClick={() => toggleGroup(grpId)}
                                        aria-expanded={grpOpen}
                                        className="w-full flex items-center gap-1.5 py-1 text-[11px] cal-muted hover:text-[color:var(--cal-ink)] ml-1"
                                      >
                                        <CollapseChevron open={grpOpen} size={10} />
                                        {grp}
                                        <span className="text-[10px] text-gray-300">{members.length}</span>
                                      </button>
                                      <Collapse open={grpOpen}>
                                        <div className="flex flex-col gap-0.5 ml-3">
                                          {members.map((l) => (
                                            <LayerRow key={l.layer_id} layer={l} onToggle={onToggle} />
                                          ))}
                                        </div>
                                      </Collapse>
                                    </div>
                                  )
                                })}
                              </div>
                            </Collapse>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
              </Collapse>
            </div>
          )
        })}
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 px-2 py-1.5 text-sm cal-muted hover:text-blue-600 hover:bg-blue-50 rounded-md mt-1"
        >
          <Plus size={14} /> {t('shell.createLayer')}
        </button>
      </div>

      <div className="mt-auto">
        <div className="rounded-lg cal-subtle-bg p-3">
          <p className="text-[11px] cal-muted mb-1">{t('shell.countdownLabel')}</p>
          <p className="text-sm cal-muted font-medium select-text">{bannerText}</p>
        </div>
      </div>

      {showCreate && <CreateLayerDialog onClose={() => setShowCreate(false)} onCreated={onCreated} />}
    </aside>
  )
}

function LayerRow({ layer, onToggle }: { layer: Layer; onToggle: (id: string) => void }) {
  const t = useT()
  const { theme } = useCalendarTheme()
  const isBusy = layer.layer_id === 'todo' || layer.layer_id === 'todo_done'
  // 图例跟日历显示保持一致：忙度/已完成/充实度用主题解析后的 L4，其他图层仍用用户色
  const { data: busyConfig } = useQuery({
    queryKey: ['todoBusyConfig'],
    queryFn: getTodoBusyConfig,
    staleTime: 60_000,
    enabled: isBusy,
  })
  const ramps = resolveBusyRamps(theme, busyConfig)
  const displayColor =
    layer.layer_id === 'todo_done'
      ? ramps.done[3]
      : layer.layer_id === 'todo'
        ? ramps.predict[3]
        : layer.layer_id === 'coloring'
          ? theme.coloring[3]
          : layer.color ?? '#9ca3af'
  const label = layerLabel(layer, t)
  return (
    <div
      className={clsx(
        'flex items-center gap-2 px-1 py-1.5 rounded-md transition-colors cal-hover-bg',
        // 开关只反映在圆点与文字上，不给整行铺「选中」底色（那会让侧栏看起来像列表选中态）
        !layer.enabled && 'opacity-90',
      )}
    >
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0 transition-opacity"
        style={{ backgroundColor: displayColor, opacity: layer.enabled ? 1 : 0.3 }}
      />
      <span className={clsx('flex-1 truncate text-sm transition-colors', layer.enabled ? 'cal-ink' : 'cal-muted')}>
        {label}
      </span>
      <StretchSwitch
        checked={layer.enabled}
        onChange={() => onToggle(layer.layer_id)}
        label={label}
      />
    </div>
  )
}

function CreateLayerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useT()
  const { theme } = useCalendarTheme()
  const qc = useQueryClient()
  const [kind, setKind] = useState<'color' | 'dot'>('color')
  const [mode, setMode] = useState<'solid' | 'graded' | 'tag'>('solid')
  const [name, setName] = useState('')
  const [color, setColor] = useState<string | null>(COLOR_PRESETS[0])
  // paletteName 是 GRADED_PALETTES 的 ASCII key（data.ts 逻辑键，非文案；显示名走 palette.* 字典，台账 C2）
  const [paletteName, setPaletteName] = useState<PaletteKey>('green')
  const [tag, setTag] = useState('')
  const [group, setGroup] = useState('')

  const mut = useMutation({
    mutationFn: async () => {
      const config: Record<string, unknown> = {}
      if (kind === 'color') {
        config.mode = mode
        if (mode === 'solid') config.color = color
        if (mode === 'graded') config.palette = theme.palettes[paletteName]
        if (mode === 'tag') {
          config.color = color
          const tagValue = tag.trim()
          if (!tagValue) throw new Error(t('shell.tagRequired'))
          config.tag = tagValue
        }
      }
      // 默认图层名会作为 display_name 写入数据库（持久化数据，手册 §5.1），保持原样不抽词
      // eslint-disable-next-line no-restricted-syntax
      const defaultName = kind === 'color' ? (mode === 'solid' ? '自定义涂色' : mode === 'graded' ? '分级涂色' : '标签涂色') : '自定义图层'
      await createLayer({
        display_name: name.trim() || defaultName,
        color: kind === 'color' && mode === 'graded' ? null : color,
        kind,
        group: group.trim() || null,
        config,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['layers'] })
      onCreated()
    },
  })

  return (
    <Modal title={t('shell.createLayer')} onClose={onClose} width={440}>
      <div className="flex flex-col gap-4">
        <Field label={t('shell.field.layerKind')}>
          <div className="grid grid-cols-2 gap-2">
            {([
              { k: 'color', labelKey: 'shell.kindLayer.color', descKey: 'shell.kindLayer.colorDesc' },
              { k: 'dot', labelKey: 'shell.kindLayer.dot', descKey: 'shell.kindLayer.dotDesc' },
            ] as const).map((card) => (
              <button
                key={card.k}
                onClick={() => setKind(card.k)}
                className={clsx(
                  'flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg border text-sm transition',
                  kind === card.k ? 'border-[color:var(--cal-accent)] cal-subtle-bg text-[color:var(--cal-accent)]' : 'border-[color:var(--cal-border)] cal-muted cal-hover-bg',
                )}
              >
                <span className="font-medium">{t(card.labelKey)}</span>
                <span className="text-[10px] cal-muted">{t(card.descKey)}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('shell.field.layerName')}>
          <input
            className="tt-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === 'dot' ? t('shell.namePlaceholder.dot') : mode === 'solid' ? t('shell.namePlaceholder.solid') : mode === 'graded' ? t('shell.namePlaceholder.graded') : t('shell.namePlaceholder.tag')}
          />
        </Field>

        <Field label={t('shell.field.group')}>
          <input
            className="tt-input"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder={kind === 'dot' ? t('shell.groupPlaceholder.dot') : t('shell.groupPlaceholder.color')}
          />
          <p className="text-[11px] cal-muted mt-1">{t('shell.groupHint')}</p>
        </Field>

        {kind === 'color' && (
          <>
            <Field label={t('shell.field.template')}>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { k: 'solid', labelKey: 'shell.template.solid', descKey: 'shell.template.solidDesc' },
                  { k: 'graded', labelKey: 'shell.template.graded', descKey: 'shell.template.gradedDesc' },
                  { k: 'tag', labelKey: 'shell.template.tag', descKey: 'shell.template.tagDesc' },
                ] as const).map((card) => (
                  <button
                    key={card.k}
                    onClick={() => setMode(card.k)}
                    className={clsx(
                      'flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg border text-sm transition',
                      mode === card.k ? 'border-[color:var(--cal-accent)] cal-subtle-bg text-[color:var(--cal-accent)]' : 'border-[color:var(--cal-border)] cal-muted cal-hover-bg',
                    )}
                  >
                    <span className="font-medium">{t(card.labelKey)}</span>
                    <span className="text-[10px] cal-muted">{t(card.descKey)}</span>
                  </button>
                ))}
              </div>
            </Field>

            {mode === 'graded' ? (
              <Field label={t('shell.field.palette')}>
                <div className="flex gap-2">
                  {PALETTE_KEYS.map((pk) => (
                    <button
                      key={pk}
                      onClick={() => setPaletteName(pk)}
                      className={clsx(
                        'flex items-center gap-1 px-2 py-1.5 rounded-lg border text-sm',
                        paletteName === pk ? 'border-[color:var(--cal-accent)] cal-subtle-bg text-[color:var(--cal-accent)]' : 'border-[color:var(--cal-border)] cal-muted',
                      )}
                    >
                      {t(paletteLabelKey(pk))}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 mt-2">
                  {theme.palettes[paletteName].map((c, i) => (
                    <span key={i} className="flex-1 h-6 rounded" style={{ backgroundColor: c }} />
                  ))}
                </div>
              </Field>
            ) : (
              <Field label={t('shell.field.color')}>
                <div className="flex gap-1.5 flex-wrap">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={clsx(
                        'w-7 h-7 rounded-full transition',
                        color === c && 'ring-2 ring-blue-400 ring-offset-2',
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </Field>
            )}

            {mode === 'tag' && (
              <Field label={t('shell.field.tag')}>
                <input
                  className="tt-input"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder={t('shell.tagPlaceholder')}
                />
                <p className="text-[11px] cal-muted mt-1">
                  {t('shell.tagHint')}
                </p>
              </Field>
            )}
          </>
        )}

        <p className="text-[11px] cal-muted">
          {t('shell.deleteHint')}
        </p>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm cal-muted cal-hover-bg rounded-lg">{t('common.cancel')}</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
          >
            {mut.isPending ? t('shell.creating') : t('shell.create')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
