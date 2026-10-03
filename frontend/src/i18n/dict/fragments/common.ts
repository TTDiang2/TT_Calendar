/**
 * common 命名空间：跨组件通用的基础文案（老端版）。
 * fragment 结构（抽词规范，沿 Neo 端）：每个命名空间一个文件，同时导出 zh 与 en 两份。
 * zh 必须是老端原文（两端文案有分叉的以老端为准，不回抄 Neo）。
 *
 * 台账 C4 禁令：daysAfter/daysBefore 仅限 i18n-runtime 测试脚手架，
 * 禁止接入 UI 相对天数显示（手册 §8.10，唯一正路是 format.ts 的 fmtRelativeDays）。
 */
export const common = {
  zh: {
    confirm: '确认',
    cancel: '取消',
    save: '保存',
    close: '关闭',
    delete: '删除',
    add: '添加',
    loading: '加载中…',
    /** 相对天数（仅测试脚手架；UI 禁用，见台账 C4 / 手册 §8.10） */
    daysAfter: { other: '{n} 天后' },
    daysBefore: { other: '{n} 天前' },
  },
  en: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
    delete: 'Delete',
    add: 'Add',
    loading: 'Loading…',
    daysAfter: { one: 'In {n} day', other: 'In {n} days' },
    daysBefore: { one: '{n} day ago', other: '{n} days ago' },
  },
}
