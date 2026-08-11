import { useState } from 'react'
import { Modal, Field } from './ui/Modal'
import type { TodoList } from '../types'

interface Props {
  todo: { id?: string; list_id: string; title: string; body?: string | null; importance: string; due_date?: string | null; status?: string } | null
  lists: TodoList[]
  onClose: () => void
  onSave: (data: { id?: string; list_id: string; title: string; body: string | null; importance: string; due_date: string | null; status: string }) => void
  onDelete?: (id: string) => void
}

const IMPORTANCE_LABELS: Record<string, string> = { low: '低', normal: '普通', high: '高' }

export function TodoEditor({ todo, lists, onClose, onSave, onDelete }: Props) {
  const [title, setTitle] = useState(todo?.title ?? '')
  const [body, setBody] = useState(todo?.body ?? '')
  const [importance, setImportance] = useState(todo?.importance ?? 'normal')
  const [dueDate, setDueDate] = useState(todo?.due_date ?? '')
  const [listId, setListId] = useState(todo?.list_id ?? lists[0]?.id ?? '')
  const [status, setStatus] = useState(todo?.status ?? 'notStarted')

  return (
    <Modal title={todo?.id ? '编辑待办' : '新建待办'} onClose={onClose} width={460}>
      <div className="flex flex-col gap-3">
        <Field label="标题">
          <input
            autoFocus
            className="tt-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="任务标题"
          />
        </Field>
        <Field label="备注">
          <textarea className="tt-input min-h-[60px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="可选" />
        </Field>
        <div className="flex gap-2">
          <Field label="列表">
            <select className="tt-input" value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.display_name}</option>
              ))}
            </select>
          </Field>
          <Field label="重要性">
            <select className="tt-input" value={importance} onChange={(e) => setImportance(e.target.value)}>
              {Object.entries(IMPORTANCE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex gap-2">
          <Field label="到期日">
            <input type="date" className="tt-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="状态">
            <select className="tt-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="notStarted">未开始</option>
              <option value="inProgress">进行中</option>
              <option value="completed">已完成</option>
              <option value="waitingOnOthers">等待他人</option>
              <option value="deferred">已推迟</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-between items-center pt-2">
          {todo?.id && onDelete ? (
            <button onClick={() => { if (todo.id && onDelete) onDelete(todo.id) }} className="text-sm text-red-500 hover:text-red-600">删除</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
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
              保存
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
