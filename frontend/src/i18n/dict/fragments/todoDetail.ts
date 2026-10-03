/**
 * todoDetail 命名空间（老端版）：TodoDetailPanel.tsx（待办详情右栏 + DueDateQuickPicker）。
 * key 命名沿 Neo fragments/todoEditor.ts 的对应部分（同源组件）；
 * zh 与 Neo 的分叉处以老端原文为准——repeat 档位老端是「每日重复/每工作日重复/每周重复」
 * （Neo 是「每天/每工作日/每周」，不回抄）。
 * 待办标题/标签值是用户数据，仅作具名插值参数。
 */
export const todoDetail = {
  zh: {
    /** 面板左上角小标 */
    title: '待办详情',
    /** 右栏未选中待办时的占位句 */
    emptyPanel: '点击待办查看详情',
    /** 表单字段标/占位 */
    field: {
      /** 标题输入占位符 */
      title: '标题',
      /** 备注输入占位符 */
      bodyOptional: '备注（可选）',
      list: '列表',
      importance: '重要性',
      dueDate: '截止日期',
      plannedDate: '计划日期',
      startDate: '开始日',
      status: '状态',
      complexity: '复杂度',
      repeat: '重复',
      /** 重复下拉的 title 提示 */
      repeatHint: '完成后自动生成下一期',
      tags: '标签（逗号分隔，自定义）',
    },
    /** 标签输入占位示例 */
    tagsPlaceholder: '工作, 学习, 家庭…',
    /** 备注框 hover 提示（title 属性） */
    dblClickEdit: '双击放大编辑',
    /** 重要性档位（下拉选项） */
    importance: { high: '高', normal: '普通', low: '低' },
    /** 状态五档（下拉选项） */
    status: {
      notStarted: '未开始',
      inProgress: '进行中',
      completed: '已完成',
      waitingOnOthers: '等待他人',
      deferred: '已推迟',
    },
    /** 复杂度三档（下拉选项） */
    complexity: { simple: '简单', medium: '中等', hard: '复杂' },
    /** 重复档位（key 对齐后端枚举；zh 为老端原文，与 Neo 词表有分叉） */
    repeat: {
      none: '不重复',
      daily: '每日重复',
      weekdays: '每工作日重复',
      weekly: '每周重复',
    },
    /** 截止/计划日期快捷选择（DueDateQuickPicker） */
    due: {
      today: '今天',
      tomorrow: '明天',
      nextMonday: '下周一',
      /** 下拉选项的带日期变体（date 为 MM-DD 数据串） */
      todayWithDate: '今天（{date}）',
      tomorrowWithDate: '明天（{date}）',
      nextMondayWithDate: '下周一（{date}）',
      /** 自定义日期在下拉里的展示（value 为 YYYY-MM-DD 数据串） */
      customValue: '{value}（自定义）',
      /** 展开自选日期的入口选项 */
      pickDate: '选择日期…',
      /** 自选日期态的返回按钮 */
      back: '返回',
      /** 无值占位 */
      none: '无',
    },
    /** 底部操作 */
    action: {
      close: '关闭',
      delete: '删除',
      save: '保存',
      saving: '保存中…',
    },
    /** 底部自动保存提示前段（后接高亮 Ctrl+Enter span） */
    autosavePrefix: '切换页面自动保存 · ',
    /** 底部自动保存提示后段 */
    autosaveSuffix: ' 直接保存',
    /** 删除待办的 confirm 弹窗，{title} 为用户数据 */
    deleteConfirm: '删除待办「{title}」？',
    /** 笔记弹窗在标题为空时的兜底标题 */
    notesFallbackTitle: '备注',
  },
  en: {
    title: 'To-do details',
    emptyPanel: 'Select a to-do to view details',
    field: {
      title: 'Title',
      bodyOptional: 'Notes (optional)',
      list: 'List',
      importance: 'Importance',
      dueDate: 'Due date',
      plannedDate: 'Planned date',
      startDate: 'Start date',
      status: 'Status',
      complexity: 'Complexity',
      repeat: 'Repeat',
      repeatHint: 'Automatically creates the next occurrence when completed',
      tags: 'Tags (comma separated, custom)',
    },
    tagsPlaceholder: 'work, study, family…',
    dblClickEdit: 'Double-click to expand for editing',
    importance: { high: 'High', normal: 'Normal', low: 'Low' },
    status: {
      notStarted: 'Not started',
      inProgress: 'In progress',
      completed: 'Completed',
      waitingOnOthers: 'Waiting on others',
      deferred: 'Deferred',
    },
    complexity: { simple: 'Simple', medium: 'Medium', hard: 'Hard' },
    repeat: {
      none: 'No repeat',
      daily: 'Repeat daily',
      weekdays: 'Repeat every weekday',
      weekly: 'Repeat weekly',
    },
    due: {
      today: 'Today',
      tomorrow: 'Tomorrow',
      nextMonday: 'Next Monday',
      todayWithDate: 'Today ({date})',
      tomorrowWithDate: 'Tomorrow ({date})',
      nextMondayWithDate: 'Next Monday ({date})',
      customValue: '{value} (custom)',
      pickDate: 'Pick a date…',
      back: 'Back',
      none: 'None',
    },
    action: {
      close: 'Close',
      delete: 'Delete',
      save: 'Save',
      saving: 'Saving…',
    },
    autosavePrefix: 'Auto-saves when switching pages · ',
    autosaveSuffix: ' to save now',
    deleteConfirm: 'Delete to-do "{title}"?',
    notesFallbackTitle: 'Notes',
  },
} as const
