export interface CalEvent {
  id: number | null
  layer_id: string
  source: string
  date: string
  title: string
  description: string | null
  color: string | null
  extra: Record<string, unknown>
  source_ref: string | null
  sort_key: number
}

export interface Schedule {
  date: string
  am: string | null
  pm: string | null
  ev: string | null
}

export interface ScheduleItem {
  id: number | null
  date: string
  start_time: string | null
  end_time: string | null
  title: string
  color: string | null
  category: string
  sort_order: number
}

export interface CustomBg {
  color: string
  label: string
}

export interface DayMark {
  layer_id: string
  display_name: string
  level: number | null
  color: string | null
  mode: string
}

export interface Layer {
  layer_id: string
  display_name: string
  enabled: boolean
  color: string | null
  sort_order: number
  kind: string
  group: string | null
  config: Record<string, unknown>
}

export interface Day {
  date: string
  is_today: boolean
  is_weekend: boolean
  is_other_month: boolean
  events_by_layer: Record<string, CalEvent[]>
  schedule: Schedule | null
  schedule_items?: ScheduleItem[]
  coloring_level: number | null
  holiday: { name: string | null; is_workday_made_up: boolean } | null
  gradient_bg: string | null
  custom_bg?: CustomBg | null
  todos: Todo[]
  // 待办忙度双层快照：predict = 未完成 todo 加权（未来日期显示）
  // done = completed_at 当天的 todo 加权（过去日期显示）；今天双层叠加
  predict_level: number | null
  done_level: number | null
  marks: DayMark[]
}

export interface MonthData {
  year: number
  month: number
  layers: Layer[]
  days: Day[]
}

export interface YearData {
  year: number
  layers: Layer[]
  months: { month: number; days: Day[] }[]
}

export interface MockData {
  layers: Layer[]
  months: Record<string, MonthData>
  countdown: string
}

export type ViewMode = 'month' | 'week' | 'day' | 'year' | 'countdown'

export interface TodoList {
  id: string
  display_name: string
  sort_order: number
  created_at: string | null
}

export interface Todo {
  id: string
  list_id: string
  title: string
  body: string | null
  status: string
  importance: string
  due_date: string | null
  planned_date: string | null
  start_date: string | null
  complexity: string
  tags: string[] | null
  created_at: string | null
  completed_at: string | null
  sort_order: number
}

export interface CountdownItem {
  id: number
  name: string
  category: string
  base_date: string
  repeat_yearly: boolean
  milestone_rule: string | null
  never_expire: boolean
  notes: string | null
  color: string | null
  next_date: string
  next_label: string
  display: string
  days_left: number
  is_today: boolean
  passed: boolean
}

export interface StatsSummary {
  quadrant: {
    id: string
    title: string
    list_id: string
    importance: string
    due_date: string | null
    days_to_due: number | null
  }[]
  daily_done: { date: string; count: number }[]
  stats: { total: number; incomplete: number; completed: number }
  list_names: Record<string, string>
}

export type TodoSort = 'manual' | 'due_importance' | 'due_planned_importance' | 'due' | 'planned' | 'importance' | 'created'
export type TodoStatusFilter = 'notStarted' | 'all' | 'completed'
export type TopTab = 'calendar' | 'todo' | 'stats'
