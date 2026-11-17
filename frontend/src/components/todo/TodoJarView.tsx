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

/**
 * 玻璃体高度由容器决定（跟着窗口长），刻度与液面全部用百分比定位，
 * 这样「尺子」和「被量的东西」永远共用同一根基准线，不会因为容器高度变化而错位。
 */
const JAR_W = 96
const JAR_MAX_H = 380
const TICKS = [25, 50, 75, 100] as const

/**
 * 量筒 v4 = 今日容量计。
 *
 * 前几版的问题不是画得不像罐子，而是把 12px 的任务标题塞进石块里——信息密度和
 * 可读性都输了。这一版把「可视化」和「清单」拆开：左边一根量筒只回答「今天装了多少」，
 * 右边是能读全标题、能勾选、能看列表名的正常清单；两者共用同一份分组。
 * 颜色全部走主题语义 token，罐体玻璃用面板色与描边色生成，不再是一套固定的米色。
 *
 * v5 修掉三处硬伤：
 * 1. 刻度曾用 `justify-between` 摊成 0/33/67/100，尺子本身就是错的 —— 改成绝对定位到 bottom:n%；
 * 2. 超容量时真比例会把顶段顶出筒口被 `overflow-hidden` 静默切掉，看起来反而像「没装满」——
 *    改成先按 pct 截断再分配，并在筒口上方单独画一格虚线「溢出帽」；
 * 3. 86px 宽的筒配 6px 实心反光条读起来像根管子 —— 加宽到 96px、反光收到 3px 并降透明度。
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
  const isOver = load > CAPACITY

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

  // 每段的可见高度：先按 pct 截断到筒高，再按段间权重分配。
  // 直接拿 CAPACITY 换算会让超容量那段顶出筒口、被 overflow-hidden 静默切掉，看着像没装满。
  const segs = ORDER.map((cx) => {
    const w = groups[cx].length * WEIGHT[cx]
    return { cx, pctH: load === 0 ? 0 : pct * (w / load) * 100, count: groups[cx].length }
  })
  const colorOf = (cx: Cx) => (cx === 'hard' ? theme.danger : cx === 'medium' ? theme.warning : theme.success)

  return (
    <div className="h-full flex gap-4 min-h-0 pb-2">
      {/* 左：量筒 */}
      <section
        className="w-[204px] flex-shrink-0 flex flex-col rounded-xl border p-3 min-h-0"
        style={{ backgroundColor: 'var(--cal-panel)', borderColor: theme.border }}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] tracking-[0.14em]" style={{ color: theme.muted }}>
            {t('todoboards.jar.capacity')}
          </span>
          <span
            className="text-[10px] tabular-nums font-medium"
            style={{ color: isOver ? theme.dangerInk : theme.muted }}
          >
            {Math.round((load / CAPACITY) * 100)}%
          </span>
        </div>

        <div className="relative mt-2 flex-1 min-h-0 flex items-center justify-center">
          {/* 量筒与刻度共用一根基准线：同高容器 + 绝对定位到 bottom:n% */}
          <div
            className="relative flex-shrink-0 h-full"
            style={{ height: `min(100%, ${JAR_MAX_H}px)`, width: JAR_W }}
          >
            {/* 玻璃体 */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{
                borderRadius: '3px 3px 18px 18px',
                border: `1.5px solid ${withAlpha(theme.muted, 0.42)}`,
                background: `linear-gradient(180deg, ${withAlpha(theme.surface, 0.5)}, ${withAlpha(theme.subtle, 0.72)})`,
                boxShadow: `inset 0 3px 8px ${withAlpha(theme.ink, 0.045)}`,
              }}
              role="img"
              aria-label={t('todoboards.jar.jarAria')}
            >
              {/* 装填：从底部往上 困难 → 中等 → 简单，段高按权重（百分比，跟着筒高走） */}
              <div className="absolute inset-0 flex flex-col-reverse">
                {segs.map((s) =>
                  s.pctH <= 0.15 ? null : (
                    <div
                      key={s.cx}
                      className="w-full relative flex-shrink-0 transition-[height] duration-500 ease-out"
                      style={{
                        height: `${s.pctH}%`,
                        background: `linear-gradient(180deg, ${withAlpha(colorOf(s.cx), 0.6)}, ${withAlpha(colorOf(s.cx), 0.44)})`,
                        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.32)`,
                      }}
                    >
                      {s.pctH >= 7 && (
                        <span
                          className="absolute left-1/2 -translate-x-1/2 top-1 text-[9px] tabular-nums leading-none font-medium"
                          style={{ color: 'rgba(255,255,255,0.88)', textShadow: `0 0 2px ${withAlpha(theme.ink, 0.35)}` }}
                        >
                          {s.count}
                        </span>
                      )}
                    </div>
                  ),
                )}
              </div>

              {/* 液体整体的玻璃微光：左亮右暗，给色块一点体积感 */}
              <span
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(90deg, rgba(255,255,255,0.22), rgba(255,255,255,0) 26%, rgba(255,255,255,0) 72%, rgba(0,0,0,0.055))',
                }}
              />

              {/* 刻度线：白色丝印，压在液体上也能看清（真实量筒就是这个做法） */}
              <div className="absolute inset-0 pointer-events-none">
                {TICKS.map((n) => (
                  <span
                    key={n}
                    className="absolute right-0"
                    style={{
                      bottom: `${n}%`,
                      width: n === 100 ? 16 : 10,
                      height: n === 100 ? 1.5 : 1,
                      backgroundColor:
                        isOver && n === 100
                          ? withAlpha('#FFFFFF', 0.9)
                          : withAlpha('#FFFFFF', 0.68),
                      boxShadow: `0 0 0 0.4px ${withAlpha(theme.ink, 0.13)}`,
                    }}
                  />
                ))}
              </div>

              {/* 液面 + 玻璃反光 */}
              {pct > 0.005 && pct < 0.995 && (
                <span
                  className="absolute left-0 right-0 h-[1.5px] pointer-events-none"
                  style={{ bottom: `${pct * 100}%`, backgroundColor: withAlpha(theme.ink, 0.16) }}
                />
              )}
              {/* 玻璃反光：横向柔化 + 纵向衰减，别做成一根硬白棍 */}
              <span
                className="absolute left-[10px] top-4 bottom-8 w-[7px] pointer-events-none"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.06))',
                  maskImage: 'linear-gradient(90deg, transparent, #000 45%, transparent)',
                  WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 45%, transparent)',
                }}
              />

              {/* 今日完成 = 底部沉降层，不占装载量 */}
              {todayDone.length > 0 && (
                <div
                  className="absolute inset-x-0 bottom-0 flex items-end justify-center pb-0.5 pointer-events-none"
                  style={{
                    height: Math.min(14 + todayDone.length * 3, 28),
                    background: `linear-gradient(180deg, ${withAlpha(theme.muted, 0.06)}, ${withAlpha(theme.muted, 0.22)})`,
                  }}
                >
                  <span className="text-[8px] tabular-nums" style={{ color: withAlpha(theme.ink, 0.6) }}>
                    {todayDone.length}
                  </span>
                </div>
              )}
            </div>

            {/* 筒口：玻璃体的上沿，画在 overflow 之外 */}
            <span
              className="absolute -left-[3px] -right-[3px] -top-[3px] h-[7px] rounded-[3px] pointer-events-none"
              style={{
                border: `1.5px solid ${withAlpha(theme.muted, 0.42)}`,
                backgroundColor: withAlpha(theme.panel, 0.95),
              }}
            />

            {/* 溢出帽：装在筒口上方，一眼看出「满了还多出来」 */}
            {isOver && (
              <div
                className="absolute -left-[3px] -right-[3px] rounded-[3px] border border-dashed pointer-events-none"
                style={{
                  top: -19,
                  height: 12,
                  borderColor: withAlpha(theme.danger, 0.8),
                  backgroundColor: withAlpha(theme.danger, 0.14),
                }}
              />
            )}

            {/* 刻度数字：贴在筒身右侧，与筒内刻度线同一 bottom 基准 */}
            <div className="absolute inset-y-0 pointer-events-none" style={{ left: JAR_W + 6 }}>
              {TICKS.map((n) => (
                <span
                  key={n}
                  className="absolute text-[8.5px] tabular-nums leading-none"
                  style={{
                    bottom: `${n}%`,
                    transform: 'translateY(50%)',
                    color: isOver && n === 100 ? theme.dangerInk : theme.muted,
                  }}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px]" style={{ color: theme.muted }}>{t('todoboards.jar.loadLabel')}</span>
          <span className="text-[11px] tabular-nums font-medium" style={{ color: isOver ? theme.dangerInk : theme.ink }}>
            {load}/{CAPACITY} <span className="font-normal" style={{ color: theme.muted }}>{t('todoboards.jar.cellUnit')}</span>
          </span>
        </div>

        {overflowCount > 0 && (
          <div
            className="mt-1.5 text-[10px] px-2 py-1 rounded-md text-center tabular-nums"
            style={{ backgroundColor: withAlpha(theme.danger, 0.12), color: theme.dangerInk }}
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
            <span style={{ color: theme.successInk }}>{todayDone.length}</span> {t('todoboards.jar.settled')}
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
