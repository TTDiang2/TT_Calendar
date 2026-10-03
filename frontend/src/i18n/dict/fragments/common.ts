/**
 * common 命名空间：跨组件通用的基础文案（老端版）。
 * fragment 结构（抽词规范，沿 Neo 端）：每个命名空间一个文件，同时导出 zh 与 en 两份——
 * 抽词批次与翻译 en 一步到位。zh 必须是老端原文（两端文案有分叉的以老端为准，不回抄 Neo）。
 * P0 骨架：仅含 i18n-runtime 测试所需的最小键集；A2 抽词按批次充实。
 */
export const common = {
  zh: {
    confirm: '确认',
    /** 相对天数（zh 无复数变体；数值已由 Intl.RelativeTimeFormat 承担的不要用这里） */
    daysAfter: { other: '{n} 天后' },
    daysBefore: { other: '{n} 天前' },
  },
  en: {
    confirm: 'Confirm',
    daysAfter: { one: 'In {n} day', other: 'In {n} days' },
    daysBefore: { one: '{n} day ago', other: '{n} days ago' },
  },
}
