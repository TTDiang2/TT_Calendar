/**
 * app 命名空间（老端版）：App.tsx 外壳的用户可见文案——Tauri 关闭前同步对话框。
 * 五条与 Neo 端 app.ts 同源（zh 逐字一致，key 命名与 en 直接复用）。
 * 顶栏年/月标题不走字典：按手册 §2 决策 #7 改走 fmtDate（Intl）；
 * 「加载中…」复用 common.loading。
 */
// TODO-REVIEW: 下方导出的 SYNC_IN_PROGRESS_MARK 不是翻译文案，而是后端「已有同步
// 正在进行中」报错的消息子串——App.tsx 关闭前同步用它做协议匹配（命中 = 已有同步
// 在跑 → 静默退出）。它是 UI 源码内少数豁免中文串棘轮的合法场所（逻辑键，非文案）。
// 建议后续后端改结构化结果码后删除该常量与字符串匹配（对照 Neo app.ts 同名处置）。

/** 协议常量（非文案）：后端并发同步报错的消息子串，见文件头 TODO-REVIEW */
export const SYNC_IN_PROGRESS_MARK = '正在进行'

export const app = {
  zh: {
    /** 关闭前同步进行中对话框的提示正文 */
    syncExiting: '正在同步，同步完成后会自动退出……',
    /** 关闭前同步失败对话框的标题 */
    syncOnCloseFailed: '关闭前同步失败',
    /** 失败对话框的三个操作按钮 */
    retrySync: '重试同步',
    forceQuit: '强制退出',
    cancelClose: '取消关闭',
  },
  en: {
    syncExiting: 'Syncing — the app will quit automatically when finished…',
    syncOnCloseFailed: 'Sync before quit failed',
    retrySync: 'Retry sync',
    forceQuit: 'Force quit',
    cancelClose: 'Cancel quit',
  },
} as const
