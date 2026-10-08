/**
 * layers 命名空间（20261004 P2.5 用户反馈批）：内置图层的显示名映射目标译文。
 * 这些名字以 zh 种子写入 layer_config.display_name（持久化数据，手册 §5.1），
 * 显示时经 adapt/layerLabel.ts 按 layer_id 映射到本表；用户改过名（display_name
 * ≠ zh 种子）则显示用户名。日程待办/任务 两个内置待办列表按 display_name 映射。
 */
export const layers = {
  zh: {
    /** 内置图层（db.py 种子，zh=种子原文逐字） */
    scheduleLegacy: '日程（旧）',
    important: '重要日期',
    coloring: '充实度染色',
    holiday: '公共节假日',
    todo: '待办',
    todoDone: '待办·已完成',
    work: '工作',
    course: '课程',
    sport: '运动',
    play: '玩耍',
    misc: '其他',
    /** 内置待办列表（前端 createTodoList 持久化名） */
    scheduleTodoList: '日程待办',
    defaultTaskList: '任务',
  },
  en: {
    scheduleLegacy: 'Legacy schedule',
    important: 'Important dates',
    coloring: 'Fullness coloring',
    holiday: 'Public holidays',
    todo: 'To-dos',
    todoDone: 'Completed to-dos',
    work: 'Work',
    course: 'Courses',
    sport: 'Sports',
    play: 'Play',
    misc: 'Other',
    scheduleTodoList: 'Schedule to-dos',
    defaultTaskList: 'Tasks',
  },
} as const
