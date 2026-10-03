/**
 * palette 命名空间（老端版，沿 Neo palette.ts）：分级图层调色板名。
 * 台账 C2（双盲义务）：data.ts GRADED_PALETTES 的中文对象键（绿/蓝/…）对中文棘轮
 * 三 selector 不可见（对象键是 Identifier 非 Literal），allowlist 脚本也永不收录
 * 该文件——「白名单归零 ≠ 中文清零」。本批已把键改为 ASCII（green/blue/…），
 * 显示名在本命名空间映射（Sidebar 新建图层调色板选择器），色值本身不是文案。
 * 前提已核实：Sidebar 写入 config 的是色值数组（GRADED_PALETTES[key]），键名不持久化。
 */
export const palette = {
  zh: {
    green: '绿',
    blue: '蓝',
    orange: '橙',
    purple: '紫',
    red: '红',
    cyan: '青',
    indigo: '靛',
    gray: '灰',
  },
  en: {
    green: 'Green',
    blue: 'Blue',
    orange: 'Orange',
    purple: 'Purple',
    red: 'Red',
    cyan: 'Cyan',
    indigo: 'Indigo',
    gray: 'Gray',
  },
} as const
