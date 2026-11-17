import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import type { Todo } from '../../types'
import { todayStr } from '../../utils/todoLogic'
import { fmtDate, fmtWeekday, useLang, useT } from '../../i18n'
import { useCalendarTheme, withAlpha } from '../../lib/calendar-theme'
import { AnimatedCheck } from '../ui/AnimatedCheck'

interface Props {
  todos: Todo[]
  selectedTodoId: string | null
  onSelect: (id: string) => void
  onOpenNotes?: (id: string) => void
  onToggle?: (todo: Todo, done: boolean) => void
}

/** 一天的容量按「格」算：困难 3 格、中等 2 格、简单 1 格，默认 12 格 */
const CAPACITY = 12
const WEIGHT = { hard: 3, medium: 2, simple: 1 } as const
type Cx = keyof typeof WEIGHT

const ORDER: Cx[] = ['hard', 'medium', 'simple']
const LABEL_KEY = {
  hard: 'todoboards.jar.legendHard',
  medium: 'todoboards.jar.legendMedium',
  simple: 'todoboards.jar.legendSimple',
} as const

const METER_H = 268

/**
 * 量筒 v4 = 今日容量计。
 *
 * 前几版的问题不是画得不像罐子，而是把 12px 的任务标题塞进石块里——信息密度和
 * 可读性都输了。这一版把「可视化」和「清单」拆开：左边一根量筒只回答「今天装了多少」，
 * 右边是能读全标题、能勾选、能看列表名的正常清单；两者共用同一份分组。
 * 颜色全部走主题语义 token，罐体玻璃用面板色与描边色生成，不再是一套固定的米色。
 */
export function TodoJarView({ todos, selectedTodoId, onSelect, onOpenNotes, onToggle }: Props) {
  const t = useT()
  const lang = useLang()
  const { theme } = useCalendarTheme()
  const today = todayStr()
  const [showDone, setShowDone] = useState(false)

  const { groups, todayDone, load, overflowCount } = useMemo(() => {
    const open = todos.filter((td) => td.status !== 'completed' && (td.due_date === today || td.planned_date === today))
    const done = todos.filter((td) => td.status === 'completed' && (td.completed_at ?? '').slice(0, 10) === today)
    const g: Record<Cx, Todo[]> = {
      hard: open.filter((td) => td.complexity === 'hard'),
      medium: open.filter((td) => td.complexity === 'medium'),
      simple: open.filter((td) => td.complexity === 'simple' || !WEIGHT[td.complexity as Cx]),
    }
    let used = 0
    let over = 0
    for (const cx of ORDER) {
      for (const _ of g[cx]) {
        if (used + WEIGHT[cx] > CAPACITY) over += 1
        used += WEIGHT[cx]
      }
    }
    return {
      groups: g,
      todayDone: done,
      load: used,
      overflowCount: over,
    }
  }, [todos, today])

  const total = groups.hard.length + groups.medium.length + groups.simple.length
  const pct = Math.min(load / CAPACITY, 1)

  const dateStr = useMemo(() => {
    const d = new Date()
    return `${fmtDate(lang, d, { month: 'long', day: 'numeric' })} · ${fmtWeekday(lang, d, 'short')}`
  }, [lang])

  if (total === 0 && todayDone.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <div
          className="w-14 h-20 rounded-b-2xl rounded-t-lg border-2 border-dashed"
          style={{ borderColor: withAlpha(theme.muted, 0.35) }}
        />
        <p className="text-[13px]" style={{ color: theme.ink }}>{t('todoboards.jar.empty')}</p>
        <p className="text-[11px]" style={{ color: theme.muted }}>{t('todoboards.jar.emptyHint')}</p>
      </div>
    )
  }

  // 每段的可见高度：按权重占比，从底往上 困难 → 中等 → 简单
  const segs = ORDER.map((cx) => {
    const w = groups[cx].length * WEIGHT[cx]
    return { cx, h: (w / CAPACITY) * METER_H, count: groups[cx].length }
  })
  const colorOf = (cx: Cx) => (cx === 'hard' ? theme.danger : cx === 'medium' ? theme.warning : theme.success)

  return (
    <div className="h-full flex gap-4 min-h-0 pb-2">
      {/* 左：量筒 */}
      <section
        className="w-[188px] flex-shrink-0 flex flex-col rounded-xl border p-3 min-h-0"
        style={{ backgroundColor: 'var(--cal-panel)', borderColor: theme.border }}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] tracking-[0.14em]" style={{ color: theme.muted }}>
            {t('todoboards.jar.capacity')}
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: theme.muted }}>
            {Math.round((load / CAPACITY) * 100)}%
          </span>
        </div>

        <div className="relative mt-2 flex-1 min-h-0 flex items-center justify-center overflow-hidden">
          {/* 刻度与量筒同高：容器固定 METER_H，刻度和玻璃体才对齐 */}
          <div className="relative flex items-center" style={{ height: METER_H }}>
            {/* 刻度：25/50/75/100 四条细线贴在量筒右侧 */}
            <div className="absolute inset-y-0 -right-9 w-8 flex flex-col justify-between pointer-events-none">
              {[100, 75, 50, 25].map((n) => (
                <div key={n} className="flex items-center gap-1">
                  <span className="flex-1 h-px" style={{ backgroundColor: theme.border }} />
                  <span className="text-[8px] tabular-nums" style={{ color: theme.muted }}>{n}</span>
                </div>
              ))}
            </div>

            <div
              className="relative w-[86px] rounded-t-md rounded-b-[16px] overflow-hidden"
              style={{
                height: METER_H,
                border: `1.5px solid ${withAlpha(theme.muted, 0.45)}`,
                background: `linear-gradient(180deg, ${withAlpha(theme.surface, 0.9)}, ${withAlpha(theme.subtle, 0.85)})`,
              }}
              role="img"
              aria-label={t('todoboards.jar.jarAria')}
            >
            {/* 装填：从底部堆叠三段，段高按权重 */}
            <div className="absolute inset-x-0 bottom-0 flex flex-col-reverse">
              {segs.map((s) =>
                s.h <= 0 ? null : (
                  <div
                    key={s.cx}
                    className="w-full relative transition-[height] duration-300"
                    style={{
                      height: s.h,
                      backgroundColor: withAlpha(colorOf(s.cx), 0.55),
                      borderTop: s.cx === 'simple' ? 'none' : `1px solid ${withAlpha(colorOf(s.cx), 0.75)}`,
                    }}
                  >
                    <span className="absolute left-1.5 top-1 text-[9px] tabular-nums" style={{ color: withAlpha(theme.ink, 0.75) }}>
                      {s.count}
                    </span>
                  </div>
                ),
              )}
            </div>

            {/* 液面高光 + 玻璃反光 */}
            <span
              className="absolute left-0 right-0 h-[2px] pointer-events-none"
              style={{ bottom: `${pct * 100}%`, backgroundColor: withAlpha(theme.ink, 0.18) }}
            />
            <span
              className="absolute left-2 top-3 bottom-6 w-[6px] rounded-full pointer-events-none"
              style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.12))' }}
            />

            {/* 今日完成 = 底部沉降层，不占装载量 */}
            {todayDone.length > 0 && (
              <div
                className="absolute inset-x-0 bottom-0 flex items-end justify-center pb-0.5 pointer-events-none"
                style={{
                  height: Math.min(16 + todayDone.length * 4, 34),
                  background: `linear-gradient(180deg, ${withAlpha(theme.muted, 0.08)}, ${withAlpha(theme.muted, 0.2)})`,
                }}
              >
                <span className="text-[8px] tabular-nums" style={{ color: withAlpha(theme.ink, 0.6) }}>
                  {todayDone.length}
                </span>
              </div>
            )}
          </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px]" style={{ color: theme.muted }}>{t('todoboards.jar.loadLabel')}</span>
          <span className="text-[11px] tabular-nums font-medium" style={{ color: theme.ink }}>
            {load}/{CAPACITY} <span className="font-normal" style={{ color: theme.muted }}>{t('todoboards.jar.cellUnit')}</span>
          </span>
        </div>

        {overflowCount > 0 && (
          <div
            className="mt-1.5 text-[10px] px-2 py-1 rounded-md text-center tabular-nums"
            style={{ backgroundColor: withAlpha(theme.danger, 0.1), color: theme.danger }}
          >
            {t('todoboards.jar.overCapacity', { n: overflowCount })}
          </div>
        )}
      </section>

      {/* 右：今日清单 */}
      <section
        className="flex-1 min-w-0 flex flex-col rounded-xl border overflow-hidden"
        style={{ backgroundColor: 'var(--cal-panel)', borderColor: theme.border }}
      >
        <header className="px-3.5 py-2.5 flex items-center justify-between gap-2 flex-shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.14em]" style={{ color: theme.muted }}>{t('todoboards.jar.title')}</p>
            <p className="text-[13px] font-medium truncate" style={{ color: theme.ink }}>{dateStr}</p>
          </div>
          <p className="text-[11px] tabular-nums flex-shrink-0" style={{ color: theme.muted }}>
            {total} {t('todoboards.jar.piece')}
            <span className="mx-1.5">·</span>
            <span style={{ color: theme.success }}>{todayDone.length}</span> {t('todoboards.jar.settled')}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-2.5 py-2 min-h-0">
          {ORDER.map((cx) => {
            const items = groups[cx]
            if (items.length === 0) return null
            return (
              <div key={cx} className="mb-2.5 last:mb-0">
                <div className="flex items-center gap-1.5 px-1 mb-1">
                  <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: colorOf(cx) }} />
                  <span className="text-[11px] font-medium" style={{ color: theme.ink }}>{t(LABEL_KEY[cx])}</span>
                  <span className="text-[10px] tabular-nums" style={{ color: theme.muted }}>{items.length}</span>
                  <span className="flex-1 h-px" style={{ backgroundColor: theme.border }} />
                </div>
                <div className="flex flex-col gap-0.5">
                  {items.map((td) => {
                    const sel = selectedTodoId === td.id
                    return (
                      <div
                        key={td.id}
                        onClick={() => onSelect(td.id)}
                        onDoubleClick={() => onOpenNotes?.(td.id)}
                        className={clsx('group flex items-start gap-2 px-1.5 py-1 rounded-lg cursor-pointer transition-colors cal-hover-bg')}
                        style={sel ? { backgroundColor: withAlpha(theme.accent, 0.08) } : undefined}
                      >
                        <AnimatedCheck
                          checked={false}
                          onClick={(e) => { e.stopPropagation(); onToggle?.(td, true) }}
                          ariaLabel={t('todoboards.aria.markDone')}
                          shape="circle"
                          checkSize={9}
                          className="mt-0.5 border border-[color:var(--cal-border)] hover:border-[color:var(--cal-success)]"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12.5px] leading-snug break-words" style={{ color: theme.ink }}>{td.title}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {td.due_date === today && (
                              <span
                                className="text-[9.5px] px-1 py-[1px] rounded"
                                style={{ backgroundColor: withAlpha(theme.warning, 0.12), color: theme.warning }}
                              >
                                {t('todoboards.card.today')}
                              </span>
                            )}
                            {(td.tags ?? []).slice(0, 2).map((tag) => (
                              <span key={tag} className="text-[9.5px]" style={{ color: theme.muted }}>#{tag}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {total === 0 && (
            <p className="text-[12px] py-6 text-center" style={{ color: theme.muted }}>{t('todoboards.jar.empty')}</p>
          )}
        </div>

        {todayDone.length > 0 && (
          <div className="flex-shrink-0" style={{ borderTop: `1px solid ${theme.border}` }}>
            <button
              onClick={() => setShowDone((v) => !v)}
              className="w-full px-3.5 py-2 flex items-center gap-1.5 text-[11px] cursor-pointer cal-hover-bg"
              style={{ color: theme.muted }}
            >
              {showDone ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <CheckCircle2 size={12} style={{ color: theme.success }} />
              {t('todoboards.jar.settledToday', { n: todayDone.length })}
            </button>
            {showDone && (
              <div className="px-3 pb-2 flex flex-col gap-0.5 max-h-[140px] overflow-y-auto">
                {todayDone.slice(0, 20).map((td) => (
                  <div key={td.id} className="flex items-center gap-1.5 px-1.5 py-1 rounded">
                    <CheckCircle2 size={11} style={{ color: theme.success }} className="flex-shrink-0" />
                    <span className="text-[11.5px] line-through truncate" style={{ color: theme.muted }}>{td.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
