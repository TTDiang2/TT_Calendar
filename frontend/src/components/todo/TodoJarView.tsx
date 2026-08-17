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
const WALL_X0 = 52
const WALL_X1 = 212
const INNER_X0 = 60
const INNER_X1 = 204
const INNER_W = INNER_X1 - INNER_X0
const TOP_Y = 34
const BOTTOM_Y = 404

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
}

const ROCK_VARIANTS: RockShape[] = [
  { w: 56, h: 46, rx: 17, rot: -5, fill: '#94a3b8' },
  { w: 50, h: 52, rx: 14, rot: 4, fill: '#8b98a8' },
  { w: 60, h: 42, rx: 19, rot: -2, fill: '#a3aebc' },
  { w: 54, h: 48, rx: 15, rot: 7, fill: '#97a4b4' },
]

const PEBBLE_FILLS = ['#c3cbd8', '#b8c2d0', '#ccd4df']

interface Placed {
  todo: Todo
  x: number
  y: number
  w: number
  h: number
  rx: number
  rot: number
  fill: string
  pebble: boolean
}

function placeRocks(items: Todo[], bottomY: number): { placed: Placed[]; topY: number } {
  const placed: Placed[] = []
  let y = bottomY
  let i = 0
  while (i < items.length) {
    const rowH = Math.max(...items.slice(i, i + 2).map((t) => ROCK_VARIANTS[hashStr(t.id) % ROCK_VARIANTS.length].h)) + 6
    y -= rowH
    const perRow = 2
    for (let j = 0; j < perRow && i < items.length; j += 1, i += 1) {
      const t = items[i]
      const v = ROCK_VARIANTS[hashStr(t.id) % ROCK_VARIANTS.length]
      const jitter = ((hashStr(t.id) >> 5) % 14) - 7
      const x = INNER_X0 + 8 + j * (INNER_W / 2) + jitter + (INNER_W / 2 - v.w - 8) / 2
      placed.push({ todo: t, x: x + v.w / 2, y: y + v.h / 2, w: v.w, h: v.h, rx: v.rx, rot: v.rot, fill: v.fill, pebble: false })
    }
  }
  return { placed, topY: y }
}

function placePebbles(items: Todo[], bottomY: number): { placed: Placed[]; topY: number } {
  const placed: Placed[] = []
  let y = bottomY
  let i = 0
  while (i < items.length) {
    y -= 26
    const perRow = 4
    for (let j = 0; j < perRow && i < items.length; j += 1, i += 1) {
      const t = items[i]
      const h = hashStr(t.id)
      const rx = 15 + (h % 4)
      const ry = 11 + ((h >> 3) % 3)
      const jitter = ((h >> 6) % 12) - 6
      const x = INNER_X0 + 10 + j * (INNER_W / 4) + jitter + (INNER_W / 4 - rx * 2) / 2
      placed.push({ todo: t, x: x + rx, y: y + ry, w: rx * 2, h: ry * 2, rx, rot: ((h >> 9) % 14) - 7, fill: PEBBLE_FILLS[h % PEBBLE_FILLS.length], pebble: true })
    }
  }
  return { placed, topY: y }
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

  const doneH = Math.min(todayDone.length * 7, 64)
  const { placed: rockPlaced, topY: rockTop } = useMemo(
    () => placeRocks(rocks, BOTTOM_Y - doneH), [rocks, doneH])
  const { placed: pebblePlaced, topY: pebbleTop } = useMemo(
    () => placePebbles(pebbles, rockTop), [pebbles, rockTop])
  const sandH = Math.min(sand.length * 5, 70)
  const sandTop = pebbleTop - sandH
  const overflow = sandTop < TOP_Y + 8

  const total = todayOpen.length
  const ratio = total ? Math.round((todayDone.length / (total + todayDone.length)) * 100) : 0

  if (total === 0 && todayDone.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-300">
        <div className="text-4xl">🫙</div>
        <p className="text-sm">今天还没有安排</p>
        <p className="text-xs">先放一块大石头进去吧（截止/计划日设为今天）</p>
      </div>
    )
  }

  return (
    <div className="h-full flex gap-6 min-h-0 pb-4">
      <div className="flex-shrink-0 flex items-end justify-center" style={{ width: W }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <pattern id="sand-dots" width="8" height="8" patternUnits="userSpaceOnUse">
              <rect width="8" height="8" fill="#e8dcbf" />
              <circle cx="2" cy="3" r="1.1" fill="#cdbd94" />
              <circle cx="6" cy="6.5" r="0.9" fill="#d8c9a4" />
            </pattern>
            <linearGradient id="glass-shine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
              <stop offset="18%" stopColor="#ffffff" stopOpacity="0.05" />
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
                <rect x={WALL_X0} y={BOTTOM_Y - doneH} width={WALL_X1 - WALL_X0} height={doneH} fill="#cbd5e1" opacity="0.55" />
                <text x={(WALL_X0 + WALL_X1) / 2} y={BOTTOM_Y - 10} textAnchor="middle" fontSize="10" fill="#64748b">
                  ✓ ×{todayDone.length}
                </text>
              </g>
            )}
            {sandH > 0 && (
              <g>
                <rect x={WALL_X0} y={BOTTOM_Y - doneH - sandH} width={WALL_X1 - WALL_X0} height={sandH} fill="url(#sand-dots)" />
                <text x={(WALL_X0 + WALL_X1) / 2} y={BOTTOM_Y - doneH - sandH / 2 + 3} textAnchor="middle" fontSize="9" fill="#a16207">
                  沙子 ×{sand.length}
                </text>
              </g>
            )}
            {pebblePlaced.map((p) => (
              <ellipse
                key={p.todo.id}
                cx={p.x}
                cy={p.y}
                rx={p.rx}
                ry={p.h / 2}
                transform={`rotate(${p.rot} ${p.x} ${p.y})`}
                fill={p.fill}
                stroke={p.todo.importance === 'high' ? '#ef4444' : 'none'}
                strokeWidth={p.todo.importance === 'high' ? 2 : 0}
                className="cursor-pointer"
                onClick={() => onSelect(p.todo.id)}
              >
                <title>{p.todo.title}（卵石 · {COMPLEXITY_LABELS[p.todo.complexity]}）</title>
              </ellipse>
            ))}
            {rockPlaced.map((p) => (
              <rect
                key={p.todo.id}
                x={p.x - p.w / 2}
                y={p.y - p.h / 2}
                width={p.w}
                height={p.h}
                rx={p.rx}
                transform={`rotate(${p.rot} ${p.x} ${p.y})`}
                fill={p.fill}
                stroke={p.todo.importance === 'high' ? '#ef4444' : '#7d8b9d'}
                strokeWidth={p.todo.importance === 'high' ? 2.5 : 1}
                className="cursor-pointer"
                onClick={() => onSelect(p.todo.id)}
              >
                <title>{p.todo.title}（岩石 · {COMPLEXITY_LABELS[p.todo.complexity]}）</title>
              </rect>
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
            stroke="#9ca3af"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <line x1={WALL_X0 + 4} y1={TOP_Y + 30} x2={WALL_X0 + 4} y2={BOTTOM_Y - 30} stroke="#ffffff" strokeWidth="4" opacity="0.5" strokeLinecap="round" />
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={WALL_X1 - 8}
              y1={TOP_Y + (BOTTOM_Y - TOP_Y) * f}
              x2={WALL_X1 - 1}
              y2={TOP_Y + (BOTTOM_Y - TOP_Y) * f}
              stroke="#cbd5e1"
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
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-400 inline-block" /> 岩石（困难）×{rocks.length}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-300 inline-block" /> 卵石（中等）×{pebbles.length}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-[#e8dcbf] border border-[#cdbd94] inline-block" /> 沙子（简单）×{sand.length}</span>
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
