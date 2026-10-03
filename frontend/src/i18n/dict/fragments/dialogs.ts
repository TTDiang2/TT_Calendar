/**
 * dialogs 命名空间（老端版）：dialogs.tsx ——
 * EventEditor（事件编辑器）、ScheduleEditor（日程编辑器）、ColoringPicker（充实度选择器）、
 * SearchDialog（事件搜索）、SubscriptionDialog（订阅面板，老端独有，Neo 无对应物）、
 * ContextMenu（右键菜单）、DayEntryDialog（当日新增：点点/日程 + 涂色合体录入，老端独有形态）。
 *
 * 与 Neo 同源组件的 key 命名与 en 沿 Neo fragments/dialogs.ts 复用；
 * zh 与 Neo 有分叉处、以及老端独有文案，以老端原文为准。
 * 通用词（取消/保存/关闭/删除）复用 common.*；图层显示名是 DB 用户数据原样渲染。
 *
 * 逐屏一致注记：
 * - schedule/coloring/dayEntry 三处弹窗标题的 {date} 沿用原实现 ISO 日期串（zh '2026-10-03'
 *   形态），不改走 fmtDate（会变 '2026/10/3'，破坏逐屏一致）——沿 Neo 同款裁决。
 * - subscription.pendingHint 原实现是跨行 JSX 文本（换行折叠为一个半角空格），
 *   key 内保留该空格以逐字一致。
 */
export const dialogs = {
  zh: {
    /** 起止时间输入框之间的连接词 */
    toTime: '至',
    /** 图层下拉里未启用图层名后的括号后缀 */
    hiddenSuffix: '（隐藏）',
    /** 删除单条日程按钮的 title（日程编辑器行内） */
    deleteScheduleItem: '删除这条日程',
    /** 操作失败且无具体消息时的兜底词（订阅刷新/当日新增保存共用） */
    unknownError: '未知错误',

    /** ── 事件编辑器（EventEditor，新建/编辑两态） ────────── */
    event: {
      titleEdit: '编辑事件',
      titleNew: '新建事件',
      fieldTitle: '标题',
      fieldDate: '日期',
      fieldLayer: '图层',
      fieldDesc: '描述（可选）',
      fieldColor: '颜色（可选，#RRGGBB）',
    },

    /** ── 日程编辑器（ScheduleEditor，多时段行编辑） ──────── */
    schedule: {
      /** 弹窗标题，{date} 为 ISO 日期串 */
      titleWithDate: '日程 {date}',
      empty: '当天没有日程，点「添加日程」开始',
      add: '添加日程',
      what: '做什么',
      /** 每行日期小标 */
      dateLabel: '日期',
      /** 结束日期输入的 title 提示 */
      endDateHint: '留空 = 单日；填了就是多日日程，每天都显示',
      /** 区间合法时的跨度标注：单日 */
      singleDay: '单日',
      /** 跨度标注：多日，{n} 为天数 */
      multiDay: '多日 · 共 {n} 天',
      /** 区间非法（结束早于开始）的红字 */
      spanBad: '结束日期早于开始日期',
      cat: {
        work: '工作',
        course: '课程',
        sport: '运动',
        play: '玩耍',
        misc: '其他',
      },
    },

    /** ── 充实度选择器（ColoringPicker，5 档 + 清除） ─────── */
    coloring: {
      titleWithDate: '充实度 {date}',
      current: '当前：{level}',
      notSet: '未设',
      clear: '清除',
    },

    /** 充实度 5 档显示名（labelKey 模式渲染） */
    coloringLevel: {
      relaxed: '放松',
      mild: '轻松',
      moderate: '适中',
      busy: '充实',
      productive: '高产',
    },

    /** ── 事件搜索（SearchDialog） ───────────────────────── */
    search: {
      title: '搜索事件',
      placeholder: '输入关键词…',
      /** 空结果提示，{q} 为用户关键词 */
      nothing: '未找到匹配「{q}」的事件',
    },

    /** ── 订阅面板（SubscriptionDialog，老端独有） ────────── */
    subscription: {
      title: '订阅',
      /** 顶部说明 */
      intro: '订阅外部日历数据源，打开日历时自动保持最新。新增自定义订阅后需由你的 agent 完成适配（应用内会提示）。',
      /** 待适配提醒标题，{n} 为数量 */
      pendingCount: '有 {n} 个订阅待适配',
      /** 待适配提醒正文（含原跨行 JSX 折叠出的半角空格，见文件头注记） */
      pendingHint: '请把 TT_Calendar 文件夹用您的 agent 软件打开，并提醒 agent 有新的订阅要做适配 （agent 将读取下方「待适配」卡片里的登记信息，按 docs/SUBSCRIPTION_SPEC.md 完成适配）。',
      /** 状态徽章：待适配 */
      pendingBadge: '待适配',
      /** 状态徽章：出错 */
      errorBadge: '出错',
      /** 最后同步时间行，{time} 为原实现的 slice(5,16) 切片 */
      updatedAt: '更新于 {time}',
      /** 启停开关的 title */
      toggleOff: '关闭订阅',
      toggleOn: '开启订阅',
      /** pending 卡片字段标 */
      urlLabel: '网址：',
      rulesLabel: '规则：',
      /** 字段空值占位 */
      emptyValue: '（无）',
      autoUpdate: '打开时自动更新',
      refresh: '立即更新',
      refreshing: '更新中…',
      /** 刷新成功消息，{name} 为订阅名（用户数据），{n} 为新增条数 */
      updatedMsg: '「{name}」已更新（新增 {n} 条）',
      /** 刷新失败消息 */
      updateFailed: '「{name}」更新失败：{error}',
      /** 删除订阅的 confirm，{name} 为订阅名 */
      deleteConfirm: '删除订阅「{name}」？（已抓取的事件数据保留）',
      /** 新增订阅表单 */
      fieldTitle: '标题',
      fieldUrl: '网址',
      /** 订阅名输入示例占位 */
      namePlaceholder: '如：高金讲座日历',
      fieldRules: '订阅规则（自然语言，给你的 agent 读）',
      rulesPlaceholder: '描述这个日历在哪、怎么抓、哪些字段、什么频率更新……',
      submitting: '提交中…',
      confirmAdd: '确认订阅',
      addNew: '新增订阅',
    },

    /** ── 右键菜单（ContextMenu） ────────────────────────── */
    menu: {
      newEvent: '新建事件',
      editSchedule: '编辑日程',
      setColoring: '设置充实度',
    },

    /** ── 当日新增（DayEntryDialog：点点/日程 + 涂色合体，老端独有形态） ── */
    dayEntry: {
      /** 弹窗标题，{date} 为 ISO 日期串 */
      titleWithDate: '新建 {date}',
      /** 呈现方式切换的两个页签 */
      tabDot: '点点 / 日程',
      tabColor: '涂色',
      fieldStart: '开始日期',
      fieldEnd: '结束日期（可选，填了就是多日）',
      rangeInvalid: '结束日期不能早于开始日期',
      /** 多日提示主体：{n} 天数，{range} 为 '起 ~ 止' 数据串 */
      multiCount: '共 {n} 天（{range}）',
      /** 多日提示后缀：日程类（存单行） */
      suffixSchedule: ' · 存为 1 条多日日程，每天都可见',
      /** 多日提示后缀：事件类按天建条，{n} 为条数 */
      suffixEvents: ' · 按天建 {n} 条事件',
      /** 多日提示后缀：涂色类 */
      suffixColor: ' · 连续 {n} 天都做标记',
      pickLayer: '选择图层',
      groupSchedule: '日程',
      groupOther: '其他',
      allDay: '全天',
      /** 时间行末色点的 title */
      layerColorTitle: '图层颜色',
      fieldContent: '内容',
      contentPlaceholder: '做什么',
      /** 内容为空时提交的校验错误（Error 消息） */
      contentRequired: '请填写内容',
      pickColorLayer: '选择涂色图层',
      groupHabit: '习惯打卡',
      groupProgress: '工作完成度',
      groupLinked: '关联涂色',
      levelFullness: '充实度档位',
      level: '档位',
      fixedColor: '图层颜色（固定）',
      fixedColorHint: '标记使用图层预设颜色，如需改色请到设置页编辑图层。',
      /** 自动建待办复选框标签 */
      autoTodo: '同时创建对应待办',
      /** 自动建待办说明行：{list} 为列表名（持久化数据），{start}/{end} 为 ISO 日期 */
      autoTodoDetail: '放入「{list}」列表（没有会自动创建）；计划日期 {start}、截止日期 {end}',
      /** 勾选自动建待办且标题为空时的后缀提示，{title} 为兜底标题词 */
      autoTodoTitleHint: ' · 标题将用「{title}」',
      /** 待办标题兜底词（日程类） */
      scheduleWord: '日程',
      /** 待办标题兜底词（涂色类，图层无显示名时） */
      coloringWord: '涂色',
      submit: '添加',
      saving: '保存中…',
      /** 保存失败行，{msg} 为错误消息 */
      saveFailed: '保存失败：{msg}',
    },
  },
  en: {
    toTime: 'to',
    hiddenSuffix: ' (hidden)',
    deleteScheduleItem: 'Delete this schedule item',
    unknownError: 'Unknown error',

    event: {
      titleEdit: 'Edit event',
      titleNew: 'New event',
      fieldTitle: 'Title',
      fieldDate: 'Date',
      fieldLayer: 'Layer',
      fieldDesc: 'Description (optional)',
      fieldColor: 'Color (optional, #RRGGBB)',
    },

    schedule: {
      titleWithDate: 'Schedule {date}',
      empty: 'No schedule for this day yet — tap "Add schedule" to start',
      add: 'Add schedule',
      what: 'What to do',
      dateLabel: 'Date',
      endDateHint: 'Leave empty for a single day; fill in for a multi-day schedule shown every day',
      singleDay: 'Single day',
      multiDay: 'Multi-day · {n} days total',
      spanBad: 'End date is before start date',
      cat: {
        work: 'Work',
        course: 'Courses',
        sport: 'Sports',
        play: 'Leisure',
        misc: 'Other',
      },
    },

    coloring: {
      titleWithDate: 'Fullness {date}',
      current: 'Current: {level}',
      notSet: 'Not set',
      clear: 'Clear',
    },

    coloringLevel: {
      relaxed: 'Relaxed',
      mild: 'Mild',
      moderate: 'Moderate',
      busy: 'Busy',
      productive: 'Productive',
    },

    search: {
      title: 'Search events',
      placeholder: 'Type keywords…',
      nothing: 'No events matching "{q}"',
    },

    subscription: {
      title: 'Subscriptions',
      intro: 'Subscribe to external calendar sources and keep them fresh automatically when you open the app. New custom subscriptions need to be adapted by your agent (the app will prompt you).',
      pendingCount: '{n} subscriptions pending adaptation',
      pendingHint: 'Open the TT_Calendar folder with your agent software and remind it that a new subscription needs adaptation (the agent will read the registration info in the "Pending" cards below and follow docs/SUBSCRIPTION_SPEC.md).',
      pendingBadge: 'Pending',
      errorBadge: 'Error',
      updatedAt: 'Updated {time}',
      toggleOff: 'Disable subscription',
      toggleOn: 'Enable subscription',
      urlLabel: 'URL: ',
      rulesLabel: 'Rules: ',
      emptyValue: '(none)',
      autoUpdate: 'Auto-update on open',
      refresh: 'Update now',
      refreshing: 'Updating…',
      updatedMsg: '"{name}" updated ({n} new items)',
      updateFailed: 'Failed to update "{name}": {error}',
      deleteConfirm: 'Delete subscription "{name}"? (Already fetched events are kept)',
      fieldTitle: 'Title',
      fieldUrl: 'URL',
      namePlaceholder: 'e.g. Lecture calendar',
      fieldRules: 'Subscription rules (natural language, for your agent to read)',
      rulesPlaceholder: 'Describe where this calendar lives, how to fetch it, which fields, and how often to update…',
      submitting: 'Submitting…',
      confirmAdd: 'Subscribe',
      addNew: 'New subscription',
    },

    menu: {
      newEvent: 'New event',
      editSchedule: 'Edit schedule',
      setColoring: 'Set fullness',
    },

    dayEntry: {
      titleWithDate: 'New for {date}',
      tabDot: 'Dots / schedule',
      tabColor: 'Coloring',
      fieldStart: 'Start date',
      fieldEnd: 'End date (optional; fill in for multi-day)',
      rangeInvalid: 'End date cannot be before start date',
      multiCount: '{n} days total ({range})',
      suffixSchedule: ' · saved as 1 multi-day schedule, visible every day',
      suffixEvents: ' · creates {n} events, one per day',
      suffixColor: ' · marks {n} days in a row',
      pickLayer: 'Choose layer',
      groupSchedule: 'Schedule',
      groupOther: 'Other',
      allDay: 'All day',
      layerColorTitle: 'Layer color',
      fieldContent: 'Content',
      contentPlaceholder: 'What to do',
      contentRequired: 'Please enter content',
      pickColorLayer: 'Choose coloring layer',
      groupHabit: 'Habit tracking',
      groupProgress: 'Work progress',
      groupLinked: 'Linked coloring',
      levelFullness: 'Fullness level',
      level: 'Level',
      fixedColor: 'Layer color (fixed)',
      fixedColorHint: 'The mark uses the layer preset color. To change it, edit the layer in Settings.',
      autoTodo: 'Also create a matching to-do',
      autoTodoDetail: 'Put it in the "{list}" list (created automatically if missing); planned {start}, due {end}',
      autoTodoTitleHint: ' · title will be "{title}"',
      scheduleWord: 'Schedule',
      coloringWord: 'Coloring',
      submit: 'Add',
      saving: 'Saving…',
      saveFailed: 'Save failed: {msg}',
    },
  },
} as const
