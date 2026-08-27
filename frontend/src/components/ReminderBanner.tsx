import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ListTodo, X } from 'lucide-react'
import { getTodos, getTodoReminderConfig, type TodoReminderConfig } from '../api/client'
import type { Todo } from '../types'

const DISMISS_KEY_PREFIX = 'tt_reminder_dismissed_'

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isDismissedToday(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY_PREFIX + todayStr()) === '1'
  } catch {
    return false
  }
}

function dismissForToday() {
  try {
    localStorage.setItem(DISMISS_KEY_PREFIX + todayStr(), '1')
  } catch {}
}

function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

function timeToMinutes(t: string): number {
  const [hh, mm] = t.split(':').map((s) => parseInt(s, 10))
  if (Number.isNaN(hh) || Number.isNaN(mm)) return 16 * 60
  return hh * 60 + mm
}

function pickPlannedTodayCount(todos: Todo[] | undefined): number {
  if (!todos) return 0
  const today = todayStr()
  return todos.filter((t) => t.status !== 'completed' && t.planned_date === today).length
}

export interface ReminderBannerProps {
  onJumpToTodo: () => void
}

export function ReminderBanner({ onJumpToTodo }: ReminderBannerProps) {
  const { data: cfg } = useQuery({
    queryKey: ['todoReminderConfig'],
    queryFn: getTodoReminderConfig,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })

  const { data: todos } = useQuery({
    queryKey: ['todos', { status: 'notStarted', source: 'reminderBanner' }],
    queryFn: () => getTodos({ status: 'notStarted', sort: 'planned', limit: 500 }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  const [visible, setVisible] = useState(false)
  const [trigger, setTrigger] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setTrigger((n) => n + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!cfg?.enabled) {
      setVisible(false)
      return
    }
    if (isDismissedToday()) {
      setVisible(false)
      return
    }
    const count = pickPlannedTodayCount(todos)
    if (count <= 0) {
      setVisible(false)
      return
    }
    if (nowMinutes() < timeToMinutes((cfg as TodoReminderConfig).time)) {
      setVisible(false)
      return
    }
    setVisible(true)
  }, [cfg, todos, trigger])

  if (!visible) return null

  const count = pickPlannedTodayCount(todos)
  if (count <= 0) return null

  const handleDismiss = () => {
    dismissForToday()
    setVisible(false)
  }

  const handleView = () => {
    onJumpToTodo()
    handleDismiss()
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-900"
    >
      <ListTodo size={16} className="flex-shrink-0 text-amber-600" />
      <span className="flex-1 min-w-0 truncate">
        今日还有 <span className="font-medium">{count}</span> 条计划任务未完成
      </span>
      <button
        onClick={handleView}
        className="text-xs px-2.5 py-1 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors"
      >
        查看
      </button>
      <button
        onClick={handleDismiss}
        aria-label="关闭今日提醒"
        className="text-amber-600 hover:text-amber-800 transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  )
}
