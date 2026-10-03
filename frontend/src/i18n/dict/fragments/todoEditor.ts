/**
 * todoEditor 命名空间（老端版）：TodoEditor.tsx —— 旧版待办简表单弹窗。
 *
 * 台账登记（沿 Neo todoEditor.ts 先例）：TodoEditor.tsx 在老端仓库内无任何引用
 * （grep import 为 0，疑似遗留组件），仍按抽词规范完成抽词、不删除。
 *
 * 词表说明：
 *  - 重要性三档（高·普通·低）与状态五档（未开始/进行中/已完成/等待他人/已推迟）
 *    zh 与 todoDetail.importance.* / todoDetail.status.* 逐字一致，直接复用，
 *    不在本命名空间另造一套（Neo 复用 todo.status.* 同理）；
 *  - 通用按钮复用 common.delete/cancel/save；
 *  - 「到期日」沿 Neo 命名 field.legacyDueDate（旧编辑器措辞，详情面板是「截止日期」）。
 */
export const todoEditor = {
  zh: {
    /** 弹窗标题（编辑/新建两态） */
    title: {
      edit: '编辑待办',
      new: '新建待办',
    },
    /** 表单字段标签/占位（旧简表单措辞） */
    field: {
      title: '标题',
      /** 标题输入占位符 */
      titlePlaceholder: '任务标题',
      body: '备注',
      /** 备注输入占位符 */
      bodyPlaceholder: '可选',
      list: '列表',
      importance: '重要性',
      /** 旧编辑器的截止日措辞（详情面板是「截止日期」，分叉不合并） */
      legacyDueDate: '到期日',
      status: '状态',
    },
  },
  en: {
    title: {
      edit: 'Edit to-do',
      new: 'New to-do',
    },
    field: {
      title: 'Title',
      titlePlaceholder: 'Task title',
      body: 'Notes',
      bodyPlaceholder: 'Optional',
      list: 'List',
      importance: 'Importance',
      legacyDueDate: 'Due date',
      status: 'Status',
    },
  },
} as const
