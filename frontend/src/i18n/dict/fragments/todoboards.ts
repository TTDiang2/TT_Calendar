/**
 * todoboards 命名空间（老端版）：todo/ 目录六个子视图（矩阵/看板/甘特/今日/便签）
 * + TodoMiniCard 的板级文案。key 命名与 en 沿 Neo todo.ts 对应分组（matrix/kanban/
 * gantt/today/stickies/aria/card）复用；zh 分叉处以老端原文为准，老端独有渲染 en 自拟。
 *
 * 与 Neo 的结构差异（老端渲染点不同，逐处登记）：
 *  - today 分支由原「量筒（今日拾贝）」改写而来：玻璃罐/磐石/沙砾的隐喻全部去掉，
 *    只保留「今日装了多少、完成多少」这一层意思，文案随之重新起（不再有
 *    carried/settled/tagline/legend* 等罐子专属词条）；
 *  - kanban 已完成列头内嵌高亮计数 span，completed 存前缀词（Neo completedCol 为
 *    整句，不采——同上 §8.6）；
 *  - gantt 月份刻度保留手拼「{n} 月」（含数字两侧空格，老端原文；Neo 走 Intl 会
 *    去空格，zh 逐屏一致红线不采，留待 P5 统一裁决）；
 *  - today 日期行改走 Intl（fmtDate/fmtWeekday，zh 输出「10月3日 · 周六」与手拼
 *    逐字一致，node 实测核对），沿 Neo「原 M月d日 · 周X 手写格式删除」先例，
 *    原 WEEKDAY 模块常量表随之删除。
 * 卡片级旧词表 todo.card.*（批③已注册）经 utils/todoLogic 的 KEYS+labelOf 继续服务
 * 看板列头/迷你卡元信息行/甘特条 title，本命名空间不重复注册。
 */
export const todoboards = {
  zh: {
    /** 各视图共用空态（看板/甘特） */
    empty: { none: '暂无待办' },
    /** 矩阵视图 */
    matrix: {
      /** 四象限（key 命名沿 Neo quadrant.*，zh 逐字一致） */
      quadrant: {
        doNow: { title: '重要 × 紧急', action: '立即做', desc: '今天必须推进的事' },
        planIt: { title: '重要 × 不紧急', action: '规划做', desc: '矩阵的核心价值区：别让它变成紧急' },
        delegate: { title: '不重要 × 紧急', action: '快速清', desc: '碎片打断：批量快速处理' },
        drop: { title: '不重要 × 不紧急', action: '有空做', desc: '不占用最佳精力，有空再说' },
      },
      /** 象限头的临近徽标（title 提示 + 计数，数字做主语 → 复数） */
      soonTitle: '3-7 天内到期',
      nearing: { other: '{n} 临近' },
      /** 四象限顶部的一句话坐标轴提示（不参与布局，仅帮助首次使用者） */
      axisHint: '纵轴重要 · 横轴紧急',
      /** 卡片副标题的截止描述（复合句成分 → 复数条目而非 fmtRelativeDays） */
      sub: {
        overdueBy: { other: '截止已过 {n} 天' },
        dueToday: '今天截止',
        dueIn: { other: '{n} 天后截止' },
        planned: '计划 {date}',
      },
    },
    /** 看板视图 */
    kanban: {
      /** 维度切换胶囊（按状态/计划日期/重要性/复杂度/标签） */
      dim: { status: '按状态', planned: '按计划日期', importance: '按重要性', complexity: '按复杂度', tag: '按标签' },
      /** 可拖拽时的操作提示（桌面） */
      dragHint: '拖动卡片到其他列即可改变状态；勾选圆形按钮直接完成',
      /** 空列占位 */
      emptyCol: '空',
      /** 空列里的虚线投放区（仅看板可拖拽维度显示） */
      dropHere: '拖到这里',
      /** 工具栏右侧未完成计数（数字在前，如「36 项未完成」） */
      openCount: '项未完成',
      /** 计划日期维度的无日期列头 */
      unplanned: '未计划',
      /** 标签维度的无标签列头 */
      untagged: '无标签',
      /** 计划日期=今天的列头（date 是 MM-DD 数据串） */
      todayCol: '今天 · {date}',
      /** 已完成卡片的副标题（date 是 MM-DD 数据串） */
      doneAt: '完成于 {date}',
      /** 已完成列头/折叠边条前缀（计数是内嵌高亮 span，数字不入串） */
      completed: '已完成',
      /** 折叠边条的 aria-label（共 N 条：数字做状语，不用复数） */
      expandCompleted: '展开已完成列（共 {n} 条）',
      /** 已完成列超过渲染上限时的尾注 */
      shownOf: '已显示最近 {shown} / 共 {total} 条',
    },
    /** 甘特视图 */
    gantt: {
      /** 月份刻度（n 是月份数字；老端手拼含空格，不走 Intl——见文件头） */
      month: '{n} 月',
      /** 逾期条内的文字 */
      overdueBar: '逾期中',
      /** 条的 hover title（range=起止串，overdue=逾期后缀或空，status=状态译文） */
      barTitle: '{range}{overdue} · {status}',
      /** barTitle 里逾期时插入的后缀（插在区间与 · 之间，保留原版位置） */
      overdueSuffix: '（已过期）',
      /** 时间轴缩放档位 */
      scale2w: '2 周',
      scale1m: '1 个月',
      scale3m: '3 个月',
      /** 回到今天按钮 / 今天刻度气泡 */
      today: '回到今天',
      todayChip: '今天',
      /** 未排期抽屉与空状态 */
      unscheduled: '未排期',
      unscheduledCount: '未排期 · {n}',
      unscheduledHint: '没有计划日期的待办收在这里',
      emptyTitle: '还没有排期的待办',
      emptyHint: '在待办详情里补上计划日或截止日，它就会出现在这里',
    },
    /** 今日视图（原「今日拾贝」）——去掉玻璃罐隐喻，就是一页今日统计 */
    today: {
      /** 左上小标题，同时也是 TopBar 里的视图名 */
      title: '今日',
      /** 计数单位（「14 件」） */
      piece: '件',
      /** 环形进度中心：完成 3 / 14 */
      doneOf: '完成 {done} / {total}',
      /** 负载行标签 */
      load: '负载',
      /** 超出容量的徽标（{n} 为件数） */
      overCapacity: '超出 {n} 件',
      /** 折叠区标题 */
      doneToday: '今日完成 {n}',
      /** 环形图的 role=img aria-label */
      ringAria: '今日完成进度',
      /** 空态主句 + 提示 */
      empty: '今天还没有安排',
      emptyHint: '把截止日或计划日设为今天，它就会出现在这里',
    },
    /** 便签墙视图 */
    stickies: {
      /** 空态主句 + 提示 */
      empty: '墙上一张便签都没有',
      emptyHint: '点「新建待办」贴上第一张',
      /** 便签卡 hover 提示（title 属性） */
      dblClickHint: '双击查看 / 编辑备注',
    },
    /** 无障碍标签（迷你卡勾选圈，切换完成态） */
    aria: {
      markDone: '标记为已完成',
      markUndone: '标记为未完成',
    },
    /** 迷你卡（看板/矩阵共用卡片） */
    card: {
      /** 逾期徽标（数字做主语 → 复数） */
      overdueBy: { other: '逾期 {n} 天' },
      /** 今天到期徽标 */
      today: '今天',
      /** 元信息行的日期前缀（date 是 MM-DD 数据串，非翻译对象） */
      due: '截止 {date}',
      planned: '计划 {date}',
      start: '开始 {date}',
    },
  },
  en: {
    empty: { none: 'No to-dos' },
    matrix: {
      quadrant: {
        doNow: { title: 'Important × Urgent', action: 'Do now', desc: 'Things that must move today' },
        planIt: { title: 'Important × Not urgent', action: 'Schedule', desc: 'The core of the matrix: don\'t let it become urgent' },
        delegate: { title: 'Not important × Urgent', action: 'Clear fast', desc: 'Fragmented interruptions: batch and clear quickly' },
        drop: { title: 'Not important × Not urgent', action: 'Spare time', desc: 'Not worth peak energy — do it when free' },
      },
      soonTitle: 'Due in 3-7 days',
      nearing: { one: '1 nearing', other: '{n} nearing' },
      axisHint: 'Vertical: importance · Horizontal: urgency',
      sub: {
        overdueBy: { one: 'Due 1 day ago', other: 'Due {n} days ago' },
        dueToday: 'Due today',
        dueIn: { one: 'Due in 1 day', other: 'Due in {n} days' },
        planned: 'Planned {date}',
      },
    },
    kanban: {
      dim: { status: 'By status', planned: 'By planned date', importance: 'By importance', complexity: 'By complexity', tag: 'By tag' },
      dragHint: 'Drag cards between columns to change status; tick the circle to complete',
      emptyCol: 'Empty',
      dropHere: 'Drop here',
      openCount: 'open',
      unplanned: 'Unplanned',
      untagged: 'No tag',
      todayCol: 'Today · {date}',
      doneAt: 'Done {date}',
      completed: 'Completed',
      expandCompleted: 'Expand completed column ({n} in total)',
      shownOf: 'Showing latest {shown} of {total}',
    },
    gantt: {
      month: 'Month {n}',
      overdueBar: 'Overdue',
      barTitle: '{range}{overdue} · {status}',
      overdueSuffix: ' (overdue)',
      scale2w: '2 weeks',
      scale1m: '1 month',
      scale3m: '3 months',
      today: 'Today',
      todayChip: 'Today',
      unscheduled: 'Unscheduled',
      unscheduledCount: 'Unscheduled · {n}',
      unscheduledHint: 'To-dos without a plan or due date live here',
      emptyTitle: 'Nothing scheduled yet',
      emptyHint: 'Add a planned or due date in a to-do to see it here',
    },
    today: {
      title: 'TODAY',
      piece: 'items',
      doneOf: '{done} / {total} done',
      load: 'Load',
      overCapacity: '{n} over capacity',
      doneToday: '{n} done today',
      ringAria: 'Today\'s completion',
      empty: 'Nothing planned for today',
      emptyHint: 'Set a due or planned date to today and it shows up here',
    },
    stickies: {
      empty: 'The wall has no stickies yet',
      emptyHint: 'Tap "New to-do" to pin the first one',
      dblClickHint: 'Double-click to view / edit notes',
    },
    aria: {
      markDone: 'Mark as done',
      markUndone: 'Mark as not done',
    },
    card: {
      overdueBy: { one: 'Overdue by 1 day', other: 'Overdue by {n} days' },
      today: 'Today',
      due: 'Due {date}',
      planned: 'Planned {date}',
      start: 'Start {date}',
    },
  },
} as const
