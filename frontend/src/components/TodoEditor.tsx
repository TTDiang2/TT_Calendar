import { useState } from 'react'
import { Modal, Field } from './ui/Modal'
import { useT, type TxKey } from '../i18n'
import type { TodoList } from '../types'

interface Props {
  todo: { id?: string; list_id: string; title: string; body?: string | null; importance: string; due_date?: string | null; status?: string } | null
  lists: TodoList[]
  onClose: () => void
  onSave: (data: { id?: string; list_id: string; title: string; body: string | null; importance: string; due_date: string | null; status: string }) => void
  onDelete?: (id: string) => void
}

// 重要性三档（高·普通·低）：zh 与 todoDetail.importance.* 逐字一致，复用其 key（labelKey 模式）
const IMPORTANCE_KEYS: Record<string, TxKey> = {
  low: 'todoDetail.importance.low',
  normal: 'todoDetail.importance.normal',
  high: 'todoDetail.importance.high',
}

export function TodoEditor({ todo, lists, onClose, onSave, onDelete }: Props) {
  const t = useT()
  const [title, setTitle] = useState(todo?.title ?? '')
  const [body, setBody] = useState(todo?.body ?? '')
  const [importance, setImportance] = useState(todo?.importance ?? 'normal')
  const [dueDate, setDueDate] = useState(todo?.due_date ?? '')
  const [listId, setListId] = useState(todo?.list_id ?? lists[0]?.id ?? '')
  const [status, setStatus] = useState(todo?.status ?? 'notStarted')

  return (
    <Modal title={todo?.id ? t('todoEditor.title.edit') : t('todoEditor.title.new')} onClose={onClose} width={460}>
      <div className="flex flex-col gap-3">
        <Field label={t('todoEditor.field.title')}>
          <input
            autoFocus
            className="tt-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('todoEditor.field.titlePlaceholder')}
          />
        </Field>
        <Field label={t('todoEditor.field.body')}>
          <textarea className="tt-input min-h-[60px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('todoEditor.field.bodyPlaceholder')} />
        </Field>
        <div className="flex gap-2">
          <Field label={t('todoEditor.field.list')}>
            <select className="tt-input" value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.display_name}</option>
              ))}
            </select>
          </Field>
          <Field label={t('todoEditor.field.importance')}>
            <select className="tt-input" value={importance} onChange={(e) => setImportance(e.target.value)}>
              {Object.entries(IMPORTANCE_KEYS).map(([k, key]) => (
                <option key={k} value={k}>{t(key)}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex gap-2">
          <Field label={t('todoEditor.field.legacyDueDate')}>
            <input type="date" className="tt-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label={t('todoEditor.field.status')}>
            <select className="tt-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="notStarted">{t('todoDetail.status.notStarted')}</option>
              <option value="inProgress">{t('todoDetail.status.inProgress')}</option>
              <option value="completed">{t('todoDetail.status.completed')}</option>
              <option value="waitingOnOthers">{t('todoDetail.status.waitingOnOthers')}</option>
              <option value="deferred">{t('todoDetail.status.deferred')}</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-between items-center pt-2">
          {todo?.id && onDelete ? (
            <button onClick={() => { if (todo.id && onDelete) onDelete(todo.id) }} className="text-sm text-red-500 hover:text-red-600">{t('common.delete')}</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">{t('common.cancel')}</button>
            <button
              onClick={() => onSave({
                id: todo?.id,
                list_id: listId,
                title: title.trim(),
                body: body.trim() || null,
                importance,
                due_date: dueDate || null,
                status,
              })}
              disabled={!title.trim() || !listId}
              className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40"
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
