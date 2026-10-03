/**
 * sourceFields 命名空间（老端版）：SourceFields.tsx 的 ImportanceDots 星级 hover
 * 提示（title 属性）。字段 label/徽标文案（今值/预测值/▲超预期…）是后端插件
 * field_specs 下发的数据（SourceFieldSpec），原样渲染不抽词（手册 §5.1，
 * Python 侧勘察清单已登记）。
 */
export const sourceFields = {
  zh: {
    /** 星级容器 title（stars 为实星串「★★」或 unknown 词；「重要性 」后带半角空格是老端原文） */
    importanceTitle: '重要性 {stars}',
    /** 无实星时的兜底词 */
    unknown: '未知',
  },
  en: {
    importanceTitle: 'Importance {stars}',
    unknown: 'Unknown',
  },
} as const
