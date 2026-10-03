/**
 * detail 命名空间（老端版）：DetailPanel.tsx（日视图右栏详情面板）+
 * NotesEditorModal.tsx（笔记弹窗默认值/提示）+ ReminderBanner.tsx（顶部提醒横幅）+
 * ErrorBoundary.tsx（渲染异常整屏兜底）——对应 Neo 端 dialogs.ts 的
 * detail/notes/reminder/errorBoundary 四个分组（老端 dialogs.ts 已被批①占用，
 * 故独立成档；key 命名与 en 沿 Neo 复用，zh 以老端原文为准）。
 *
 * zh 分叉/老端独有（逐屏一致红线）：
 *  - dateMD/yearWeekday 保留手拼空格（「{m} 月 {d} 日」「{y} 年 · 」），未走 Intl——
 *    Neo 走 Intl 后去掉了数字两侧空格并做了显式裁决；老端本批不做该裁决，
 *    weekday 参数由 fmtWeekday（Intl）产出，zh 下恰为「周六」与原手拼逐字一致；
 *  - 老端 common 尚无 edit/today/retry：edit 落本命名空间；today 复用 topbar.today；
 *    errorBoundary.retry 落本命名空间（Neo 用 common.retry）；
 *  - 编辑日程/删除这条日程 两个 title 复用 dialogs.menu.editSchedule / dialogs.deleteScheduleItem；
 *  - reminder.plannedLeft 按 §2.1 整句抽取（数字做主语 → 复数）：原 JSX 里加粗数字的
 *    内层 <span class="font-medium"> 一并消失（文案逐字不变，仅数字不再加粗），
 *    与 Neo 同款裁决（TODO-REVIEW）；
 *  - 农历行不走本字典：Day.lunar 是后端拼好的中文串（aggregator lunar_display），
 *    渲染经 adapt/labels.ts lunarDisplay（CJK 透传/非 CJK 隐藏），见该文件头注释。
 */
export const detail = {
  zh: {
    /** 未选日期时的面板占位句 */
    panelEmpty: '点击日期查看详情',
    /** 日期头部上方的小灰字 */
    selectedDate: '已选日期',
    /** 日期头部大字行（手拼空格保留，见文件头说明） */
    dateMD: '{m} 月 {d} 日',
    /** 日期头部小字行（weekday 为 fmtWeekday 产出，zh 下「周六」） */
    yearWeekday: '{y} 年 · {weekday}',
    /** 加点点入口按钮 */
    dot: '点点',
    /** 涂色入口按钮 */
    coloring: '涂色',
    /** 充实度进度条行首的小标签 */
    fullness: '充实度',
    /** 待办忙度预测（未完成）进度条行首标签 */
    todoPredict: '待办·未完成',
    /** 待办忙度（已完成）进度条行首标签 */
    todoDone: '待办·已完成',
    /** graded 标记未打档位时的占位说明 */
    noLevel: '未标记档位',
    /** solid 单色标记行「已标记」状态词 */
    marked: '已标记',
    /** 删除标记按钮的 title（graded/solid 两处共用） */
    deleteMark: '删除标记',
    /** 日程分区标题 */
    schedule: '日程',
    /** 日程分区右上「编辑全部日程」按钮的 title */
    editAllSchedule: '编辑全部日程',
    /** 日程分区右上「编辑」按钮文本 + 事件行编辑按钮 title */
    edit: '编辑',
    /** 无起止时间的日程条时间列兜底词 */
    allDay: '全天',
    /** 多日日程的行尾角标（index/total 为第几天/共几天，数据原样） */
    multiDay: '多日 {index}/{total}',
    /** 事件分区标题计数，{n} 为事件数 */
    eventsCount: '事件（{n}）',
    /** 事件分区空态 */
    noEvents: '无事件',
    /** 待办分区标题计数，{n} 为待办数 */
    todosCount: '待办（{n}）',
    /** 高重要度待办的角标（含闪电符号） */
    highImportance: '⚡高',
    /** 当天到期待办的红字角标 */
    dueTag: '截止',

    /** 笔记编辑器（NotesEditorModal，各处默认标题/占位） */
    notes: {
      /** 弹窗默认标题（调用方未传 title 时） */
      title: '备注',
      /** 编辑区默认占位符（调用方未传 placeholder 时） */
      placeholder: '备注（可选）',
      /** 编辑区下方的操作提示小字 */
      hint: 'ESC 或点击空白处关闭（自动保存）',
    },

    /** 待办提醒横幅（ReminderBanner，顶部琥珀色条） */
    reminder: {
      /** 提醒正文（数字计数，整句抽取后数字不再加粗，见文件头说明） */
      plannedLeft: { other: '今日还有 {n} 条计划任务未完成' },
      /** 「查看」按钮（跳转待办页） */
      view: '查看',
      /** 右侧关闭按钮的 aria-label */
      dismissAria: '关闭今日提醒',
    },

    /** 错误兜底（ErrorBoundary，渲染异常整屏兜底；类组件走 makeI18n 非 React 路径） */
    errorBoundary: {
      /** 兜底页大字标题 */
      title: '应用出错了',
      /** 重试按钮（老端 common 无 retry，落本命名空间） */
      retry: '重试',
    },
  },
  en: {
    panelEmpty: 'Click a date to see details',
    selectedDate: 'Selected date',
    dateMD: '{m}/{d}',
    yearWeekday: '{y} · {weekday}',
    dot: 'Dot',
    coloring: 'Coloring',
    fullness: 'Fullness',
    todoPredict: 'To-dos · open',
    todoDone: 'To-dos · done',
    noLevel: 'No level marked',
    marked: 'Marked',
    deleteMark: 'Delete mark',
    schedule: 'Schedule',
    editAllSchedule: 'Edit all schedule',
    edit: 'Edit',
    allDay: 'All day',
    multiDay: 'Day {index}/{total}',
    eventsCount: 'Events ({n})',
    noEvents: 'No events',
    todosCount: 'To-dos ({n})',
    highImportance: '⚡High',
    dueTag: 'Due',

    notes: {
      title: 'Note',
      placeholder: 'Note (optional)',
      hint: 'ESC or click outside to close (auto-saves)',
    },

    reminder: {
      plannedLeft: {
        one: '{n} planned task left to finish today',
        other: '{n} planned tasks left to finish today',
      },
      view: 'View',
      dismissAria: "Dismiss today's reminder",
    },

    errorBoundary: {
      title: 'Something went wrong',
      retry: 'Retry',
    },
  },
} as const
