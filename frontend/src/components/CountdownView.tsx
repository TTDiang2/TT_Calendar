import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock, CalendarClock, Infinity as InfinityIcon, Plus, Repeat, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import { getCountdownList, createCountdown, updateCountdown, deleteCountdown } from '../api/client'
import type { CountdownItem } from '../types'

const CATEGORY_COLORS: Record<string, string> = {
  生日: '#f472b6',
  纪念日: '#f59e0b',
  节日: '#a78bfa',
  重要事件: '#60a5fa',
}

export function CountdownView() {
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
    return ['生日', '纪念日', '节日', '重要事件', ...Array.from(set).filter((c) => !['生日', '纪念日', '节日', '重要事件'].includes(c))]
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
          <span className="flex items-center gap-1.5"><AlarmClock size={14} /> 全部</span>
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
              {c}
            </span>
            <span className="text-xs text-gray-400">{items.filter((i) => i.category === c).length}</span>
          </button>
        ))}
        <button
          onClick={() => { setSelectedCategory(null); setSelectedId('NEW') }}
          className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-400 hover:text-gray-600 mt-1"
        >
          <Plus size={14} /> 新建倒数日
        </button>
      </div>

      {/* 中卡片区 */}
      <div className="flex-1 flex flex-col p-4 overflow-hidden min-w-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
            <CalendarClock size={16} /> 倒数日{selectedCategory ? ` · ${selectedCategory}` : ''}
          </h2>
          <button
            onClick={() => { setSelectedCategory(null); setSelectedId('NEW') }}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            <Plus size={14} /> 新建
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-gray-400">加载中…</p>
          ) : filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-300 gap-2">
              <AlarmClock size={40} />
              <p className="text-sm">暂无倒数日，点「新建」添加</p>
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
          if (confirm('删除该倒数日？')) {
            deleteMut.mutate(id)
            setSelectedId(null)
          }
        }}
      />
    </div>
  )
}

function CountdownCard({ item, selected, onSelect }: { item: CountdownItem; selected: boolean; onSelect: () => void }) {
  const catColor = CATEGORY_COLORS[item.category] ?? '#9ca3af'
  const text = item.is_today
    ? '🎉 就是今天'
    : item.passed
      ? item.never_expire
        ? '已过 · 永久纪念'
        : `已过 ${-item.days_left} 天`
      : `还有 ${item.days_left} 天`

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
        <span className="text-[10px] text-gray-400 px-1.5 py-0.5 rounded bg-gray-50">{item.category}</span>
        <div className="ml-auto flex gap-1">
            {item.repeat_yearly && (
              <span title={item.repeat_type === 'lunar' ? '按农历每年重置' : '每年重置'}>
                <Repeat size={12} className={item.repeat_type === 'lunar' ? 'text-red-400' : 'text-gray-400'} />
              </span>
            )}
            {item.repeat_type === 'lunar' && <span title="农历重复" className="text-[10px] text-red-400">农历</span>}
          {item.milestone_rule && <span title="自动计算里程碑"><Sparkles size={12} className="text-amber-400" /></span>}
          {item.never_expire && <span title="永不过期"><InfinityIcon size={12} className="text-gray-400" /></span>}
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
  const [name, setName] = useState('')
  const [category, setCategory] = useState('生日')
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
      setCustomCategory(!['生日', '纪念日', '节日', '重要事件'].includes(item.category))
      setBaseDate(item.base_date)
      setRepeatYearly(item.repeat_yearly)
      setRepeatType(item.repeat_type === 'lunar' ? 'lunar' : 'solar')
      setMilestoneRule(item.milestone_rule ?? '')
      setNeverExpire(item.never_expire)
      setNotes(item.notes ?? '')
    } else {
      setName('')
      setCategory('生日')
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
        <p className="text-xs text-gray-400 uppercase tracking-wide">{isNew ? '新建倒数日' : '倒数日设置'}</p>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 text-sm">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <label className="text-xs text-gray-500 block">
          <span className="block mb-1">名称</span>
          <input
            className="tt-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：生日 / 结婚纪念日"
          />
        </label>

        <label className="text-xs text-gray-500 block">
          <span className="block mb-1">分类</span>
          {customCategory ? (
            <div className="flex gap-1">
              <input
                className="tt-input flex-1"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="输入自定义分类名"
                autoFocus
              />
              <button
                type="button"
                onClick={() => { setCustomCategory(false); setCategory('生日') }}
                className="px-2 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-md"
              >
                返回
              </button>
            </div>
          ) : (
            <select
              className="tt-input"
              value={['生日', '纪念日', '节日', '重要事件'].includes(category) ? category : '__custom__'}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setCustomCategory(true)
                  setCategory('')
                } else {
                  setCategory(e.target.value)
                }
              }}
            >
              <option value="生日">生日</option>
              <option value="纪念日">纪念日</option>
              <option value="节日">节日</option>
              <option value="重要事件">重要事件</option>
              <option value="__custom__">+ 自定义…</option>
            </select>
          )}
        </label>

        <label className="text-xs text-gray-500 block">
          <span className="block mb-1">{repeatYearly || milestoneRule ? '基准日期' : '日期'}</span>
          <input type="date" className="tt-input" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
        </label>

        <label className="flex items-center justify-between text-xs text-gray-600 cursor-pointer">
          <span className="flex items-center gap-1.5"><Repeat size={13} /> 每年重置（生日/节日）</span>
          <input type="checkbox" className="accent-blue-500" checked={repeatYearly} onChange={(e) => setRepeatYearly(e.target.checked)} />
        </label>

        {repeatYearly && (
          <label className="text-xs text-gray-500 block ml-1">
            <span className="block mb-1">重复规则</span>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="repeat-type" className="accent-blue-500" checked={repeatType === 'solar'} onChange={() => setRepeatType('solar')} />
                按公历（每年同月日）
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="repeat-type" className="accent-blue-500" checked={repeatType === 'lunar'} onChange={() => setRepeatType('lunar')} />
                按农历（春节/七夕等）
              </label>
            </div>
          </label>
        )}

        <label className="text-xs text-gray-500 block">
          <span className="block mb-1">自动计算纪念日（逗号分隔天数）</span>
          <input
            className="tt-input"
            value={milestoneRule}
            onChange={(e) => setMilestoneRule(e.target.value)}
            placeholder="100,365,520,1000,3650"
          />
          <span className="block mt-1 text-[10px] text-gray-400">从基准日期起自动生成百天/周年等特殊日子，显示最近的下一个。</span>
        </label>

        <label className="flex items-center justify-between text-xs text-gray-600 cursor-pointer">
          <span className="flex items-center gap-1.5"><InfinityIcon size={13} /> 过期后不显示「已过」</span>
          <input type="checkbox" className="accent-blue-500" checked={neverExpire} onChange={(e) => setNeverExpire(e.target.checked)} />
        </label>

        <label className="text-xs text-gray-500 block">
          <span className="block mb-1">备注</span>
          <textarea
            className="tt-input resize-y min-h-[60px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="可选"
          />
        </label>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
        {item ? (
          <button
            onClick={() => onDelete(item.id)}
            className="flex items-center gap-1 text-sm text-red-500 hover:text-red-600"
          >
            删除
          </button>
        ) : <span />}
        <button
          disabled={!name.trim() || !baseDate}
          onClick={() => onSave({
            name: name.trim(),
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
          {item ? '保存' : '创建'}
        </button>
      </div>
    </aside>
  )
}
