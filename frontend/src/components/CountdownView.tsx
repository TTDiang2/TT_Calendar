import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock, CalendarClock, Infinity as InfinityIcon, Plus, Repeat, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import { getCountdownList, createCountdown, updateCountdown, deleteCountdown } from '../api/client'
import type { CountdownItem } from '../types'
import { useT, useTPlural, type I18n, type TxKey } from '../i18n'

const CATEGORY_COLORS: Record<string, string> = {
  生日: '#f472b6',
  纪念日: '#f59e0b',
  节日: '#a78bfa',
  重要事件: '#60a5fa',
}

/** 内置分类存储值常量（写入 DB 的数据/比较逻辑键，禁改，手册 §5.1） */
// eslint-disable-next-line no-restricted-syntax
const BUILTIN_CATEGORIES: readonly string[] = ['生日', '纪念日', '节日', '重要事件']

/** 内置分类的「存储值 → 字典 key」映射：显示按语言映射，存储值原样（手册 §5.1） */
const CATEGORY_LABEL_KEYS: Record<string, TxKey> = {
  生日: 'countdown.categoryBirthday',
  纪念日: 'countdown.categoryAnniversary',
  节日: 'countdown.categoryFestival',
  重要事件: 'countdown.categoryImportant',
  其他: 'countdown.categoryOther',
}

/** 分类显示名：内置分类按语言映射，自定义/未知分类原样显示 */
function categoryLabel(t: I18n['t'], c: string): string {
  const k = CATEGORY_LABEL_KEYS[c]
  return k ? t(k) : c
}

export function CountdownView() {
  const t = useT()
  const qc = useQueryClient()
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | 'NEW' | null>(null)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['countdown', 'list'],
    queryFn: getCountdownList,
    staleTime: 30_000,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['countdown'] })
    qc.invalidateQueries({ queryKey: ['view'] })
  }
  const createMut = useMutation({ mutationFn: createCountdown, onSuccess: invalidate })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateCountdown>[1] }) => updateCountdown(id, data),
    onSuccess: invalidate,
  })
  const deleteMut = useMutation({ mutationFn: deleteCountdown, onSuccess: invalidate })

  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category))
    return [...BUILTIN_CATEGORIES, ...Array.from(set).filter((c) => !BUILTIN_CATEGORIES.includes(c))]
  }, [items])

  const filtered = selectedCategory ? items.filter((i) => i.category === selectedCategory) : items
  const selected = selectedId === 'NEW' ? null : items.find((i) => i.id === selectedId) ?? null

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左分类栏 — w-60 */}
      <div className="w-60 bg-white border-r border-gray-200 p-3 overflow-y-auto flex flex-col">
        <button
          onClick={() => { setSelectedCategory(null); setSelectedId(null) }}
          className={clsx(
            'flex items-center justify-between px-2 py-1.5 rounded-md text-sm mb-1',
            selectedCategory === null ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50',
          )}
        >
          <span className="flex items-center gap-1.5"><AlarmClock size={14} /> {t('countdown.all')}</span>
          <span className="text-xs text-gray-400">{items.length}</span>
        </button>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => { setSelectedCategory(c); setSelectedId(null) }}
            className={clsx(
              'flex items-center justify-between px-2 py-1.5 rounded-md text-sm mb-0.5',
              selectedCategory === c ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50',
            )}
          >
            <span className="flex items-center gap-1.5 truncate">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS[c] ?? '#9ca3af' }} />
              {categoryLabel(t, c)}
            </span>
            <span className="text-xs text-gray-400">{items.filter((i) => i.category === c).length}</span>
          </button>
        ))}
        <button
          onClick={() => { setSelectedCategory(null); setSelectedId('NEW') }}
          className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-400 hover:text-gray-600 mt-1"
        >
          <Plus size={14} /> {t('countdown.createNew')}
        </button>
      </div>

      {/* 中卡片区 */}
      <div className="flex-1 flex flex-col p-4 overflow-hidden min-w-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
            <CalendarClock size={16} /> {selectedCategory ? t('countdown.titleWithCat', { cat: categoryLabel(t, selectedCategory) }) : t('terms.countdown')}
          </h2>
          <button
            onClick={() => { setSelectedCategory(null); setSelectedId('NEW') }}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            <Plus size={14} /> {t('countdown.createShort')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-gray-400">{t('common.loading')}</p>
          ) : filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-300 gap-2">
              <AlarmClock size={40} />
              <p className="text-sm">{t('countdown.empty')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
              {filtered.map((it) => (
                <CountdownCard
                  key={it.id}
                  item={it}
                  selected={selectedId === it.id}
                  onSelect={() => setSelectedId(it.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右详情栏 — w-72 */}
      <CountdownDetailPanel
        item={selected}
        onClose={() => setSelectedId(null)}
        onSave={(data, id) => {
          if (id) updateMut.mutate({ id, data })
          else createMut.mutate(data)
          setSelectedId(null)
        }}
        onDelete={(id) => {
          if (confirm(t('countdown.confirmDelete'))) {
            deleteMut.mutate(id)
            setSelectedId(null)
          }
        }}
      />
    </div>
  )
}

function CountdownCard({ item, selected, onSelect }: { item: CountdownItem; selected: boolean; onSelect: () => void }) {
  const t = useT()
  const tPlural = useTPlural()
  const catColor = CATEGORY_COLORS[item.category] ?? '#9ca3af'
  const text = item.is_today
    ? t('countdown.cardToday')
    : item.passed
      ? item.never_expire
        ? t('countdown.cardPassedNever')
        : tPlural('countdown.cardPassed', -item.days_left)
      : tPlural('countdown.cardLeft', item.days_left)

  return (
    <div
      onClick={onSelect}
      className={clsx(
        'rounded-xl border p-3 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 flex flex-col gap-1.5',
        selected ? 'border-blue-400 ring-2 ring-blue-200 bg-blue-50/30' : 'border-gray-200 bg-white',
        item.passed && !item.never_expire && 'opacity-55',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: catColor }} />
        <span className="text-[10px] text-gray-400 px-1.5 py-0.5 rounded bg-gray-50">{categoryLabel(t, item.category)}</span>
        <div className="ml-auto flex gap-1">
            {item.repeat_yearly && (
              <span title={item.repeat_type === 'lunar' ? t('countdown.repeatYearlyLunar') : t('countdown.repeatYearlySolar')}>
                <Repeat size={12} className={item.repeat_type === 'lunar' ? 'text-red-400' : 'text-gray-400'} />
              </span>
            )}
            {item.repeat_type === 'lunar' && <span title={t('countdown.lunarBadgeTitle')} className="text-[10px] text-red-400">{t('countdown.lunarBadge')}</span>}
          {item.milestone_rule && <span title={t('countdown.milestoneTitle')}><Sparkles size={12} className="text-amber-400" /></span>}
          {item.never_expire && <span title={t('countdown.neverTitle')}><InfinityIcon size={12} className="text-gray-400" /></span>}
        </div>
      </div>
      <p className="text-sm font-medium text-gray-800 break-words leading-snug">{item.display}</p>
      <p className="text-xs text-gray-400">{item.next_date}</p>
      <p className={clsx(
        'text-lg font-bold leading-none mt-1 text-gray-700',
        item.is_today && '!text-orange-500',
      )}>
        {text}
      </p>
      {item.notes && <p className="text-[11px] text-gray-400 break-words leading-snug line-clamp-2">{item.notes}</p>}
    </div>
  )
}

function CountdownDetailPanel({ item, onClose, onSave, onDelete }: {
  item: CountdownItem | null
  onClose: () => void
  onSave: (data: {
    name: string
    category: string
    base_date: string
    repeat_yearly: boolean
    repeat_type: 'solar' | 'lunar'
    milestone_rule: string | null
    never_expire: boolean
    notes: string | null
  }, id?: number) => void
  onDelete: (id: number) => void
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>(BUILTIN_CATEGORIES[0])
  const [customCategory, setCustomCategory] = useState(false)
  const [baseDate, setBaseDate] = useState('')
  const [repeatYearly, setRepeatYearly] = useState(false)
  const [repeatType, setRepeatType] = useState<'solar' | 'lunar'>('solar')
  const [milestoneRule, setMilestoneRule] = useState('')
  const [neverExpire, setNeverExpire] = useState(false)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (item) {
      setName(item.name)
      setCategory(item.category)
      setCustomCategory(!BUILTIN_CATEGORIES.includes(item.category))
      setBaseDate(item.base_date)
      setRepeatYearly(item.repeat_yearly)
      setRepeatType(item.repeat_type === 'lunar' ? 'lunar' : 'solar')
      setMilestoneRule(item.milestone_rule ?? '')
      setNeverExpire(item.never_expire)
      setNotes(item.notes ?? '')
    } else {
      setName('')
      setCategory(BUILTIN_CATEGORIES[0])
      setCustomCategory(false)
      setBaseDate('')
      setRepeatYearly(false)
      setRepeatType('solar')
      setMilestoneRule('')
      setNeverExpire(false)
      setNotes('')
    }
  }, [item])

  const isNew = !item

  return (
    <aside className="w-72 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <p className="text-xs text-gray-400 uppercase tracking-wide">{isNew ? t('countdown.createNew') : t('countdown.editTitle')}</p>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 text-sm">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <label className="text-xs text-gray-500 block">
          <span className="block mb-1">{t('countdown.fieldName')}</span>
          <input
            className="tt-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('countdown.placeholderName')}
          />
        </label>

        <label className="text-xs text-gray-500 block">
          <span className="block mb-1">{t('countdown.fieldCategory')}</span>
          {customCategory ? (
            <div className="flex gap-1">
              <input
                className="tt-input flex-1"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t('countdown.placeholderCustomCat')}
                autoFocus
              />
              <button
                type="button"
                onClick={() => { setCustomCategory(false); setCategory(BUILTIN_CATEGORIES[0]) }}
                className="px-2 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-md"
              >
                {t('countdown.back')}
              </button>
            </div>
          ) : (
            <select
              className="tt-input"
              value={BUILTIN_CATEGORIES.includes(category) ? category : '__custom__'}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setCustomCategory(true)
                  setCategory('')
                } else {
                  setCategory(e.target.value)
                }
              }}
            >
              <option value={BUILTIN_CATEGORIES[0]}>{t('countdown.categoryBirthday')}</option>
              <option value={BUILTIN_CATEGORIES[1]}>{t('countdown.categoryAnniversary')}</option>
              <option value={BUILTIN_CATEGORIES[2]}>{t('countdown.categoryFestival')}</option>
              <option value={BUILTIN_CATEGORIES[3]}>{t('countdown.categoryImportant')}</option>
              <option value="__custom__">{t('countdown.optionCustom')}</option>
            </select>
          )}
        </label>

        <label className="text-xs text-gray-500 block">
          <span className="block mb-1">{repeatYearly || milestoneRule ? t('countdown.fieldBaseDate') : t('countdown.fieldDate')}</span>
          <input type="date" className="tt-input" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
        </label>

        <label className="flex items-center justify-between text-xs text-gray-600 cursor-pointer">
          <span className="flex items-center gap-1.5"><Repeat size={13} /> {t('countdown.repeatYearlyLabel')}</span>
          <input type="checkbox" className="accent-blue-500" checked={repeatYearly} onChange={(e) => setRepeatYearly(e.target.checked)} />
        </label>

        {repeatYearly && (
          <label className="text-xs text-gray-500 block ml-1">
            <span className="block mb-1">{t('countdown.repeatRule')}</span>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="repeat-type" className="accent-blue-500" checked={repeatType === 'solar'} onChange={() => setRepeatType('solar')} />
                {t('countdown.ruleSolar')}
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="repeat-type" className="accent-blue-500" checked={repeatType === 'lunar'} onChange={() => setRepeatType('lunar')} />
                {t('countdown.ruleLunar')}
              </label>
            </div>
          </label>
        )}

        <label className="text-xs text-gray-500 block">
          <span className="block mb-1">{t('countdown.fieldMilestone')}</span>
          <input
            className="tt-input"
            value={milestoneRule}
            onChange={(e) => setMilestoneRule(e.target.value)}
            placeholder="100,365,520,1000,3650"
          />
          <span className="block mt-1 text-[10px] text-gray-400">{t('countdown.milestoneHint')}</span>
        </label>

        <label className="flex items-center justify-between text-xs text-gray-600 cursor-pointer">
          <span className="flex items-center gap-1.5"><InfinityIcon size={13} /> {t('countdown.neverExpireLabel')}</span>
          <input type="checkbox" className="accent-blue-500" checked={neverExpire} onChange={(e) => setNeverExpire(e.target.checked)} />
        </label>

        <label className="text-xs text-gray-500 block">
          <span className="block mb-1">{t('countdown.fieldNotes')}</span>
          <textarea
            className="tt-input resize-y min-h-[60px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('countdown.placeholderNotes')}
          />
        </label>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
        {item ? (
          <button
            onClick={() => onDelete(item.id)}
            className="flex items-center gap-1 text-sm text-red-500 hover:text-red-600"
          >
            {t('common.delete')}
          </button>
        ) : <span />}
        <button
          disabled={!name.trim() || !baseDate}
          onClick={() => onSave({
            name: name.trim(),
            // 「其他」是留空分类时写入 DB 的默认存储值（持久化数据，手册 §5.1）
            // eslint-disable-next-line no-restricted-syntax
            category: category.trim() || '其他',
            base_date: baseDate,
            repeat_yearly: repeatYearly,
            repeat_type: repeatType,
            milestone_rule: milestoneRule.trim() || null,
            never_expire: neverExpire,
            notes: notes.trim() || null,
          }, item?.id)}
          className={clsx(
            'px-3 py-1.5 text-sm rounded-lg',
            (!name.trim() || !baseDate) ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600',
          )}
        >
          {item ? t('common.save') : t('countdown.createBtn')}
        </button>
      </div>
    </aside>
  )
}
