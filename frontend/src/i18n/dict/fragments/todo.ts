/**
 * todo 命名空间（老端版）：todo 视图组共用词表。本批只落 card.* 三张旧词表
 * （utils/todoLogic.ts 的 IMPORTANCE/COMPLEXITY/STATUS 表改 labelKey 模式后的落点，
 * 消费方：TodoKanbanView 列头、TodoMiniCard 元信息行、TodoGanttView 条 title）。
 * key 命名与 en 沿 Neo todo.ts 的 card.* 复用（zh 逐字一致：等他人/高·中·低/
 * 困难·中等·简单——与 todoDetail.status.* / importance.* / complexity.* 是并存的不同
 * 词表，为逐屏一致各自成组，后续措辞裁决另做）。
 * 老端 todo 视图本体（TodoView 与 todo 目录下视图）尚未抽词，后续批次按需扩充本命名空间。
 */
export const todo = {
  zh: {
    /** 卡片级词表（看板列头/迷你卡/甘特条 title，zh 与旧版 todoLogic 词表逐字一致） */
    card: {
      status: {
        notStarted: '未开始',
        inProgress: '进行中',
        waitingOnOthers: '等他人',
        deferred: '已推迟',
        completed: '已完成',
      },
      importance: { high: '高', normal: '中', low: '低' },
      complexity: { hard: '困难', medium: '中等', simple: '简单' },
    },
  },
  en: {
    card: {
      status: {
        notStarted: 'Not started',
        inProgress: 'In progress',
        waitingOnOthers: 'Waiting',
        deferred: 'Deferred',
        completed: 'Done',
      },
      importance: { high: 'High', normal: 'Med', low: 'Low' },
      complexity: { hard: 'Hard', medium: 'Medium', simple: 'Easy' },
    },
  },
} as const
