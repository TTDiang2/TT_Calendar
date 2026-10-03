/**
 * topbar 命名空间（老端版）：TopBar.tsx —— 顶栏全部文案。
 * mode/todoMode/nav/searchPlaceholder 与 Neo 同源（zh 逐字一致，key 命名与 en 直接复用）；
 * 「今天」在 Neo 端属 common.today，老端 common 尚无该词，暂落本命名空间。
 * 中间标题（年/月）不走字典：App.tsx 按 §2 决策 #7 改走 fmtDate（Intl）。
 */
export const topbar = {
  zh: {
    /** 视图模式切换胶囊（月/周/日/年/倒数日） */
    mode: { month: '月', week: '周', day: '日', year: '年', countdown: '倒数日' },
    /** 待办子视图切换（列表/矩阵/看板/甘特/便签） */
    todoMode: { list: '列表', matrix: '矩阵', kanban: '看板', gantt: '甘特', stickies: '便签' },
    /** 上/下 period 导航按钮的 hover 提示（title 属性） */
    nav: {
      prevYear: '上一年',
      prevMonth: '上一月',
      prevWeek: '上一周',
      prevDay: '上一天',
      nextYear: '下一年',
      nextMonth: '下一月',
      nextWeek: '下一周',
      nextDay: '下一天',
    },
    /** 「回到今天」按钮 */
    today: '今天',
    /** 搜索入口按钮文本 */
    searchPlaceholder: '搜索事件…',
  },
  en: {
    mode: { month: 'Month', week: 'Week', day: 'Day', year: 'Year', countdown: 'Countdowns' },
    todoMode: { list: 'List', matrix: 'Matrix', kanban: 'Kanban', gantt: 'Gantt', stickies: 'Stickies' },
    nav: {
      prevYear: 'Previous year',
      prevMonth: 'Previous month',
      prevWeek: 'Previous week',
      prevDay: 'Previous day',
      nextYear: 'Next year',
      nextMonth: 'Next month',
      nextWeek: 'Next week',
      nextDay: 'Next day',
    },
    today: 'Today',
    searchPlaceholder: 'Search events…',
  },
} as const
