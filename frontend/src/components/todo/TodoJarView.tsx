import { useMemo } from 'react'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import type { Todo } from '../../types'
import { COMPLEXITY_LABELS, todayStr } from '../../utils/todoLogic'
import { TodoMiniCard } from './TodoMiniCard'

interface Props {
  todos: Todo[]
  selectedTodoId: string | null
  onSelect: (id: string) => void
}

const W = 260
const H = 470
const WALL_X0 = 56
const WALL_X1 = 208
const INNER_X0 = 62
const INNER_X1 = 202
const INNER_W = INNER_X1 - INNER_X0
const TOP_Y = 34
const BOTTOM_Y = 404
const ROCK_ROW_H = 70
const PEBBLE_ROW_H = 28
const SAND_UNIT_H = 40
const DONE_UNIT_H = 8
const DONE_MAX = 64

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface RockShape {
  w: number
  h: number
  rx: number
  rot: number
  fill: string
  stroke: string
}

const ROCK_VARIANTS: RockShape[] = [
  { w: 64, h: 56, rx: 19, rot: -4, fill: '#64748b', stroke: '#475569' },
  { w: 58, h: 60, rx: 16, rot: 5, fill: '#5d6b81', stroke: '#3f4c61' },
  { w: 68, h: 52, rx: 21, rot: -2, fill: '#718096', stroke: '#526071' },
  { w: 60, h: 58, rx: 17, rot: 6, fill: '#67758c', stroke: '#48556b' },
]

const PEBBLE_VARIANTS = [
  { fill: '#94a3b8', hi: '#c3d0e0' },
  { fill: '#8997ab', hi: '#b7c3d3' },
  { fill: '#a0adbd', hi: '#cfd9e4' },
]

interface Placed {
  todo: Todo
  x: number
  y: number
  w: number
  h: number
  rx: number
  ry: number
  rot: number
  fill: string
  stroke: string
  highlight: string | null
  pebble: boolean
}

function packRocks(items: Todo[], bottomY: number): { placed: Placed[]; topY: number } {
  const placed: Placed[] = []
  let shelf = bottomY
  let i = 0
  while (i < items.length) {
    const row = items.slice(i, i + 2)
    i += row.length
    const rowH = Math.max(...row.map((t) => ROCK_VARIANTS[hashStr(t.id) % ROCK_VARIANTS.length].h)) + 4
    row.forEach((t, j) => {
      const v = ROCK_VARIANTS[hashStr(t.id) % ROCK_VARIANTS.length]
      const slot = INNER_W / 2
      const x = INNER_X0 + slot * j + (slot - v.w) / 2
      placed.push({ todo: t, x: x + v.w / 2, y: shelf - v.h / 2, w: v.w, h: v.h, rx: v.rx, ry: 0, rot: v.rot, fill: v.fill, stroke: v.stroke, highlight: null, pebble: false })
    })
    shelf -= rowH
  }
  return { placed, topY: shelf }
}

function packPebbles(items: Todo[], bottomY: number): { placed: Placed[]; topY: number; topRow: { x: number }[] } {
  const placed: Placed[] = []
  let shelf = bottomY
  let i = 0
  let rowIdx = 0
  while (i < items.length) {
    const row = items.slice(i, i + 4)
    i += row.length
    row.forEach((t, j) => {
      const h = hashStr(t.id)
      const v = PEBBLE_VARIANTS[h % PEBBLE_VARIANTS.length]
      const rx = 13 + (h % 3)
      const ry = 10 + ((h >> 3) % 3)
      const slot = INNER_W / 4
      const off = (rowIdx % 2) * (slot / 2)
      const x = INNER_X0 + off + slot * j + (slot - rx * 2) / 2
      placed.push({ todo: t, x: x + rx, y: shelf - ry, w: rx * 2, h: ry * 2, rx, ry, rot: ((h >> 9) % 9) - 4, fill: v.fill, stroke: '#5f6f82', highlight: v.hi, pebble: true })
    })
    shelf -= PEBBLE_ROW_H
    rowIdx += 1
  }
  // 同行卵石 ry 各异（8/9/10），顶部 y=shelf-ry 各不相同；cy=y+ry=shelf 才是行不变量
  const minCy = placed.length ? Math.min(...placed.map((p) => p.y + p.ry)) : 0
  return { placed, topY: shelf, topRow: placed.filter((p) => p.y + p.ry === minCy).map((p) => ({ x: p.x })) }
}

function sandPath(topY: number, bottomY: number, topRow: { x: number }[]): string {
  if (topRow.length < 2) {
    return `M ${WALL_X0 + 4} ${topY} L ${WALL_X1 - 4} ${topY} L ${WALL_X1 - 4} ${bottomY} L ${WALL_X0 + 4} ${bottomY} Z`
  }
  const sorted = [...topRow].sort((a, b) => a.x - b.x)
  let d = `M ${WALL_X0 + 4} ${topY} L ${WALL_X1 - 4} ${topY} L ${WALL_X1 - 4} ${bottomY + 8}`
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    d += ` L ${Math.max(sorted[i].x, WALL_X0 + 10)} ${bottomY + 2}`
    if (i > 0) {
      const mid = (sorted[i].x + sorted[i - 1].x) / 2
      d += ` L ${mid} ${bottomY + 10}`
    }
  }
  d += ` L ${WALL_X0 + 4} ${bottomY + 8} Z`
  return d
}

function trickleDots(topRow: { x: number }[], bottomY: number, h: number): { x: number; y: number; r: number }[] {
  if (topRow.length < 2) return []
  const sorted = [...topRow].sort((a, b) => a.x - b.x)
  const dots: { x: number; y: number; r: number }[] = []
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const mid = (sorted[i].x + sorted[i + 1].x) / 2
    const base = bottomY + 8 + (h % 3) * 2
    dots.push({ x: mid - 4, y: base + 3, r: 2.4 })
    dots.push({ x: mid + 3, y: base + 8, r: 2 })
    dots.push({ x: mid + 1, y: base + 14, r: 1.6 })
  }
  return dots
}

export function TodoJarView({ todos, selectedTodoId, onSelect }: Props) {
  const today = todayStr()

  const { todayOpen, todayDone } = useMemo(() => {
    const open = todos.filter((t) =>
      t.status !== 'completed' && (t.due_date === today || t.planned_date === today))
    const done = todos.filter((t) => t.status === 'completed' && (t.completed_at ?? '').slice(0, 10) === today)
    return { todayOpen: open, todayDone: done }
  }, [todos, today])

  const rocks = useMemo(() => todayOpen.filter((t) => t.complexity === 'hard'), [todayOpen])
  const pebbles = useMemo(() => todayOpen.filter((t) => t.complexity === 'medium'), [todayOpen])
  const sand = useMemo(() => todayOpen.filter((t) => t.complexity === 'simple'), [todayOpen])

  const doneH = Math.min(todayDone.length * DONE_UNIT_H, DONE_MAX)
  const bottomY = BOTTOM_Y - doneH

  const rockPack = useMemo(() => packRocks(rocks, bottomY), [rocks, bottomY])
  const pebblePack = useMemo(() => packPebbles(pebbles, rockPack.topY), [pebbles, rockPack.topY])

  const packedTop = pebbles.length ? pebblePack.topY : rockPack.topY
  const sandBottom = packedTop + 4
  const sandTop = sandBottom - sand.length * SAND_UNIT_H
  const sandRow = pebbles.length ? pebblePack.topRow : []
  const sandPathD = sand.length ? sandPath(sandTop, sandBottom, sandRow) : ''
  const trickles = sand.length ? trickleDots(sandRow, sandBottom, hashStr(sand[0].id)) : []
  const overflow = sand.length > 0 ? sandTop < TOP_Y + 6 : packedTop < TOP_Y + 6

  const total = todayOpen.length
  const ratio = total ? Math.round((todayDone.length / (total + todayDone.length)) * 100) : 0

  if (total === 0 && todayDone.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-300">
        <svg width="72" height="96" viewBox="0 0 72 96" aria-hidden="true">
          <path d="M22 4 L50 4 L45 16 L45 78 Q45 88 36 88 Q27 88 27 78 L27 16 Z" fill="#e2e8f0" stroke="#cbd5e1" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M17 13 L55 13 L51 21 L21 21 Z" fill="#eef2f7" stroke="#cbd5e1" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M34 40 Q34 66 44 72" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.7" />
        </svg>
        <p className="text-sm">今天还没有安排</p>
        <p className="text-xs">先放一块大石头进去吧（截止/计划日设为今天）</p>
      </div>
    )
  }

  return (
    <div className="h-full flex gap-6 min-h-0 pb-4">
      <div className="flex-shrink-0 flex items-end justify-center" style={{ width: W }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="今日任务量筒">
          <defs>
            <pattern id="sand-dots" width="9" height="9" patternUnits="userSpaceOnUse">
              <rect width="9" height="9" fill="#f0e6c8" />
              <circle cx="2.5" cy="3.5" r="1.4" fill="#cfbc8a" />
              <circle cx="6.5" cy="7" r="1.1" fill="#c2ad7d" />
            </pattern>
            <linearGradient id="glass-shine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
              <stop offset="16%" stopColor="#ffffff" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            <clipPath id="jar-clip">
              <path d={`
                M ${WALL_X0 + 12} ${TOP_Y - 12}
                L ${WALL_X0} ${TOP_Y + 14}
                L ${WALL_X0} ${BOTTOM_Y - 16}
                Q ${WALL_X0} ${BOTTOM_Y} ${WALL_X0 + 16} ${BOTTOM_Y}
                L ${WALL_X1 - 16} ${BOTTOM_Y}
                Q ${WALL_X1} ${BOTTOM_Y} ${WALL_X1} ${BOTTOM_Y - 16}
                L ${WALL_X1} ${TOP_Y + 14}
                L ${WALL_X1 - 12} ${TOP_Y - 12}
              `} />
            </clipPath>
          </defs>

          <g clipPath="url(#jar-clip)">
            {doneH > 0 && (
              <g>
                <rect x={WALL_X0} y={BOTTOM_Y - doneH} width={WALL_X1 - WALL_X0} height={doneH} fill="#d7dee8" opacity="0.65" />
                <text x={(WALL_X0 + WALL_X1) / 2} y={BOTTOM_Y - 10} textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="600">
                  ✓ ×{todayDone.length}
                </text>
              </g>
            )}
            {sand.length > 0 && <path d={sandPathD} fill="url(#sand-dots)" />}
            {rockPack.placed.map((p) => (
              <g
                key={p.todo.id}
                transform={`rotate(${p.rot} ${p.x} ${p.y})`}
                className="cursor-pointer"
                onClick={() => onSelect(p.todo.id)}
              >
                <rect
                  x={p.x - p.w / 2}
                  y={p.y - p.h / 2}
                  width={p.w}
                  height={p.h}
                  rx={p.rx}
                  fill={p.fill}
                  stroke={p.todo.importance === 'high' ? '#ef4444' : p.stroke}
                  strokeWidth={p.todo.importance === 'high' ? 2.5 : 1}
                >
                  <title>{p.todo.title}（岩石 · {COMPLEXITY_LABELS[p.todo.complexity]}）</title>
                </rect>
                <rect
                  x={p.x - p.w / 2 + 6}
                  y={p.y - p.h / 2 + 5}
                  width={p.w - 12}
                  height={p.h * 0.32}
                  rx={p.rx * 0.7}
                  fill="#ffffff"
                  opacity="0.14"
                />
              </g>
            ))}
            {pebblePack.placed.map((p) => (
              <g
                key={p.todo.id}
                transform={`rotate(${p.rot} ${p.x} ${p.y})`}
                className="cursor-pointer"
                onClick={() => onSelect(p.todo.id)}
              >
                <ellipse
                  cx={p.x}
                  cy={p.y}
                  rx={p.rx}
                  ry={p.h / 2}
                  fill={p.fill}
                  stroke={p.todo.importance === 'high' ? '#ef4444' : p.stroke}
                  strokeWidth={p.todo.importance === 'high' ? 2 : 0.8}
                >
                  <title>{p.todo.title}（卵石 · {COMPLEXITY_LABELS[p.todo.complexity]}）</title>
                </ellipse>
                {p.highlight && (
                  <ellipse
                    cx={p.x}
                    cy={p.y - p.h * 0.18}
                    rx={p.rx * 0.62}
                    ry={p.h * 0.2}
                    fill={p.highlight}
                    opacity="0.5"
                  />
                )}
              </g>
            ))}
            {trickles.map((d, i) => (
              <circle key={`tk-${i}`} cx={d.x} cy={d.y} r={d.r} fill="#c2ad7d" />
            ))}
          </g>

          <path
            d={`
              M ${WALL_X0 + 12} ${TOP_Y - 12}
              L ${WALL_X0} ${TOP_Y + 14}
              L ${WALL_X0} ${BOTTOM_Y - 16}
              Q ${WALL_X0} ${BOTTOM_Y} ${WALL_X0 + 16} ${BOTTOM_Y}
              L ${WALL_X1 - 16} ${BOTTOM_Y}
              Q ${WALL_X1} ${BOTTOM_Y} ${WALL_X1} ${BOTTOM_Y - 16}
              L ${WALL_X1} ${TOP_Y + 14}
              L ${WALL_X1 - 12} ${TOP_Y - 12}
            `}
            fill="url(#glass-shine)"
            stroke="#9aa7b8"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <line x1={WALL_X0 + 5} y1={TOP_Y + 32} x2={WALL_X0 + 5} y2={BOTTOM_Y - 32} stroke="#ffffff" strokeWidth="4" opacity="0.5" strokeLinecap="round" />
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={WALL_X1 - 9}
              y1={TOP_Y + (BOTTOM_Y - TOP_Y) * f}
              x2={WALL_X1 - 2}
              y2={TOP_Y + (BOTTOM_Y - TOP_Y) * f}
              stroke="#c3ccd9"
              strokeWidth="2"
            />
          ))}

          {overflow && (
            <g>
              <circle cx={(WALL_X0 + WALL_X1) / 2} cy={TOP_Y - 26} r="7" fill="#ef4444" />
              <text x={(WALL_X0 + WALL_X1) / 2 + 14} y={TOP_Y - 22} fontSize="11" fill="#ef4444" fontWeight="600">
                今天的量已经溢出
              </text>
            </g>
          )}
        </svg>
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 gap-3">
        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap flex-shrink-0">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#64748b] border border-[#475569] inline-block" /> 岩石（困难）×{rocks.length}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#94a3b8] inline-block" /> 卵石（中等）×{pebbles.length}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-[#e3d3a4] border border-[#cfbc8a] inline-block" /> 沙子（简单）×{sand.length}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded border-2 border-red-500 inline-block" /> 红框 = 高重要</span>
          <span className="flex items-center gap-1 text-emerald-600"><Check size={12} /> 今日完成 {todayDone.length}（{ratio}%）</span>
        </div>

        <div className="text-xs text-gray-400 flex-shrink-0">先装大石头，再放卵石，最后填沙子 —— 大块工作要优先占位。</div>

        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 min-h-0">
          {([['hard', rocks, '岩石'], ['medium', pebbles, '卵石'], ['simple', sand, '沙子']] as const).map(([key, items, label]) =>
            items.length > 0 && (
              <div key={key}>
                <div className="text-xs font-medium text-gray-500 mb-1.5">{label} · {COMPLEXITY_LABELS[key]}（{items.length}）</div>
                <div className="flex flex-col gap-1.5">
                  {items.map((t) => (
                    <TodoMiniCard
                      key={t.id}
                      todo={t}
                      selected={selectedTodoId === t.id}
                      sub={t.due_date === today ? '今天截止' : '计划今天'}
                      onClick={() => onSelect(t.id)}
                    />
                  ))}
                </div>
              </div>
            ),
          )}
          {todayDone.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-400 mb-1.5">今日已完成（{todayDone.length}）</div>
              <div className={clsx('flex flex-col gap-1.5 opacity-60')}>
                {todayDone.map((t) => (
                  <TodoMiniCard key={t.id} todo={t} selected={selectedTodoId === t.id} onClick={() => onSelect(t.id)} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}