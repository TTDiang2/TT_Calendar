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

// 系统彩色 emoji 字体链：WebView2/Chromium 会用第一个含该字形的字体渲染 🪨
const EMOJI_FONT = "'Segoe UI Emoji', 'Noto Color Emoji', 'Apple Color Emoji', sans-serif"

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface Placed {
  todo: Todo
  x: number
  y: number
  w: number
  h: number
  font: number
  rot: number
  pebble: boolean
}

// 岩石占位高度档位：决定行高（保持原 58-68 档 → 行高 70 不变，容量校准不动）
const ROCK_FOOTPRINT = [64, 58, 68, 60]

function packRocks(items: Todo[], bottomY: number): { placed: Placed[]; topY: number } {
  const placed: Placed[] = []
  let shelf = bottomY
  let i = 0
  while (i < items.length) {
    const row = items.slice(i, i + 2)
    i += row.length
    const rowH = Math.max(...row.map((t) => ROCK_FOOTPRINT[hashStr(t.id) % ROCK_FOOTPRINT.length])) + 4
    row.forEach((t, j) => {
      const h = ROCK_FOOTPRINT[hashStr(t.id) % ROCK_FOOTPRINT.length]
      // emoji 字号≈占位高 0.62：字形留出呼吸感又不显稀疏
      const font = Math.round(h * 0.62)
      const slot = INNER_W / 2
      const x = INNER_X0 + slot * j + slot / 2
      placed.push({
        todo: t, x, y: shelf - h / 2, w: font + 8, h,
        font, rot: (hashStr(t.id) % 25) - 12, pebble: false,
      })
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
      const font = 14 + (h % 4)
      const slot = INNER_W / 4
      const off = (rowIdx % 2) * (slot / 2)
      const x = INNER_X0 + off + slot * j + slot / 2
      placed.push({
        todo: t, x, y: shelf - font / 2, w: font + 4, h: font,
        font, rot: ((h >> 9) % 17) - 8, pebble: true,
      })
    })
    shelf -= PEBBLE_ROW_H
    rowIdx += 1
  }
  // 同行字号各异时顶部 y 不同；y+h/2=shelf 才是行不变量（沙面波纹依赖此判定）
  const minCy = placed.length ? Math.min(...placed.map((p) => p.y + p.h / 2)) : 0
  return { placed, topY: shelf, topRow: placed.filter((p) => p.y + p.h / 2 === minCy).map((p) => ({ x: p.x })) }
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

// 沙面上的散落颗粒：波谷上方几粒松动沙子，让沙层边界不那么「几何」
function looseGrains(sandTop: number, seed: number): { x: number; y: number; r: number; o: number }[] {
  const grains: { x: number; y: number; r: number; o: number }[] = []
  for (let i = 0; i < 4; i += 1) {
    const h = hashStr(`${seed}-${i}`)
    grains.push({
      x: INNER_X0 + 10 + (h % (INNER_W - 20)),
      y: sandTop - 3 - ((h >> 4) % 7),
      r: 1.2 + ((h >> 8) % 2),
      o: 0.5 + ((h >> 12) % 4) / 10,
    })
  }
  return grains
}

const JAR_OUTLINE = `
  M ${WALL_X0 + 12} ${TOP_Y - 12}
  L ${WALL_X0} ${TOP_Y + 14}
  L ${WALL_X0} ${BOTTOM_Y - 16}
  Q ${WALL_X0} ${BOTTOM_Y} ${WALL_X0 + 16} ${BOTTOM_Y}
  L ${WALL_X1 - 16} ${BOTTOM_Y}
  Q ${WALL_X1} ${BOTTOM_Y} ${WALL_X1} ${BOTTOM_Y - 16}
  L ${WALL_X1} ${TOP_Y + 14}
  L ${WALL_X1 - 12} ${TOP_Y - 12}
`

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
  const grains = sand.length ? looseGrains(sandTop, hashStr(sand[0].id)) : []
  const overflow = sand.length > 0 ? sandTop < TOP_Y + 6 : packedTop < TOP_Y + 6

  const total = todayOpen.length
  const ratio = total ? Math.round((todayDone.length / (total + todayDone.length)) * 100) : 0

  if (total === 0 && todayDone.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-300">
        <svg width="72" height="96" viewBox="0 0 72 96" aria-hidden="true">
          <path d="M22 4 L50 4 L45 16 L45 78 Q45 88 36 88 Q27 88 27 78 L27 16 Z" fill="#e8eef5" stroke="#b9c6d4" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M17 13 L55 13 L51 21 L21 21 Z" fill="#f2f6fa" stroke="#b9c6d4" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M34 40 Q34 66 44 72" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.75" />
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
            {/* 沙粒质感：分形噪声→暖沙色矩阵，RGBA 各通道重映射产生颗粒明暗 */}
            <filter id="sand-grain" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" result="n" />
              <feColorMatrix
                in="n"
                type="matrix"
                values="0 0 0 0 0.895  0 0 0 0 0.802  0 0 0 0 0.578  0.85 0.35 0 0 0.5"
              />
            </filter>
            {/* 石块落影：高斯模糊椭圆，给 emoji 石头一个「放在那儿」的重量感 */}
            <filter id="stone-shadow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.6" />
            </filter>
            {/* 玻璃体：横向渐变模拟圆筒曲率（两侧折射强、中间透） */}
            <linearGradient id="glass-body" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#dde6f0" stopOpacity="0.5" />
              <stop offset="12%" stopColor="#f4f8fc" stopOpacity="0.3" />
              <stop offset="38%" stopColor="#e6edf4" stopOpacity="0.1" />
              <stop offset="80%" stopColor="#d3dde8" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#c6d3e0" stopOpacity="0.45" />
            </linearGradient>
            {/* 高光条：左内侧长条镜面反光 */}
            <linearGradient id="glass-shine" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.75" />
              <stop offset="55%" stopColor="#ffffff" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.1" />
            </linearGradient>
            {/* 沉底完成带：从上浅到下深的祖母绿渐变，像沉积物 */}
            <linearGradient id="done-sediment" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6ee7b7" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.85" />
            </linearGradient>
            <clipPath id="jar-clip">
              <path d={JAR_OUTLINE} />
            </clipPath>
          </defs>

          {/* 玻璃底色：先铺一层体感，再装内容 */}
          <path d={JAR_OUTLINE} fill="url(#glass-body)" />

          <g clipPath="url(#jar-clip)">
            {doneH > 0 && (
              <g>
                <rect x={WALL_X0} y={BOTTOM_Y - doneH} width={WALL_X1 - WALL_X0} height={doneH} fill="url(#done-sediment)" />
                {/* 沉积层上缘：略深的界线强化「沉底」层次 */}
                <line x1={WALL_X0} y1={BOTTOM_Y - doneH} x2={WALL_X1} y2={BOTTOM_Y - doneH} stroke="#34d399" strokeWidth="2" opacity="0.9" />
                <text x={(WALL_X0 + WALL_X1) / 2} y={BOTTOM_Y - Math.max(doneH / 2, 12)} textAnchor="middle" fontSize="11" fill="#ffffff" fontWeight="700">
                  ✓ ×{todayDone.length}
                </text>
              </g>
            )}

            {sand.length > 0 && (
              <g>
                {/* 沙层基底：纯色打底保证全覆盖，噪声层只做颗粒 */}
                <path d={sandPathD} fill="#e9d8ab" />
                <path d={sandPathD} fill="#d9c188" opacity="0.35" transform={`translate(0 1.5)`} />
                {/* 噪声颗粒层：与沙形状同 d，直接把 filter 打在 path 上 */}
                <path d={sandPathD} filter="url(#sand-grain)" opacity="0.8" />
                {grains.map((g, i) => (
                  <circle key={`gr-${i}`} cx={g.x} cy={g.y} r={g.r} fill="#cbb37f" opacity={g.o} />
                ))}
              </g>
            )}

            {rockPack.placed.map((p) => {
              const sel = selectedTodoId === p.todo.id
              const high = p.todo.importance === 'high'
              return (
                <g
                  key={p.todo.id}
                  transform={`rotate(${p.rot} ${p.x} ${p.y})`}
                  className="cursor-pointer"
                  onClick={() => onSelect(p.todo.id)}
                >
                  <ellipse cx={p.x} cy={p.y + p.font * 0.46} rx={p.font * 0.34} ry="4" fill="#8fa0b3" opacity="0.4" filter="url(#stone-shadow)" />
                  {sel && (
                    <rect x={p.x - p.w / 2 - 3} y={p.y - p.w / 2 - 3} width={p.w + 6} height={p.w + 6} rx="14"
                      fill="none" stroke="#3b82f6" strokeWidth="2.5" />
                  )}
                  {high && (
                    <rect x={p.x - p.w / 2} y={p.y - p.w / 2} width={p.w} height={p.w} rx="12"
                      fill="none" stroke="#ef4444" strokeWidth="2" />
                  )}
                  <text
                    x={p.x}
                    y={p.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={p.font}
                    fontFamily={EMOJI_FONT}
                  >
                    🪨
                    <title>{p.todo.title}（岩石 · {COMPLEXITY_LABELS[p.todo.complexity]}）</title>
                  </text>
                </g>
              )
            })}

            {pebblePack.placed.map((p) => {
              const sel = selectedTodoId === p.todo.id
              const high = p.todo.importance === 'high'
              const r = p.font * 0.62
              return (
                <g
                  key={p.todo.id}
                  transform={`rotate(${p.rot} ${p.x} ${p.y})`}
                  className="cursor-pointer"
                  onClick={() => onSelect(p.todo.id)}
                >
                  <ellipse cx={p.x} cy={p.y + p.font * 0.48} rx={r * 0.8} ry="2.2" fill="#8fa0b3" opacity="0.35" filter="url(#stone-shadow)" />
                  {sel && <circle cx={p.x} cy={p.y} r={r + 3} fill="none" stroke="#3b82f6" strokeWidth="2" />}
                  {high && <circle cx={p.x} cy={p.y} r={r} fill="none" stroke="#ef4444" strokeWidth="1.6" />}
                  <text
                    x={p.x}
                    y={p.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={p.font}
                    fontFamily={EMOJI_FONT}
                  >
                    🪨
                    <title>{p.todo.title}（卵石 · {COMPLEXITY_LABELS[p.todo.complexity]}）</title>
                  </text>
                </g>
              )
            })}
          </g>

          {/* 玻璃轮廓 + 嘴沿 + 高光 + 刻度（画在内容之上，形成「隔着玻璃看」） */}
          <path d={JAR_OUTLINE} fill="url(#glass-shine)" stroke="#93a5ba" strokeWidth="2.5" strokeLinejoin="round" opacity="0.9" />
          {/* 杯嘴：上口一圈加厚的唇边 */}
          <path
            d={`M ${WALL_X0 - 4} ${TOP_Y + 12} L ${WALL_X0 + 10} ${TOP_Y - 14} L ${WALL_X1 - 10} ${TOP_Y - 14} L ${WALL_X1 + 4} ${TOP_Y + 12} Z`}
            fill="#edf2f8"
            stroke="#93a5ba"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          {/* 左内侧镜面高光条 */}
          <line x1={WALL_X0 + 7} y1={TOP_Y + 34} x2={WALL_X0 + 7} y2={BOTTOM_Y - 34} stroke="#ffffff" strokeWidth="4.5" opacity="0.55" strokeLinecap="round" />
          <line x1={WALL_X1 - 8} y1={TOP_Y + 44} x2={WALL_X1 - 8} y2={BOTTOM_Y - 52} stroke="#ffffff" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
          {/* 筒底内椭圆：一点反光暗示玻璃底 */}
          <ellipse cx={(WALL_X0 + WALL_X1) / 2} cy={BOTTOM_Y - 5} rx={(WALL_X1 - WALL_X0) / 2 - 12} ry="6" fill="#ffffff" opacity="0.14" />

          {/* 量筒刻度：25/50/75/100%，主刻度（50/100）更长 */}
          {[0.25, 0.5, 0.75, 1].map((f) => {
            const y = BOTTOM_Y - (BOTTOM_Y - TOP_Y) * f
            const major = f === 0.5 || f === 1
            return (
              <g key={f}>
                <line x1={WALL_X1 - (major ? 10 : 7)} y1={y} x2={WALL_X1 - 2} y2={y} stroke="#9fb0c4" strokeWidth={major ? 2 : 1.5} />
                <text x={WALL_X1 + 4} y={y + 3} fontSize="8" fill="#8296ad">{f * 100}</text>
              </g>
            )
          })}

          {overflow && (
            <g>
              <rect x="8" y="2" width="118" height="20" rx="10" fill="#fef3c7" stroke="#f59e0b" strokeWidth="1.2" />
              <text x="67" y="16" textAnchor="middle" fontSize="11" fill="#b45309" fontWeight="600">⚠ 今天的量已经溢出</text>
            </g>
          )}
        </svg>
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 gap-3">
        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap flex-shrink-0">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#78848f] border border-[#5d6a76] inline-block" /> 岩石（困难）×{rocks.length}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#aab4c0] inline-block" /> 卵石（中等）×{pebbles.length}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-[#e9d8ab] border border-[#cfbc8a] inline-block" /> 沙子（简单）×{sand.length}</span>
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
