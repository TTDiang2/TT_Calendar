/**
 * language 命名空间：首启动语言选择页 + 设置页语言项（老端版，zh 与 Neo 同文逐字一致）。
 * 语言名本身用 endonym（LANG_META），不进字典。
 */
export const language = {
  zh: {
    /** 首启动语言选择页 */
    title: '选择语言',
    subtitle: '你可以随时在设置中更改',
    start: '开始使用',
    /** 设置页里的语言项标签 */
    settingsLabel: '语言',
  },
  en: {
    title: 'Choose language',
    subtitle: 'You can change this anytime in Settings',
    start: 'Get started',
    settingsLabel: 'Language',
  },
} as const
