/**
 * calendar 命名空间（老端版）：日历视图组 —— MonthGrid / WeekView / YearView /
 * DayView / DayCell 的句子级文案与状态短词。
 * 星期名（周一…/一…）与日期串（10月 / 9月3日 / 2023年 周日）不走字典：按手册 §2
 * 决策 #7 改走 i18n/format.ts 的 Intl 封装（fmtWeekday/fmtMonthName/fmtDate，带缓存）；
 * 节假日名（day.holiday.name）是后端数据原样渲染；图层名 / 标记 label / 事件标题是
 * 用户数据原样渲染。
 *
 * noData / weekendSuffix / makeUpWorkday / scheduleMore 沿 Neo 端 calendar.ts
 * （zh 逐字一致，key 命名与 en 直接复用）；emptyDay 的 key 名沿 Neo 但 zh 以老端
 * 原文为准（老端「当天无事件」≠ Neo「这天还没有安排」）；其余为老端独有，en 自拟。
 */
export const calendar = {
  zh: {
    /** 日视图当日无任何数据时的整屏空态 */
    noData: '无数据',
    /** 日视图标题第二行的「 · 周末」小字后缀（含前导间隔符） */
    weekendSuffix: ' · 周末',
    /** 月格右上角的「班」角标（调休补班日标记） */
    makeUpWorkday: '班',
    /** 月格日程溢出计数徽标（首条之外还有 N 条） */
    scheduleMore: { other: '+{n} 项日程' },
    /** 日视图信息栏：自定义标记色块前的行首标签 */
    markLabel: '标记',
    /** 日视图信息栏：充实度色档前的行首标签 */
    fullnessLabel: '充实度',
    /** 日视图事件列表空态 */
    emptyDay: '当天无事件',
    /** 日视图多日日程的区间说明：{i}/{total} 为第几天/共几天，{start}~{end} 为起止日期 */
    spanRange: '第 {i}/{total} 天 · {start} ~ {end}',
    /** 月格延续条（多日日程非首日）的 title，{title} 为用户数据 */
    contTitle: '{title}（{i}/{total} 天，{start} 起）',
    /** 月格多日日程首行的 title，{title} 为用户数据 */
    multiDayTitle: '{title}（多日 {start} ~ {end}，共 {total} 天）',
    /** 月格多日日程行尾的延续天数标（含前导空格与 ↦ 符号） */
    spanDays: ' ↦{n}天',
  },
  en: {
    noData: 'No data',
    weekendSuffix: ' · Weekend',
    makeUpWorkday: 'Work',
    scheduleMore: { one: '+{n} more schedule', other: '+{n} more schedules' },
    markLabel: 'Mark',
    fullnessLabel: 'Fullness',
    emptyDay: 'No events this day',
    spanRange: 'Day {i}/{total} · {start} ~ {end}',
    contTitle: '{title} (day {i}/{total}, from {start})',
    multiDayTitle: '{title} (multi-day {start} ~ {end}, {total} days)',
    spanDays: ' ↦{n}d',
  },
} as const
