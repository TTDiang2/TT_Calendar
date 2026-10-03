/**
 * terms 命名空间：跨模块共用的产品名词（冻结术语，老端版）。
 * key 命名与 en 沿 Neo 端 terms.ts 复用；zh 以老端原文为准（本批四词两端逐字一致）。
 * 老端当前只用到这四个词，后续批次按需扩充。
 */
export const terms = {
  zh: {
    /** 顶栏一级 tab：日历 */
    calendar: '日历',
    /** 顶栏一级 tab：待办 */
    todo: '待办',
    /** 倒数日（视图模式/视图标题） */
    countdown: '倒数日',
    /** 订阅（顶栏按钮 title、侧栏订阅分组标题） */
    subscription: '订阅',
  },
  en: {
    calendar: 'Calendar',
    todo: 'To-dos',
    countdown: 'Countdowns',
    subscription: 'Subscriptions',
  },
} as const
