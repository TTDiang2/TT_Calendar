import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, ChevronDown, ChevronRight, Sun } from 'lucide-react'
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

/** 一天的容量按「格」算：复杂 3 格、中等 2 格、简单 1 格，默认 12 格 */
const CAPACITY = 12
const WEIGHT = { hard: 3, medium: 2, simple: 1 } as const
type Cx = keyof typeof WEIGHT

const ORDER: Cx[] = ['hard', 'medium', 'simple']

/** 环形进度：半径 48、线宽 9，周长用于 dasharray */
const RING = 52
const RING_C = 2 * Math.PI * RING
const RING_BOX = 128

/**
 * 今日视图 = 今日统计 + 今日清单。
 *
 * 上一版是「量筒/罐子」的拟物插画：玻璃筒、液面、磐石卵石沙粒。隐喻本身没问题，
 * 但把一个 12px 的任务标题塞进石块里，信息密度和可读性都输给了普通清单，
 * 于是这一版整体退回「数据面板」这个更直白的形态：
 *
 *   左栏是一张正常的进度统计 —— 完成率环形图 + 按复杂度分布的三条横条 + 负载；
 *   右栏是能读全标题、能勾选、能看列表名的今日清单。
 *
 * 原来那层意思一点没丢：仍然回答「今天排了多少、做完多少、装得下吗」，
 * 只是不再借玻璃罐来讲。分组维度也从「石子大小」改成复杂度本身（复杂/中等/简单）。
 */
export function TodoTodayView({ todos, selectedTodoId, onSelect, onOpenNotes, onToggle }: Props) {
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
    return { groups: g, todayDone: done, load: used, overflowCount: over }
  }, [todos, today])

  const total = groups.hard.length + groups.medium.length + groups.simple.length
  const doneCount = todayDone.length
  const all = total + doneCount
  const rate = all === 0 ? 0 : doneCount / all
  const isOver = load > CAPACITY
  const maxCount = Math.max(1, groups.hard.length, groups.medium.length, groups.simple.length)

  const dateStr = useMemo(() => {
    const d = new Date()
    return `${fmtDate(lang, d, { month: 'long', day: 'numeric' })} · ${fmtWeekday(lang, d, 'short')}`
  }, [lang])

  if (all === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2.5">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center"
          style={{ backgroundColor: withAlpha(theme.muted, 0.12), color: theme.muted }}
        >
          <Sun size={20} />
        </div>
        <p className="text-[13px]" style={{ color: theme.ink }}>{t('todoboards.today.empty')}</p>
        <p className="text-[11px]" style={{ color: theme.muted }}>{t('todoboards.today.emptyHint')}</p>
      </div>
    )
  }

  const colorOf = (cx: Cx) => (cx === 'hard' ? theme.danger : cx === 'medium' ? theme.warning : theme.success)
  const labelKey = {
    hard: 'todoview.complexity.hard',
    medium: 'todoview.complexity.medium',
    simple: 'todoview.complexity.simple',
  } as const

  return (
    <div className="h-full flex gap-3 min-h-0 pb-1">
      {/* 左：今日统计 */}
      <section
        className="w-[216px] flex-shrink-0 flex flex-col justify-between rounded-xl border p-3.5 min-h-0 overflow-y-auto"
        style={{ backgroundColor: 'var(--cal-panel)', borderColor: theme.border }}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-medium tracking-[0.16em] uppercase" style={{ color: theme.muted }}>
            {t('todoboards.today.title')}
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: theme.muted }}>
            {dateStr}
          </span>
        </div>

        {/* 完成率：环形进度 */}
        <div className="mt-4 flex flex-col items-center">
          <div className="relative" style={{ width: RING_BOX, height: RING_BOX }}>
            <svg
              width={RING_BOX}
              height={RING_BOX}
              viewBox={`0 0 ${RING_BOX} ${RING_BOX}`}
              role="img"
              aria-label={t('todoboards.today.ringAria')}
              className="-rotate-90"
            >
              <circle
                cx={RING_BOX / 2}
                cy={RING_BOX / 2}
                r={RING}
                fill="none"
                stroke={withAlpha(theme.muted, 0.16)}
                strokeWidth={9}
              />
              <circle
                cx={RING_BOX / 2}
                cy={RING_BOX / 2}
                r={RING}
                fill="none"
                stroke={theme.accent}
                strokeWidth={9}
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - Math.min(rate, 1))}
                style={{ transition: 'stroke-dashoffset 640ms cubic-bezier(.16,1,.3,1)' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[24px] font-semibold leading-none tabular-nums" style={{ color: theme.ink }}>
                {Math.round(rate * 100)}
                <span className="text-[12px] font-medium ml-0.5" style={{ color: theme.muted }}>%</span>
              </span>
              <span className="mt-1 text-[10px] tabular-nums" style={{ color: theme.muted }}>
                {t('todoboards.today.doneOf', { done: doneCount, total: all })}
              </span>
            </div>
          </div>
        </div>

        {/* 按复杂度分布：竖向柱状图，把剩余高度吃掉——这是左栏唯一能"长"的区块 */}
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10px] tracking-[0.08em]" style={{ color: theme.muted }}>
              {t('todoboards.kanban.dim.complexity')}
            </span>
            <span className="flex-1 h-px" style={{ backgroundColor: theme.border }} />
          </div>
          {/* 高度封顶：柱状图跟着卡片长成 400px 就变成三根筷子，给个上限再让留白回到气口 */}
          <div className="h-[168px] flex items-stretch gap-2">
            {ORDER.map((cx) => {
              const count = groups[cx].length
              const h = maxCount === 0 ? 0 : (count / maxCount) * 100
              return (
                <div key={cx} className="flex-1 min-w-0 flex flex-col items-center">
                  <span
                    className="w-full max-w-[42px] flex-1 relative rounded-md"
                    style={{ backgroundColor: withAlpha(theme.muted, 0.1) }}
                  >
                    <span
                      className="absolute inset-x-0 bottom-0 rounded-md"
                      style={{
                        height: `${h}%`,
                        background: `linear-gradient(180deg, ${withAlpha(colorOf(cx), 0.55)}, ${withAlpha(colorOf(cx), 0.95)})`,
                        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35)`,
                        transition: 'height 480ms cubic-bezier(.16,1,.3,1)',
                      }}
                    />
                    {/* 数值贴在柱顶；满格时会被顶到框外，所以夹一下 */}
                    <span
                      className="absolute inset-x-0 text-center text-[10.5px] tabular-nums leading-none"
                      style={{
                        bottom: `min(calc(${h}% + 3px), calc(100% - 13px))`,
                        color: count === 0 ? withAlpha(theme.muted, 0.72) : theme.ink,
                        transition: 'bottom 480ms cubic-bezier(.16,1,.3,1)',
                      }}
                    >
                      {count}
                    </span>
                  </span>
                  <span className="mt-1.5 text-[10px] leading-none truncate max-w-full" style={{ color: theme.muted }}>
                    {t(labelKey[cx])}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 负载：仍回答「今天装得下吗」。做成贴边页脚——数据面板本来就该有个脚注区，
            否则中间那块留白会像「内容没写完」 */}
        <div
          className="-mx-3.5 -mb-3.5 rounded-b-xl px-3.5 pb-3 pt-2.5"
          style={{ borderTop: `1px solid ${theme.border}`, backgroundColor: withAlpha(theme.muted, 0.05) }}
        >
          <div className="flex items-baseline justify-between pt-0.5">
            <span className="text-[10px] tracking-[0.08em]" style={{ color: theme.muted }}>
              {t('todoboards.today.load')}
            </span>
            <span
              className="text-[11px] tabular-nums font-medium"
              style={{ color: isOver ? theme.dangerInk : theme.ink }}
            >
              {load}/{CAPACITY} <span className="font-normal" style={{ color: theme.muted }}>{t('todoboards.today.piece')}</span>
            </span>
          </div>
          <span
            className="mt-1.5 block h-[4px] rounded-full overflow-hidden"
            style={{ backgroundColor: withAlpha(theme.muted, 0.14) }}
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.min(load / CAPACITY, 1) * 100}%`,
                backgroundColor: isOver ? theme.danger : theme.accent,
                transition: 'width 480ms cubic-bezier(.16,1,.3,1)',
              }}
            />
          </span>
          {overflowCount > 0 && (
            <p className="mt-1.5 text-[10px] tabular-nums" style={{ color: theme.dangerInk }}>
              {t('todoboards.today.overCapacity', { n: overflowCount })}
            </p>
          )}
        </div>
      </section>

      {/* 右：今日清单 */}
      <section
        className="flex-1 min-w-0 flex flex-col rounded-xl border overflow-hidden"
        style={{ backgroundColor: 'var(--cal-panel)', borderColor: theme.border }}
      >
        <header
          className="px-3.5 py-2.5 flex items-center justify-between gap-2 flex-shrink-0"
          style={{ borderBottom: `1px solid ${theme.border}` }}
        >
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.14em] uppercase" style={{ color: theme.muted }}>
              {t('todoboards.today.title')}
            </p>
            <p className="text-[13px] font-medium truncate" style={{ color: theme.ink }}>{dateStr}</p>
          </div>
          <p className="text-[11px] tabular-nums flex-shrink-0" style={{ color: theme.muted }}>
            {total} {t('todoboards.today.piece')}
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
                  <span className="text-[11px] font-medium" style={{ color: theme.ink }}>{t(labelKey[cx])}</span>
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
                                style={{ backgroundColor: withAlpha(theme.warning, 0.14), color: theme.warningInk }}
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
            <p className="text-[12px] py-6 text-center" style={{ color: theme.muted }}>{t('todoboards.today.empty')}</p>
          )}
        </div>

        {doneCount > 0 && (
          <div className="flex-shrink-0" style={{ borderTop: `1px solid ${theme.border}` }}>
            <button
              onClick={() => setShowDone((v) => !v)}
              className="w-full px-3.5 py-2 flex items-center gap-1.5 text-[11px] cursor-pointer cal-hover-bg"
              style={{ color: theme.muted }}
            >
              {showDone ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <CheckCircle2 size={12} style={{ color: theme.success }} />
              {t('todoboards.today.doneToday', { n: doneCount })}
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
