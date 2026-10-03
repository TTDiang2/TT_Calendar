/**
 * errors 命名空间（老端版）：前端 API 层结构化错误码 → 显示文案（手册决策 #10：
 * domain/后端层零文案；任务批③口径：用户可见的错误消息改「错误码 + 前端按码翻译」）。
 * 码表见 api/client.ts syncNow（`sync_failed:<status>`，翻译消费方 SettingsDialog）。
 * 后端返回的 detail 字符串原样透传（后端数据，Python 侧勘察清单已登记）。
 */
export const errors = {
  zh: {
    /** syncNow 非 409 失败兜底（原为抛「同步失败（{status}）」中文串，UI 经 String(e) 直显） */
    syncFailed: '同步失败（{status}）',
  },
  en: {
    syncFailed: 'Sync failed ({status})',
  },
} as const
