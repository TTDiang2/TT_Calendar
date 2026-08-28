import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import clsx from 'clsx'
import type { Todo } from '../../types'
import { todayStr } from '../../utils/todoLogic'

interface Props {
  todos: Todo[]
  selectedTodoId: string | null
  onSelect: (id: string) => void
  onOpenNotes?: (id: string) => void
}

const VW = 440
const VH = 480
const PAD = 14
const AVAIL = VH - PAD * 2
const H_HARD = 66
const H_MED = 46
const H_SIMPLE = 30
const GAP = 3

const WEEKDAY = '日一二三四五六'

// 材质：板岩（难，斜纹凿痕）、灰岩（中，素面）、沙（简，颗粒）
const HATCH = 'repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 7px)'
const GRAIN = 'radial-gradient(rgba(120,94,50,0.18) 1px, transparent 1.3px)'

interface Layer {
  todo: Todo
  h: number
  style: CSSProperties
  textCls: string
  chipCls: string
}

function layerOf(todo: Todo): Layer {
  if (todo.complexity === 'hard') {
    return {
      todo, h: H_HARD,
      style: { backgroundImage: `${HATCH}, linear-gradient(180deg, #5d6f83 0%, #46586e 100%)` },
      textCls: 'text-white/95', chipCls: 'border-white/30 text-white/85',
    }
  }
  if (todo.complexity === 'medium') {
    return {
      todo, h: H_MED,
      style: { backgroundImage: 'linear-gradient(180deg, #a3b4c6 0%, #8ba0b5 100%)' },
      textCls: 'text-white/95', chipCls: 'border-white/35 text-white/90',
    }
  }
  return {
    todo, h: H_SIMPLE,
    style: {
      backgroundImage: `${GRAIN}, linear-gradient(180deg, #f0e4c4 0%, #e2cf9f 100%)`,
      backgroundSize: '8px 7px, auto',
    },
    textCls: 'text-[#6a5a2e]', chipCls: 'border-[#8a6d2f]/35 text-[#7a5f22]',
  }
}

export function TodoJarView({ todos, selectedTodoId, onSelect, onOpenNotes }: Props) {
  const today = todayStr()

  const { todayOpen, todayDone } = useMemo(() => {
    const open = todos.filter((t) =>
      t.status !== 'completed' && (t.due_date === today || t.planned_date === today))
    const done = todos.filter((t) => t.status === 'completed' && (t.completed_at ?? '').slice(0, 10) === today)
    return { todayOpen: open, todayDone: done }
  }, [todos, today])

  // 难→中→简（底→顶）；DOM 顺序取反（flex justify-end，最后的孩子在最底）
  const bottomUp = useMemo(() => {
    const hard = todayOpen.filter((t) => t.complexity === 'hard').map(layerOf)
    const medium = todayOpen.filter((t) => t.complexity === 'medium').map(layerOf)
    const simple = todayOpen.filter((t) => t.complexity === 'simple').map(layerOf)
    return [...hard, ...medium, ...simple]
  }, [todayOpen])

  const sedimentH = todayDone.length ? Math.min(24 + todayDone.length * 7, 100) : 0
  const strataCount = bottomUp.length
  const used = sedimentH + bottomUp.reduce((s, l) => s + l.h, 0) + strataCount * GAP
  const fill = Math.min(100, Math.round((used / AVAIL) * 100))
  const remain = Math.max(0, Math.floor((AVAIL - used) / H_SIMPLE))

  const overflowCount = useMemo(() => {
    let excess = used - AVAIL
    if (excess <= 0) return 0
    let n = 0
    for (const l of [...bottomUp].reverse()) {
      excess -= l.h + GAP
      n += 1
      if (excess <= 0) break
    }
    return n
  }, [used, AVAIL, bottomUp])

  const dateStr = useMemo(() => {
    const d = new Date()
    return `${d.getMonth() + 1}月${d.getDate()}日 · 周${WEEKDAY[d.getDay()]}`
  }, [])

  if (todayOpen.length === 0 && todayDone.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-[#f8fafc] to-[#edf1f6] text-slate-400">
        <svg width="64" height="88" viewBox="0 0 72 96" aria-hidden="true">
          <path d="M22 4 L50 4 L45 16 L45 78 Q45 88 36 88 Q27 88 27 78 L27 16 Z" fill="#e8eef5" stroke="#b9c6d4" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M17 13 L55 13 L51 21 L21 21 Z" fill="#f2f6fa" stroke="#b9c6d4" strokeWidth="2.5" strokeLinejoin="round" />
          <line x1="34" y1="42" x2="34" y2="72" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.75" />
        </svg>
        <p className="text-sm text-slate-500">今天还没有安排</p>
        <p className="text-xs">先放一块大石头进去吧（截止/计划日设为今天）</p>
      </div>
    )
  }

  const domTopToBottom = [...bottomUp].reverse()

  return (
    <div className="h-full overflow-auto bg-gradient-to-b from-[#f8fafc] to-[#edf1f6]">
      <div className="min-h-full flex flex-col items-center justify-center gap-5 py-8 px-4">
        <div className="flex items-end justify-between" style={{ width: VW }}>
          <div>
            <p className="text-[10px] tracking-[0.25em] text-slate-400 font-medium">今日容量</p>
            <p className="text-lg font-semibold text-slate-700 leading-tight">{dateStr}</p>
          </div>
          <div className="text-right">
            <p className="leading-none">
              <span className="text-[26px] font-semibold tabular-nums text-slate-700">{fill}</span>
              <span className="text-sm font-medium text-slate-500">%</span>
              <span className="ml-2 text-[11px] text-slate-400">装填</span>
            </p>
            <p className="mt-1.5 text-[11px] text-slate-400">
              {overflowCount > 0
                ? `已溢出 ${overflowCount} 项`
                : remain > 0
                  ? `≈ 还能装 ${remain} 件简单事`
                  : '刚刚装满'}
            </p>
          </div>
        </div>

        <div className="relative">
          {overflowCount > 0 && (
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-3 py-1 rounded-full bg-amber-50 border border-amber-300 text-amber-700 shadow-sm">
              ⚠ 已溢出 · {overflowCount} 项装不下
            </div>
          )}
          <div
            role="img"
            aria-label="今日任务量筒"
            className="relative rounded-[22px] border-2 border-[#b7c5d4]/80 shadow-[0_2px_6px_rgba(71,85,105,0.08),0_18px_40px_-12px_rgba(71,85,105,0.18)]"
            style={{
              width: VW,
              height: VH,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(241,245,249,0.55))',
            }}
          >
            <div
              className="absolute inset-0 flex flex-col justify-end gap-[3px] p-[14px] overflow-hidden"
            >
              {domTopToBottom.map((l) => {
                const sel = selectedTodoId === l.todo.id
                return (
                  <div
                    key={l.todo.id}
                    onClick={() => onSelect(l.todo.id)}
                    onDoubleClick={onOpenNotes ? () => onOpenNotes(l.todo.id) : undefined}
                    title={`${l.todo.title}（${l.todo.complexity === 'hard' ? '难' : l.todo.complexity === 'medium' ? '中' : '简'}）`}
                    className={clsx(
                      'group relative flex items-center gap-2.5 px-4 rounded-[6px] cursor-pointer select-none flex-shrink-0',
                      'transition-[filter,box-shadow] duration-150',
                      'hover:brightness-[1.07] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)]',
                      sel && 'ring-2 ring-blue-400/90 z-10',
                    )}
                    style={{ height: l.h, ...l.style }}
                  >
                    {l.todo.importance === 'high' && (
                      <span className="absolute left-[5px] top-1/2 -translate-y-1/2 h-[58%] w-[3px] rounded-full bg-red-400/90" />
                    )}
                    <p className={clsx('flex-1 min-w-0 truncate text-[13px] font-medium tracking-wide', l.textCls)}>
                      {l.todo.title}
                    </p>
                    {l.todo.due_date === today && (
                      <span className={clsx('flex-shrink-0 text-[10px] leading-none px-1.5 py-[2px] rounded border', l.chipCls)}>
                        截止
                      </span>
                    )}
                  </div>
                )
              })}
              {sedimentH > 0 && (
                <div
                  className="relative rounded-[6px] flex items-center justify-center flex-shrink-0"
                  style={{
                    height: sedimentH,
                    backgroundImage: `${GRAIN}, linear-gradient(180deg, #a5d9bd 0%, #72bb96 100%)`,
                    backgroundSize: '9px 8px, auto',
                  }}
                >
                  <span className="text-[11px] font-medium text-emerald-950/75">
                    ✓ 今日完成 {todayDone.length}
                  </span>
                </div>
              )}
            </div>

            {/* 刻度画在内容之上：隔着玻璃读数 */}
            {[0.25, 0.5, 0.75, 1].map((f) => {
              const major = f === 0.5 || f === 1
              return (
                <div
                  key={f}
                  className="absolute right-0 flex items-center gap-[3px] pointer-events-none"
                  style={{ bottom: PAD + AVAIL * f - 3 }}
                >
                  <span className="h-px bg-[#7d92a8]/70" style={{ width: major ? 13 : 8 }} />
                  <span className="text-[8px] text-[#7d92a8] pr-1 font-medium">{f * 100}</span>
                </div>
              )
            })}

            <span className="absolute left-5 top-5 bottom-7 w-[7px] rounded-full bg-gradient-to-b from-white/80 via-white/35 to-white/5 pointer-events-none" />
            <span className="absolute right-7 top-9 bottom-12 w-[3px] rounded-full bg-white/25 pointer-events-none" />
            <span className="absolute -top-[9px] left-[9%] right-[9%] h-[10px] rounded-t-full bg-white/70 border-2 border-b-0 border-[#b7c5d4]/80" />
          </div>
          <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-[68%] h-5 bg-slate-400/20 blur-md rounded-[50%]" />
        </div>

        <div className="flex items-center gap-4 flex-wrap text-[11px] text-slate-500" style={{ width: VW }}>
          <span className="flex items-center gap-1.5">
            <i className="w-4 h-2.5 rounded-sm" style={{ backgroundImage: `${HATCH}, linear-gradient(180deg,#5d6f83,#46586e)` }} />
            板岩 · 难 {bottomUp.filter((l) => l.todo.complexity === 'hard').length}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="w-4 h-2.5 rounded-sm" style={{ backgroundImage: 'linear-gradient(180deg,#a3b4c6,#8ba0b5)' }} />
            灰岩 · 中 {bottomUp.filter((l) => l.todo.complexity === 'medium').length}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="w-4 h-2.5 rounded-sm" style={{ backgroundImage: `${GRAIN}, linear-gradient(180deg,#f0e4c4,#e2cf9f)`, backgroundSize: '8px 7px, auto' }} />
            沙 · 简 {bottomUp.filter((l) => l.todo.complexity === 'simple').length}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="w-4 h-2.5 rounded-sm" style={{ backgroundImage: `${GRAIN}, linear-gradient(180deg,#a5d9bd,#72bb96)`, backgroundSize: '9px 8px, auto' }} />
            沉积 · 已完成 {todayDone.length}
          </span>
        </div>
      </div>
    </div>
  )
}
