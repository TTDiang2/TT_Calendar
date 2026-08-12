import type { CalEvent, CountdownItem, Day, Layer, MonthData, ScheduleItem, StatsSummary, Todo, TodoList, TodoSort, TodoStatusFilter, ViewMode, YearData } from '../types'

// 开发：localhost:8000（uvicorn）；生产：127.0.0.1:8765（Tauri sidecar）
const API_BASE = import.meta.env.PROD ? 'http://127.0.0.1:8765' : 'http://localhost:8000'

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}/api${path}`)
  if (!r.ok) throw new Error(`${r.status} ${path}`)
  return r.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`${r.status} ${path}`)
  return r.json()
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}/api${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`${r.status} ${path}`)
  return r.json()
}

async function del<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}/api${path}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`${r.status} ${path}`)
  return r.json()
}

// 视图聚合
export const getView = (mode: ViewMode, anchor: string) => {
  if (mode === 'countdown') throw new Error('countdown 视图不走 getView')
  if (mode === 'year') {
    const y = Number(anchor.split('-')[0])
    return get<YearData>(`/view/year/${y}`)
  }
  if (mode === 'month') {
    const [y, mm] = anchor.split('-').map(Number)
    return get<MonthData>(`/view/month/${y}/${mm}`)
  }
  if (mode === 'week') return get<MonthData>(`/view/week/${anchor}`)
  return get<MonthData>(`/view/day/${anchor}`)
}

// 图层
export const getLayers = () => get<Layer[]>('/layers')
export const toggleLayer = (layerId: string, enabled: boolean) =>
  put<Layer>(`/layers/${layerId}`, { enabled })
export const getLayerSubActions = (layerId: string) =>
  get<{ qtype: string; sub_action: string }[]>(`/layers/${layerId}/sub-actions`)
export const updateLayerConfig = (
  layerId: string,
  data: { enabled?: boolean; sub_qtypes?: { qtype: string; sub_action: string | null }[] },
) => put<Layer>(`/layers/${layerId}/config`, data)
export const createLayer = (data: {
  display_name: string
  color?: string | null
  kind?: string
  group?: string | null
  config?: Record<string, unknown>
}) =>
  post<Layer>('/layers', data)
export const deleteLayer = (layerId: string) => del<{ ok: boolean }>(`/layers/${layerId}`)

// 事件
export const createEvent = (ev: CalEvent) => post<CalEvent>('/events', ev)
export const updateEvent = (id: number, ev: CalEvent) => put<CalEvent>(`/events/${id}`, ev)
export const deleteEvent = (id: number) => del<{ ok: boolean }>(`/events/${id}`)

// 日程
export const upsertSchedule = (d: string, am: string | null, pm: string | null, ev: string | null) =>
  put(`/schedule/${d}`, { date: d, am: am || null, pm: pm || null, ev: ev || null })

// 日程（新结构：多条、带起止时间）
export const getScheduleItems = (d: string) => get<ScheduleItem[]>(`/schedule-items/${d}`)
export const createScheduleItem = (item: ScheduleItem) => post<ScheduleItem>('/schedule-items', item)
export const updateScheduleItem = (id: number, item: ScheduleItem) => put<ScheduleItem>(`/schedule-items/${id}`, item)
export const deleteScheduleItem = (id: number) => del<{ ok: boolean }>(`/schedule-items/${id}`)

// 充实度
export const upsertColoring = (d: string, level: number) => put(`/coloring/${d}`, { level })
export const deleteColoring = (d: string) => del(`/coloring/${d}`)

// 涂色标记（打卡 / 自定义完成度）
export const upsertMark = (layerId: string, d: string, level: number | null, note: string | null = null) =>
  post<{ ok: boolean }>('/marks', { layer_id: layerId, date: d, level, note })
export const deleteMark = (layerId: string, d: string) =>
  del<{ ok: boolean }>(`/marks/${layerId}/${d}`)

// 拖拽改期
export const moveDay = (src: string, dst: string) =>
  post<{ moved_events: number; moved_schedule: boolean }>('/move-day', { src, dst })

// 搜索
export const searchEvents = (q: string) => get<CalEvent[]>(`/search?q=${encodeURIComponent(q)}`)

// 倒数日（独立 countdown 表）
export const getCountdown = () => get<{ text: string }>('/countdown')
export const getCountdownList = () => get<CountdownItem[]>('/countdown/list')
export interface CountdownInput {
  name: string
  category?: string
  base_date: string
  repeat_yearly?: boolean
  milestone_rule?: string | null
  never_expire?: boolean
  notes?: string | null
  color?: string | null
  sort_order?: number
}
export const createCountdown = (data: CountdownInput) => post<CountdownItem>('/countdown', data)
export const updateCountdown = (id: number, data: CountdownInput) => put<CountdownItem>(`/countdown/${id}`, data)
export const deleteCountdown = (id: number) => del<{ ok: boolean }>(`/countdown/${id}`)

// 统计
export const getStatsSummary = () => get<StatsSummary>('/stats/summary')

// 集思录导入
export const importJisilu = (start: string, end: string, qtypes?: string[]) =>
  post<{ inserted: number; error: string | null }>('/import/jisilu', { start, end, qtypes })

// 待办忙度算法配置
export interface TodoBusyConfig {
  weights: {
    due_date: number
    planned_date: number
    importance: { high: number; medium: number; low: number }
    complexity: { high: number; medium: number; low: number }
  }
  thresholds: number[]
  predict_colors: string[]
  done_colors: string[]
}
export const getTodoBusyConfig = () => get<TodoBusyConfig>('/settings/todo-busy')
export const setTodoBusyConfig = (cfg: Partial<TodoBusyConfig>) =>
  put<TodoBusyConfig>('/settings/todo-busy', cfg)
export const recomputeTodoBusy = () =>
  post<{ days_written: number }>('/settings/todo-busy/recompute')

// Todo 列表
export const getTodoLists = () => get<TodoList[]>('/todo/lists')
export const createTodoList = (display_name: string) =>
  post<TodoList>('/todo/lists', { display_name, sort_order: 0 })
export const updateTodoList = (id: string, display_name: string) =>
  put<TodoList>(`/todo/lists/${id}`, { display_name, sort_order: 0 })
export const deleteTodoList = (id: string) => del<{ ok: boolean }>(`/todo/lists/${id}`)
export const reorderTodoLists = (ordered_ids: string[]) =>
  put<{ ok: boolean }>('/todo/lists/reorder', { ordered_ids })
export const reorderTodos = (ordered_ids: string[]) =>
  put<{ ok: boolean }>('/todo/reorder', { ordered_ids })

// Todo 任务
export const getTodos = (params: { list_id?: string; status?: TodoStatusFilter; sort?: TodoSort; limit?: number } = {}) => {
  const qs = new URLSearchParams()
  if (params.list_id) qs.set('list_id', params.list_id)
  if (params.status) qs.set('status', params.status)
  if (params.sort) qs.set('sort', params.sort)
  if (params.limit) qs.set('limit', String(params.limit))
  const suffix = qs.toString() ? `?${qs}` : ''
  return get<Todo[]>(`/todo${suffix}`)
}
export const getTodoStats = (list_id?: string) => {
  const qs = list_id ? `?list_id=${encodeURIComponent(list_id)}` : ''
  return get<{ total: number; incomplete: number; completed: number }>(`/todo/stats${qs}`)
}
export const createTodo = (data: {
  list_id: string
  title: string
  body?: string | null
  importance?: string
  due_date?: string | null
  planned_date?: string | null
  start_date?: string | null
  complexity?: string
  tags?: string[] | null
  status?: string
}) => post<Todo>('/todo', data)
export const updateTodo = (id: string, data: Record<string, unknown>) => put<Todo>(`/todo/${id}`, data)
export const deleteTodo = (id: string) => del<{ ok: boolean }>(`/todo/${id}`)
export const importTodosCsv = (file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return fetch(`${API_BASE}/api/todo/import/csv`, { method: 'POST', body: fd }).then((r) => r.json())
}

export { API_BASE }
export type { Day }
