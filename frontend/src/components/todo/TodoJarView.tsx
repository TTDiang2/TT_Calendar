import { useMemo } from 'react'
import clsx from 'clsx'
import type { Todo } from '../../types'
import { todayStr } from '../../utils/todoLogic'

interface Props {
  todos: Todo[]
  selectedTodoId: string | null
  onSelect: (id: string) => void
  onOpenNotes?: (id: string) => void
}

const BODY_W = 380
const BODY_H = 440
const INNER_W = 340
const AVAIL = BODY_H - 26

const HARD_ROW = 2
const MED_ROW = 3
const SIMPLE_ROW = 3

const WEEKDAY = '日一二三四五六'

const BLOBS = [
  '58% 42% 55% 45% / 52% 60% 40% 48%',
  '46% 54% 48% 52% / 58% 44% 56% 42%',
  '52% 48% 60% 40% / 46% 54% 46% 54%',
]

// 三档明度 [亮面, 基色, 暗面]，左上光源；硬层深色配奶白字（对比 ≥5:1），中/浅层配深咖字
const TONES = {
  hard: [
    ['#c98a6d', '#9d6045', '#7f4c34'],
    ['#9db284', '#75905a', '#5c7042'],
    ['#c98f8f', '#a35f5f', '#7f4a4a'],
    ['#d1a45e', '#aa7c33', '#87632a'],
  ],
  medium: [
    ['#f0cdb9', '#e0af94', '#c68d70'],
    ['#dce8c6', '#c8d8ae', '#a9bd8b'],
    ['#f0caca', '#e2b0b0', '#c68e8e'],
    ['#f0d9a3', '#e4c483', '#c5a25f'],
  ],
  simple: [
    ['#f6e2d0', '#f0d3b8', '#ddb994'],
    ['#edf2de', '#e2ebd3', '#c9d7ac'],
    ['#f4dede', '#eccccc', '#d8a8a8'],
    ['#f6e9cc', '#f0dfb4', '#dcc388'],
  ],
} as const

const TEXT_DARK = 'text-[#453122]'
const TEXT_CREAM = 'text-[#fdf6ea]'

type Cx = 'hard' | 'medium' | 'simple'

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface Pebble {
  todo: Todo
  cx: Cx
  x: number
  bottom: number
  w: number
  h: number
  rot: number
  bg: string
  blob: string
}

function packRow(items: Todo[], cx: Cx, perRow: number, baseH: number, wGap: number, startBottom: number, nestle: number) {
  const placed: Pebble[] = []
  let cursor = startBottom
  let i = 0
  while (i < items.length) {
    const row = items.slice(i, i + perRow)
    i += row.length
    const hs = row.map((t) => baseH + (hashStr(t.id) % 5) - 2)
    let rowMax = 0
    row.forEach((t, j) => {
      const h = hashStr(t.id)
      const tone = TONES[cx][h % TONES[cx].length]
      const slot = INNER_W / perRow
      const w = slot - wGap
      const jitterX = ((h >> 5) % 9) - 4
      const x = slot * j + slot / 2 + jitterX
      const rot = ((h >> 9) % 11) - 5
      placed.push({
        todo: t, cx, x, bottom: cursor + ((h >> 12) % 3), w,
        h: hs[j], rot,
        bg: `radial-gradient(120% 120% at 30% 25%, ${tone[0]} 0%, ${tone[1]} 48%, ${tone[2]} 100%)`,
        blob: BLOBS[h % BLOBS.length],
      })
      rowMax = Math.max(rowMax, hs[j])
    })
    cursor += rowMax - nestle
  }
  return { placed, top: cursor }
}

export function TodoJarView({ todos, selectedTodoId, onSelect, onOpenNotes }: Props) {
  const today = todayStr()

  const { todayOpen, todayDone } = useMemo(() => {
    const open = todos.filter((t) =>
      t.status !== 'completed' && (t.due_date === today || t.planned_date === today))
    const done = todos.filter((t) => t.status === 'completed' && (t.completed_at ?? '').slice(0, 10) === today)
    return { todayOpen: open, todayDone: done }
  }, [todos, today])

  const rocks = useMemo(() => todayOpen.filter((t) => t.complexity === 'hard'), [todayOpen])
  const mediums = useMemo(() => todayOpen.filter((t) => t.complexity === 'medium'), [todayOpen])
  const simples = useMemo(() => todayOpen.filter((t) => t.complexity === 'simple'), [todayOpen])

  const sandH = todayDone.length ? Math.min(20 + todayDone.length * 6, 88) : 0
  const hardPack = useMemo(() => packRow(rocks, 'hard', HARD_ROW, 54, 16, sandH, 7), [rocks, sandH])
  const medPack = useMemo(() => packRow(mediums, 'medium', MED_ROW, 38, 12, hardPack.top, 6), [mediums, hardPack.top])
  const simplePack = useMemo(() => packRow(simples, 'simple', SIMPLE_ROW, 27, 12, medPack.top, 5), [simples, medPack.top])

  const all = useMemo(
    () => [...hardPack.placed, ...medPack.placed, ...simplePack.placed]
      .filter((p) => p.bottom + p.h <= BODY_H - 10),
    [hardPack, medPack, simplePack],
  )
  const used = simplePack.top
  const overflowCount = useMemo(() => {
    const excess = used - AVAIL
    if (excess <= 0) return 0
    let acc = 0
    let n = 0
    for (const p of [...all].sort((a, b) => b.bottom - a.bottom)) {
      if (acc > excess) break
      acc += p.h - 7
      n += 1
    }
    return n
  }, [used, all])

  const dateStr = useMemo(() => {
    const d = new Date()
    return `${d.getMonth() + 1}月${d.getDate()}日 · 周${WEEKDAY[d.getDay()]}`
  }, [])

  if (todayOpen.length === 0 && todayDone.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-[#faf6ef] text-[#8a7455]">
        <svg width="64" height="88" viewBox="0 0 72 96" aria-hidden="true">
          <path d="M22 4 L50 4 L45 16 L45 78 Q45 88 36 88 Q27 88 27 78 L27 16 Z" fill="#f3ead9" stroke="#d5c9b6" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M17 13 L55 13 L51 21 L21 21 Z" fill="#f8f1e4" stroke="#d5c9b6" strokeWidth="2.5" strokeLinejoin="round" />
          <line x1="34" y1="42" x2="34" y2="72" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.8" />
        </svg>
        <p className="text-sm text-[#6b5a44]">今天还没有安排</p>
        <p className="text-xs">先放一块大石头进去吧（截止/计划日设为今天）</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-[#faf6ef]">
      <div className="min-h-full flex flex-col items-center justify-center gap-4 py-8 px-4"
        style={{ backgroundImage: 'radial-gradient(600px 420px at 50% 38%, #fdf9f0 0%, #faf6ef 70%)' }}>

        <div className="flex items-end justify-between" style={{ width: BODY_W }}>
          <div>
            <p className="text-[10px] tracking-[0.25em] font-medium text-[#a08a68]">今日拾贝</p>
            <p className="text-[15px] font-semibold text-[#57503f] leading-tight mt-0.5">{dateStr}</p>
          </div>
          <p className="text-xs text-[#7a6a55]">
            装了 <span className="font-semibold text-[#57503f] tabular-nums">{todayOpen.length}</span> 件
            <span className="mx-1.5 text-[#c9bda6]">·</span>
            沉底 <span className="font-semibold text-[#57503f] tabular-nums">{todayDone.length}</span> 件
          </p>
        </div>

        <div className="relative">
          {overflowCount > 0 && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20 whitespace-nowrap text-[11px] font-medium px-3 py-1 rounded-full bg-[#fbf0da] border border-[#e3cba0] text-[#8a6420] shadow-sm">
              罐子满了 · {overflowCount} 件放不下
            </div>
          )}

          <div className="relative mx-auto" style={{ width: 300 }}>
            <div className="h-[18px] rounded-[9px] border border-[#b99b6f]/60"
              style={{ background: 'linear-gradient(180deg, #ddc49e 0%, #c8a87a 100%)' }} />
            <div className="mx-auto h-[26px] border-x-2 border-t border-[#d5c9b6]"
              style={{ width: 296, background: 'linear-gradient(180deg, rgba(255,252,246,0.9), rgba(250,244,235,0.8))' }} />
          </div>

          <div
            role="img"
            aria-label="今日任务玻璃罐"
            className="relative mx-auto overflow-hidden border-2 border-[#d5c9b6]"
            style={{
              width: BODY_W,
              height: BODY_H,
              borderRadius: '44px 44px 70px 70px / 30px 30px 90px 90px',
              background: 'linear-gradient(175deg, rgba(255,253,248,0.95) 0%, rgba(250,243,232,0.88) 60%, rgba(246,236,220,0.9) 100%)',
              boxShadow: 'inset 0 -16px 26px -18px rgba(120,90,50,0.4), 0 3px 6px rgba(140,110,70,0.1), 0 22px 44px -16px rgba(140,110,70,0.28)',
            }}
          >
            {all.map((p) => {
              const sel = selectedTodoId === p.todo.id
              return (
                <div
                  key={p.todo.id}
                  onClick={() => onSelect(p.todo.id)}
                  onDoubleClick={onOpenNotes ? () => onOpenNotes(p.todo.id) : undefined}
                  title={p.todo.title}
                  style={{
                    left: p.x - p.w / 2,
                    bottom: p.bottom,
                    width: p.w,
                    height: p.h,
                    borderRadius: p.blob,
                    background: p.bg,
                    transform: `rotate(${p.rot}deg)`,
                    boxShadow: 'inset 0 -7px 10px -7px rgba(90,60,30,0.4), 0 2px 4px rgba(120,90,50,0.22)',
                  }}
                  className={clsx(
                    'absolute flex items-center justify-center px-2.5 cursor-pointer select-none',
                    'transition-[filter,transform] duration-200',
                    'hover:brightness-105 hover:-translate-y-[2px]',
                    sel && 'ring-2 ring-[#a3763d]/80 z-10 brightness-105',
                  )}
                >
                  {p.todo.importance === 'high' && (
                    <span className="absolute -top-1 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#c2543d] ring-2 ring-[#fdf8f0]/80" />
                  )}
                  <p className={clsx(
                    'text-[12px] font-medium truncate w-full text-center leading-tight',
                    p.cx === 'hard' ? TEXT_CREAM : TEXT_DARK,
                  )} style={p.cx === 'hard' ? { textShadow: '0 1px 1px rgba(60,30,10,0.3)' } : undefined}>
                    <span className={clsx(p.todo.due_date === today && 'underline decoration-[#c2543d]/60 decoration-wavy decoration-2 underline-offset-[3px]')}>
                      {p.todo.title}
                    </span>
                  </p>
                </div>
              )
            })}

            {sandH > 0 && (
              <div
                className="absolute left-3 right-3 bottom-2 rounded-[10px] flex items-center justify-center"
                style={{
                  height: sandH,
                  background: 'radial-gradient(rgba(160,125,60,0.25) 1px, transparent 1.3px), linear-gradient(180deg, #f2e5c8 0%, #e9d7ae 100%)',
                  backgroundSize: '8px 7px, auto',
                }}
              >
                <span className="text-[11px] font-medium text-[#8a6d3b]">沉底 · 今日完成 {todayDone.length}</span>
              </div>
            )}

            <span className="absolute left-7 top-8 bottom-12 w-[9px] rounded-full pointer-events-none"
              style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.25) 70%, rgba(255,255,255,0.05))', transform: 'rotate(3deg)' }} />
            <span className="absolute right-8 top-10 bottom-16 w-[4px] rounded-full bg-white/40 pointer-events-none"
              style={{ transform: 'rotate(-3deg)' }} />
            <span className="absolute inset-y-0 right-0 w-10 pointer-events-none"
              style={{ background: 'linear-gradient(270deg, rgba(190,160,115,0.14), transparent)' }} />
            <span className="absolute -top-[11px] left-1/2 -translate-x-1/2 w-[302px] h-[22px] rounded-[50%] border-2 border-[#d5c9b6] pointer-events-none"
              style={{ background: 'linear-gradient(180deg, rgba(255,252,246,0.95), rgba(240,230,214,0.5))' }} />
          </div>

          <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-[64%] h-5 bg-[#b09877]/25 blur-md rounded-[50%]" />
        </div>

        <div className="flex items-center gap-3.5 flex-wrap text-[11px] text-[#7a6a55]" style={{ width: BODY_W }}>
          {([['磐石 · 难', TONES.hard[0], rocks.length], ['卵石 · 中', TONES.medium[0], mediums.length], ['沙粒 · 简', TONES.simple[0], simples.length]] as const).map(([label, tone, n]) => (
            <span key={label} className="flex items-center gap-1.5">
              <i className="w-4 h-3 rounded-[40%_60%_55%_45%/55%_45%_60%_40%]"
                style={{ background: `radial-gradient(120% 120% at 30% 25%, ${tone[0]}, ${tone[1]} 55%, ${tone[2]})`, boxShadow: 'inset 0 -2px 3px -2px rgba(90,60,30,0.4)' }} />
              {label} {n}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[#8a6d3b]">
            <i className="w-4 h-3 rounded-[4px]"
              style={{ background: 'radial-gradient(rgba(160,125,60,0.25) 1px, transparent 1.3px), linear-gradient(180deg,#f2e5c8,#e9d7ae)', backgroundSize: '6px 5px, auto' }} />
            沉底 {todayDone.length}
          </span>
          <span className="ml-auto text-[#a08a68]">大石头先进，沙子填缝。</span>
        </div>
      </div>
    </div>
  )
}
