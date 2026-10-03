/**
 * todoview 命名空间（老端版）：TodoView.tsx —— 待办主视图（左清单栏/工具行/列表行/
 * 行徽标/CSV 导入）。todo/ 目录六个子视图的板级文案在 todoboards 命名空间。
 *
 * 词表说明：
 *  - sort/imp/status/complexity 四张是排序下拉与列表行徽标的旧词表（手动排序…/
 *    重要·普通·次要/未开始…等待他人/简单·中等·复杂），key 命名与 en 沿 Neo
 *    todo.ts 同名分组（sort/imp/status/complexity）复用。zh 与已注册的
 *    todoDetail 的 status / complexity 两组（详情面板下拉词表）逐字同文但**不复
 *    用其 key**：老端渲染点本就是独立模块词表，且 imp 三档（重要/普通/次要）在
 *    任何已注册词表（todoDetail「高·普通·低」/todo.card「高·中·低」）中都无同
 *    文表、必须新立，三张一并成组；en 亦有分叉（complexity.hard 沿 Neo 作
 *    Complex 非 Hard）——同批 todo.card.*「并存禁合并」先例，后续措辞裁决另做。
 *  - 「任务」默认列表名经 createTodoList 持久化写入 todo_lists.display_name
 *    （TodoView.tsx 行级棘轮豁免），不入字典（Neo lists.defaultName TODO-REVIEW
 *    同款边界：数据面改版另排期）。
 *  - 清单名（TodoList.display_name）/标签值是用户数据，仅作具名插值参数。
 */
export const todoview = {
  zh: {
    /** 排序下拉选项 */
    sort: {
      manual: '手动排序',
      dueImportance: '截止+重要性',
      duePlannedImportance: '截止+计划+重要性',
      due: '截止日',
      planned: '计划日',
      importance: '重要性',
      created: '创建时间',
    },
    /** 行徽标：重要性（列表行 tag） */
    imp: { high: '重要', normal: '普通', low: '次要' },
    /** 行徽标：状态（非「未开始」才显示） */
    status: {
      notStarted: '未开始',
      inProgress: '进行中',
      completed: '已完成',
      waitingOnOthers: '等待他人',
      deferred: '已推迟',
    },
    /** 行徽标：复杂度 */
    complexity: { simple: '简单', medium: '中等', hard: '复杂' },
    /** 行徽标：重复档位（none 不显示，未知枚举回落原值） */
    repeat: { daily: '每日', weekdays: '工作日', weekly: '每周' },
    /** 截止态徽标（badge 的 label 已是译文；date 是 MM-DD 数据串） */
    due: {
      overdue: '已过期',
      today: '今天截止',
      tomorrow: '明天截止',
      badge: '{label} · {date}',
    },
    /** 计划徽标 */
    plan: { today: '今日计划', tomorrow: '明日计划' },
    /** 左清单栏 */
    lists: {
      /** 「全部」伪列表（Inbox 图标行） */
      all: '全部',
      /** 星标按钮 title */
      setDefault: '设为默认列表',
      unsetDefault: '取消默认',
      /** 铅笔按钮 title */
      rename: '重命名',
      /** 删除清单的 confirm 弹窗（name 为用户数据原样插入） */
      deleteConfirm: '删除列表「{name}」及其所有待办？',
      /** 新建清单输入框占位 */
      namePlaceholder: '列表名',
      /** 新建清单按钮 */
      create: '新建列表',
    },
    /** 工具行下拉行标与「全部标签」选项 */
    filter: { sort: '排序', tag: '筛选', allTags: '全部标签' },
    toolbar: { importCsv: 'CSV 导入' },
    /** 新建待办按钮 */
    actions: { new: '新建待办' },
    /** 列表空态 */
    empty: {
      /** 标签筛选无命中（tag 为用户数据） */
      tagFiltered: '没有「{tag}」标签的待办',
      desktop: '暂无待办，点「新建待办」开始',
      noneOpen: '没有未完成待办',
    },
    /** 列表行尾的已完成折叠条 */
    row: { completedWithCount: '已完成（{n}）' },
    /** CSV 导入结果条（inserted/lists 为服务端计数；整句两 key 变体，不做 t()+ 拼接） */
    csv: {
      done: '导入 {inserted} 条，新建 {lists} 个列表',
      doneWithErrors: '导入 {inserted} 条，新建 {lists} 个列表，{n} 行错误',
      /** 导入失败提示（msg 为后端错误消息原样插入） */
      failed: '导入失败: {msg}',
    },
  },
  en: {
    sort: {
      manual: 'Manual',
      dueImportance: 'Due + importance',
      duePlannedImportance: 'Due + planned + importance',
      due: 'Due date',
      planned: 'Planned date',
      importance: 'Importance',
      created: 'Created',
    },
    imp: { high: 'Important', normal: 'Normal', low: 'Minor' },
    status: {
      notStarted: 'Not started',
      inProgress: 'In progress',
      completed: 'Completed',
      waitingOnOthers: 'Waiting on others',
      deferred: 'Deferred',
    },
    complexity: { simple: 'Simple', medium: 'Medium', hard: 'Complex' },
    repeat: { daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly' },
    due: {
      overdue: 'Overdue',
      today: 'Due today',
      tomorrow: 'Due tomorrow',
      badge: '{label} · {date}',
    },
    plan: { today: 'Planned today', tomorrow: 'Planned tomorrow' },
    lists: {
      all: 'All',
      setDefault: 'Set as default list',
      unsetDefault: 'Unset default',
      rename: 'Rename',
      deleteConfirm: 'Delete list "{name}" and all its to-dos?',
      namePlaceholder: 'List name',
      create: 'New list',
    },
    filter: { sort: 'Sort', tag: 'Filter', allTags: 'All tags' },
    toolbar: { importCsv: 'CSV import' },
    actions: { new: 'New to-do' },
    empty: {
      tagFiltered: 'No to-dos tagged "{tag}"',
      desktop: 'No to-dos yet — tap "New to-do" to start',
      noneOpen: 'No open to-dos',
    },
    row: { completedWithCount: 'Completed ({n})' },
    csv: {
      done: 'Imported {inserted}, created {lists} lists',
      doneWithErrors: 'Imported {inserted}, created {lists} lists, {n} rows failed',
      failed: 'Import failed: {msg}',
    },
  },
} as const
