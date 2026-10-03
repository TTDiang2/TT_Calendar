/**
 * stats 命名空间（老端版）：StatsView.tsx —— 统计页全部文案。
 * 老端统计页是简版（概览卡 + 四象限散点 + 逐日完成折线 + 列表分布），与 Neo 的
 * stats.ts（里程碑/热力图/忙度预测富版）不是同一页面：仅 quadrant.* 一组沿 Neo
 * 复用（key 命名与 en 直接复用；zh 逐字一致——Neo 当初为逐屏保真也刻意保留了
 * 「紧急·重要」式中点角标词表）；其余为老端独有，en 自拟。
 * zh 分叉处（逐屏一致红线，不回抄 Neo）：
 *  - quadrant.axes 老端在「→」后有一个全角空格（U+3000，Neo 无），逐字保留；
 *  - 日期头部大字行/小字行走具名插值保留手拼空格（{m} 月 {d} 日），未走 Intl——
 *    Intl 会去掉数字两侧空格（zh 展示差异），老端本批不做该裁决。
 * 「加载中…」复用 common.loading，不在本命名空间重复。
 */
export const stats = {
  zh: {
    /** 页面标题（BarChart3 图标后） */
    title: '统计',
    /** 概览四卡（StatCard 行标） */
    cards: {
      total: '总待办',
      incomplete: '未完成',
      completed: '已完成',
      /** 近 90 天完成总数（数字由 daily_done 折算，无空格是老端原文） */
      last90: '近90天完成',
    },
    /** 待办四象限散点 */
    quadrant: {
      title: '待办四象限',
      /** 轴说明一行（「→」后是全角空格，zh 逐屏一致红线，禁改字符） */
      axes: '横轴：到期紧迫度 →　纵轴：重要性 ↑（点 = 未完成待办）',
      /** 四象限角标（中点式短标，与 Neo stats.quadrant.* 逐字一致） */
      doNow: '紧急·重要',
      planIt: '不紧急·重要',
      delegate: '紧急·次要',
      drop: '不紧急·次要',
      /** 重要性图例（散点颜色） */
      imp: { high: '高', normal: '普通', low: '低' },
      /** 右下计数（数字做主语 → 复数） */
      openCount: { other: '{n} 个未完成' },
      point: {
        /** 散点 hover title（title=待办标题用户数据，due=到期子句） */
        title: '{title}{due}',
        /** 已逾期子句（全角括号随子句走，数字做主语 → 复数） */
        overdue: { other: '（已逾期{n}天）' },
        /** N 天后到期子句 */
        dueIn: { other: '（{n}天后到期）' },
        /** 无到期日子句 */
        noDue: '（无到期日）',
      },
    },
    /** 逐日完成折线图 */
    daily: {
      title: '逐日完成数量（近 90 天）',
      /** 均值参考线角标（n 为 toFixed(1) 的一位小数串，老端原样） */
      avg: '日均 {n}',
      /** 图下峰值角标 */
      peak: '峰值 {n}/天',
    },
    /** 未完成待办按列表分布 */
    dist: {
      title: '未完成待办分布（按列表）',
    },
  },
  en: {
    title: 'Stats',
    cards: {
      total: 'Total',
      incomplete: 'Open',
      completed: 'Done',
      last90: 'Done in 90 days',
    },
    quadrant: {
      title: 'To-do quadrants',
      axes: 'X axis: due urgency → Y axis: importance ↑ (dots = open to-dos)',
      doNow: 'Urgent · Important',
      planIt: 'Not urgent · Important',
      delegate: 'Urgent · Minor',
      drop: 'Not urgent · Minor',
      imp: { high: 'High', normal: 'Normal', low: 'Low' },
      openCount: { one: '1 open', other: '{n} open' },
      point: {
        title: '{title}{due}',
        overdue: { one: ' (overdue by 1 day)', other: ' (overdue by {n} days)' },
        dueIn: { one: ' (due in 1 day)', other: ' (due in {n} days)' },
        noDue: ' (no due date)',
      },
    },
    daily: {
      title: 'Daily completions (last 90 days)',
      avg: 'Avg {n}',
      peak: 'Peak {n}/day',
    },
    dist: {
      title: 'Open to-dos by list',
    },
  },
} as const
