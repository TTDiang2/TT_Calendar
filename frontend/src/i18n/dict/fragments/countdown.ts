/**
 * countdown 命名空间（老端版）：CountdownView.tsx —— 倒数日视图全部前端文案
 * （左侧分类栏 / 卡片 / 右侧详情面板）。
 * category* 五条沿 Neo 端 countdown.ts（分类是持久化存储值，显示经CATEGORY_LABEL_KEYS
 * 映射，未知分类原样显示，手册 §5.1）；卡片与详情面板为老端独有 UI，en 自拟。
 *
 * 后端中文串边界（本批原样渲染、不抽，批③/Python 侧改结构化，手册 §2 决策 #10）：
 *  - item.display：build_countdown_list 拼好的展示行（如「距离生日还有 3 天」）
 *  - item.next_date / 侧栏 countdown text（App 传入的 countdownData.text）
 */
export const countdown = {
  zh: {
    /** 左分类栏「全部」入口 */
    all: '全部',
    /** 左分类栏底部「新建倒数日」按钮 + 详情面板新建态标题（两处同文） */
    createNew: '新建倒数日',
    /** 详情面板编辑态标题 */
    editTitle: '倒数日设置',
    /** 视图标题：选中分类时的「倒数日 · {cat}」整句（cat 已按语言映射） */
    titleWithCat: '倒数日 · {cat}',
    /** 视图头部「新建」按钮 */
    createShort: '新建',
    /** 列表空态提示 */
    empty: '暂无倒数日，点「新建」添加',
    banner: {
      today: '🎉 今天是「{name}」',
      until: '距离「{name}」还有 {n} 天',
      passed: '「{name}」已过 {n} 天',
      empty: '暂无倒数日',
    },
    label: {
      years: '{n} 周年',
      thisYear: '今年',
      lunarAnniv: '农历周年',
      days: '{n} 天',
    },
    /** 删除确认（confirm 弹窗） */
    confirmDelete: '删除该倒数日？',

    /** ── 卡片上的状态行与角标 ──────────────────────────── */
    cardToday: '🎉 就是今天',
    /** 已过且永不失效 */
    cardPassedNever: '已过 · 永久纪念',
    /** 已过 N 天（复数条目：en day/days） */
    cardPassed: { other: '已过 {n} 天' },
    /** 还有 N 天（复数条目：en day/days） */
    cardLeft: { other: '还有 {n} 天' },
    /** 每年重置图标的 title（按公历） */
    repeatYearlySolar: '每年重置',
    /** 每年重置图标的 title（按农历） */
    repeatYearlyLunar: '按农历每年重置',
    /** 农历重复角标文本 */
    lunarBadge: '农历',
    /** 农历重复角标的 title */
    lunarBadgeTitle: '农历重复',
    /** 里程碑图标 title */
    milestoneTitle: '自动计算里程碑',
    /** 永不过期图标 title */
    neverTitle: '永不过期',

    /** ── 详情面板表单 ──────────────────────────────────── */
    fieldName: '名称',
    placeholderName: '如：生日 / 结婚纪念日',
    fieldCategory: '分类',
    placeholderCustomCat: '输入自定义分类名',
    /** 自定义分类输入态的「返回」按钮 */
    back: '返回',
    /** 分类下拉的「+ 自定义…」选项 */
    optionCustom: '+ 自定义…',
    /** 基准日期字段（开了每年重置/里程碑时） */
    fieldBaseDate: '基准日期',
    /** 普通日期字段 */
    fieldDate: '日期',
    repeatYearlyLabel: '每年重置（生日/节日）',
    repeatRule: '重复规则',
    ruleSolar: '按公历（每年同月日）',
    ruleLunar: '按农历（春节/七夕等）',
    fieldMilestone: '自动计算纪念日（逗号分隔天数）',
    /** 里程碑输入框下的说明 */
    milestoneHint: '从基准日期起自动生成百天/周年等特殊日子，显示最近的下一个。',
    neverExpireLabel: '过期后不显示「已过」',
    fieldNotes: '备注',
    placeholderNotes: '可选',
    /** 详情面板提交按钮（新建态） */
    createBtn: '创建',

    /** ── 固定分类的显示名（存储值保持中文常量，显示按语言映射） ── */
    categoryBirthday: '生日',
    categoryAnniversary: '纪念日',
    categoryFestival: '节日',
    categoryImportant: '重要事件',
    categoryOther: '其他',
  },
  en: {
    all: 'All',
    createNew: 'New countdown',
    editTitle: 'Countdown settings',
    titleWithCat: 'Countdowns · {cat}',
    createShort: 'New',
    empty: 'No countdowns yet — tap "New" to add one',
    banner: {
      today: '🎉 Today is "{name}"',
      until: '{n} days until "{name}"',
      passed: '"{name}" was {n} days ago',
      empty: 'No countdowns yet',
    },
    label: {
      years: '{n} year anniversary',
      thisYear: 'This year',
      lunarAnniv: 'Lunar anniversary',
      days: '{n} days',
    },
    confirmDelete: 'Delete this countdown?',

    cardToday: '🎉 Today is the day',
    cardPassedNever: 'Passed · kept forever',
    cardPassed: {
      one: '{n} day ago',
      other: '{n} days ago',
    },
    cardLeft: {
      one: '{n} day left',
      other: '{n} days left',
    },
    repeatYearlySolar: 'Resets yearly',
    repeatYearlyLunar: 'Resets yearly (lunar)',
    lunarBadge: 'Lunar',
    lunarBadgeTitle: 'Repeats on the lunar calendar',
    milestoneTitle: 'Auto-computed milestones',
    neverTitle: 'Never expires',

    fieldName: 'Name',
    placeholderName: 'e.g. Birthday / Wedding anniversary',
    fieldCategory: 'Category',
    placeholderCustomCat: 'Enter a custom category',
    back: 'Back',
    optionCustom: '+ Custom…',
    fieldBaseDate: 'Base date',
    fieldDate: 'Date',
    repeatYearlyLabel: 'Reset yearly (birthdays/holidays)',
    repeatRule: 'Repeat rule',
    ruleSolar: 'Solar (same month/day each year)',
    ruleLunar: 'Lunar (Spring Festival, Qixi, etc.)',
    fieldMilestone: 'Auto milestones (comma-separated days)',
    milestoneHint: 'Generates special days like day 100 and yearly anniversaries from the base date, and shows the next upcoming one.',
    neverExpireLabel: 'Hide "passed" after expiry',
    fieldNotes: 'Notes',
    placeholderNotes: 'Optional',
    createBtn: 'Create',

    categoryBirthday: 'Birthday',
    categoryAnniversary: 'Anniversary',
    categoryFestival: 'Festival',
    categoryImportant: 'Important event',
    categoryOther: 'Other',
  },
} as const
