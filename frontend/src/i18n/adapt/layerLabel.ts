/**
 * 内置图层/内置待办列表的显示名映射（20261004 P2.5，手册 §5.1 显示时映射）。
 *
 * 内置图层的 display_name 以 zh 种子写入数据库（持久化数据）——存储不动，
 * 显示时按 layer_id 映射到字典；用户改过名（display_name ≠ zh 种子）则显示用户名。
 * 内置待办列表（日程待办/任务）由前端 createTodoList 持久化，无 layer_id，按名映射。
 * 订阅图层（jisilu_*）与自定义图层（custom_*）是用户数据，原样显示。
 */
import type { TxKey } from '../index'

interface LabelLike {
  layer_id?: string
  display_name: string
}

/** layer_id → { zh 种子名, 字典 key } */
const BY_ID: Record<string, { zh: string; key: TxKey }> = {
  schedule: { zh: '日程（旧）', key: 'layers.scheduleLegacy' },
  important: { zh: '重要日期', key: 'layers.important' },
  coloring: { zh: '充实度染色', key: 'layers.coloring' },
  holiday: { zh: '公共节假日', key: 'layers.holiday' },
  todo: { zh: '待办', key: 'layers.todo' },
  todo_done: { zh: '待办·已完成', key: 'layers.todoDone' },
  schedule_work: { zh: '工作', key: 'layers.work' },
  schedule_course: { zh: '课程', key: 'layers.course' },
  schedule_sport: { zh: '运动', key: 'layers.sport' },
  schedule_play: { zh: '玩耍', key: 'layers.play' },
  schedule_other: { zh: '其他', key: 'layers.misc' },
}

/** 内置待办列表：display_name → 字典 key（todo_lists 无 layer_id） */
const BY_NAME: Record<string, TxKey> = {
  日程待办: 'layers.scheduleTodoList',
  任务: 'layers.defaultTaskList',
}

export function layerLabel(l: LabelLike, t: (k: TxKey) => string): string {
  const b = l.layer_id ? BY_ID[l.layer_id] : undefined
  if (b && l.display_name === b.zh) return t(b.key)
  const k = BY_NAME[l.display_name]
  return k ? t(k) : l.display_name
}
