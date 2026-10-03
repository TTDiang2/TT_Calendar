import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { Layer } from '../types'
import { createLayer, getSubscriptions } from '../api/client'
import { COLOR_PRESETS, GRADED_PALETTES } from '../data'
import { Modal, Field } from './ui/Modal'
import { useT, type TxKey } from '../i18n'
import { paletteLabelKey } from '../i18n/adapt/labels'

interface Props {
  layers: Layer[]
  onToggle: (layerId: string) => void
  countdown: string
}

export function Sidebar({ layers, onToggle, countdown }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('sidebar_collapsed')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try { localStorage.setItem('sidebar_collapsed', JSON.stringify(next)) } catch {}
      return next
    })
  }

  // 第一级：涂色 / 点点（基于 layer.kind）；第二级：group（layer.group）；第三级：图层本身
  const tree = useMemo(() => {
    const byKind: Record<string, Record<string, Layer[]>> = { color: {}, dot: {} }
    for (const l of layers) {
      const kind = l.kind === 'dot' ? 'dot' : 'color'
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

  // 订阅超级组：组名与订阅 display_name 相同的图层组（集思录等）挂在「订阅」下
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
    <aside className="w-60 bg-white border-r border-gray-200 p-4 overflow-y-auto flex flex-col">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('shell.navHeading')}</h2>

      <div className="flex flex-col gap-2 mb-4">
        {(['color', 'dot'] as const).map((kind) => {
          const groups = tree[kind]
          const groupKeys = Object.keys(groups)
          if (groupKeys.length === 0) return null
          const kindId = `kind:${kind}`
          return (
            <div key={kind}>
              <button
                onClick={() => toggleGroup(kindId)}
                className="w-full flex items-center gap-1 px-1 py-1 text-[11px] font-semibold text-gray-500 hover:text-gray-700"
              >
                {collapsed[kindId] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                {t(kindMeta[kind].titleKey)}
              </button>
              {!collapsed[kindId] && (
                <div className="flex flex-col gap-1 ml-1">
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
            return (
              <div key={grp}>
                {hasGroup && (
                  <button
                    onClick={() => toggleGroup(grpId)}
                    className="w-full flex items-center gap-1 px-1 py-0.5 text-[11px] text-gray-400 hover:text-gray-600"
                  >
                    {collapsed[grpId] ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                    {grpTitle}
                    <span className="text-[10px] text-gray-300">{members.length}</span>
                  </button>
                )}
                {(!hasGroup || !collapsed[grpId]) && (
                  <div className={`flex flex-col gap-0.5 ${hasGroup ? 'ml-2' : ''}`}>
                    {members.map((l) => (
                      <LayerRow key={l.layer_id} layer={l} onToggle={onToggle} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {subGroupKeys.length > 0 && (
            <div>
              <button
                onClick={() => toggleGroup(`subs:${kind}`)}
                className="w-full flex items-center gap-1 px-1 py-0.5 text-[11px] text-gray-400 hover:text-gray-600"
              >
                {collapsed[`subs:${kind}`] ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                {t('terms.subscription')}
                <span className="text-[10px] text-gray-300">{subGroupKeys.reduce((n, g) => n + groups[g].length, 0)}</span>
              </button>
              {!collapsed[`subs:${kind}`] && (
                <div className="ml-1">
                  {subGroupKeys.sort().map((grp) => {
                    const members = groups[grp]
                    const grpId = `group:${kind}:${grp}`
                    return (
                      <div key={grp} className="mb-0.5">
                        <button
                          onClick={() => toggleGroup(grpId)}
                          className="w-full flex items-center gap-1 py-0.5 text-[11px] text-gray-400 hover:text-gray-600 ml-1"
                        >
                          {collapsed[grpId] ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                          {grp}
                          <span className="text-[10px] text-gray-300">{members.length}</span>
                        </button>
                        {!collapsed[grpId] && (
                          <div className="flex flex-col gap-0.5 ml-3">
                            {members.map((l) => (
                              <LayerRow key={l.layer_id} layer={l} onToggle={onToggle} />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                 </div>
               )}
             </div>
           )}
              </>
            )
          })()}
                </div>
              )}
            </div>
          )
        })}
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md mt-0.5"
        >
          <Plus size={14} /> {t('shell.createLayer')}
        </button>
      </div>

      <div className="mt-auto">
        <div className="rounded-lg bg-gray-100 p-3">
          <p className="text-[11px] text-gray-400 mb-1">{t('shell.countdownLabel')}</p>
          <p className="text-sm text-gray-600 font-medium select-text">{countdown}</p>
        </div>
      </div>

      {showCreate && <CreateLayerDialog onClose={() => setShowCreate(false)} onCreated={onCreated} />}
    </aside>
  )
}

function LayerRow({ layer, onToggle }: { layer: Layer; onToggle: (id: string) => void }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1.5 rounded-md hover:bg-gray-50">
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: layer.color ?? '#9ca3af' }}
      />
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
    </div>
  )
}

function CreateLayerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [kind, setKind] = useState<'color' | 'dot'>('color')
  const [mode, setMode] = useState<'solid' | 'graded' | 'tag'>('solid')
  const [name, setName] = useState('')
  const [color, setColor] = useState<string | null>(COLOR_PRESETS[0])
  // paletteName 是 GRADED_PALETTES 的 ASCII key（data.ts 逻辑键，非文案；显示名走 palette.* 字典，台账 C2）
  const [paletteName, setPaletteName] = useState<keyof typeof GRADED_PALETTES>('green')
  const [tag, setTag] = useState('')
  const [group, setGroup] = useState('')

  const mut = useMutation({
    mutationFn: async () => {
      const config: Record<string, unknown> = {}
      if (kind === 'color') {
        config.mode = mode
        if (mode === 'solid') config.color = color
        if (mode === 'graded') config.palette = GRADED_PALETTES[paletteName]
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
                  kind === card.k ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                )}
              >
                <span className="font-medium">{t(card.labelKey)}</span>
                <span className="text-[10px] text-gray-400">{t(card.descKey)}</span>
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
          <p className="text-[11px] text-gray-400 mt-1">{t('shell.groupHint')}</p>
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
                      mode === card.k ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    <span className="font-medium">{t(card.labelKey)}</span>
                    <span className="text-[10px] text-gray-400">{t(card.descKey)}</span>
                  </button>
                ))}
              </div>
            </Field>

            {mode === 'graded' ? (
              <Field label={t('shell.field.palette')}>
                <div className="flex gap-2">
                  {(Object.keys(GRADED_PALETTES) as (keyof typeof GRADED_PALETTES)[]).map((pk) => (
                    <button
                      key={pk}
                      onClick={() => setPaletteName(pk)}
                      className={clsx(
                        'flex items-center gap-1 px-2 py-1.5 rounded-lg border text-sm',
                        paletteName === pk ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600',
                      )}
                    >
                      {t(paletteLabelKey(pk))}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 mt-2">
                  {GRADED_PALETTES[paletteName].map((c, i) => (
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
                <p className="text-[11px] text-gray-400 mt-1">
                  {t('shell.tagHint')}
                </p>
              </Field>
            )}
          </>
        )}

        <p className="text-[11px] text-gray-400">
          {t('shell.deleteHint')}
        </p>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">{t('common.cancel')}</button>
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
