import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import type { Todo, TodoList } from '../types'
import { NotesEditorModal } from './NotesEditorModal'

interface Props {
  todo: Todo | null
  lists: TodoList[]
  onClose: () => void
  onSave: (data: Todo) => void
  onDelete: (id: string) => void
}

export interface TodoDetailPanelRef {
  openNotes: () => void
}

const IMPORTANCE_OPTIONS: { key: string; label: string }[] = [
  { key: 'high', label: '高' },
  { key: 'normal', label: '普通' },
  { key: 'low', label: '低' },
]

const STATUS_OPTIONS: { key: string; label: string }[] = [
  { key: 'notStarted', label: '未开始' },
  { key: 'inProgress', label: '进行中' },
  { key: 'completed', label: '已完成' },
  { key: 'waitingOnOthers', label: '等待他人' },
  { key: 'deferred', label: '已推迟' },
]

const COMPLEXITY_OPTIONS: { key: string; label: string }[] = [
  { key: 'simple', label: '简单' },
  { key: 'medium', label: '中等' },
  { key: 'hard', label: '复杂' },
]

export const TodoDetailPanel = forwardRef<TodoDetailPanelRef, Props>(function TodoDetailPanel(
  { todo, lists, onClose, onSave, onDelete },
  ref,
) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [importance, setImportance] = useState('normal')
  const [dueDate, setDueDate] = useState('')
  const [plannedDate, setPlannedDate] = useState('')
  const [startDate, setStartDate] = useState('')
  const [complexity, setComplexity] = useState('medium')
  const [tagsText, setTagsText] = useState('')
  const [notesModalOpen, setNotesModalOpen] = useState(false)
  const [listId, setListId] = useState('')
  const [status, setStatus] = useState('notStarted')
  const [dueExpanded, setDueExpanded] = useState(false)

  useImperativeHandle(ref, () => ({
    openNotes: () => setNotesModalOpen(true),
  }))
  const [plannedExpanded, setPlannedExpanded] = useState(false)

  const formRef = useRef({ title, body, importance, dueDate, plannedDate, startDate, complexity, tagsText, listId, status })
  formRef.current = { title, body, importance, dueDate, plannedDate, startDate, complexity, tagsText, listId, status }

  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const prevTodoRef = useRef<Todo | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  useEffect(() => {
    const prev = prevTodoRef.current
    prevTodoRef.current = todo
    setSaving(false)
    savingRef.current = false

    const prevId = prev?.id ?? null
    const curId = todo?.id ?? null
    const prevIsReal = prev != null && prev.id != null && prev.id !== '__NEW__'
    if (prevIsReal && prevId !== curId) {
      const f = formRef.current
      const tags = f.tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      const changed =
        f.title !== prev.title ||
        (f.body || '') !== (prev.body ?? '') ||
        f.importance !== prev.importance ||
        (f.dueDate || '') !== (prev.due_date ?? '') ||
        (f.plannedDate || '') !== (prev.planned_date ?? '') ||
        (f.startDate || '') !== (prev.start_date ?? '') ||
        f.complexity !== (prev.complexity || 'medium') ||
        JSON.stringify(tags) !== JSON.stringify(prev.tags ?? []) ||
        f.listId !== prev.list_id ||
        f.status !== prev.status
      if (f.title.trim() && changed) {
        onSaveRef.current({
          ...prev,
          title: f.title.trim(),
          body: f.body.trim() || null,
          importance: f.importance,
          due_date: f.dueDate || null,
          planned_date: f.plannedDate || null,
          start_date: f.startDate || null,
          complexity: f.complexity,
          tags: tags.length ? tags : null,
          list_id: f.listId,
          status: f.status,
        })
      }
    }

    if (todo) {
      setTitle(todo.title)
      setBody(todo.body ?? '')
      setImportance(todo.importance)
      setDueDate(todo.due_date ?? '')
      setPlannedDate(todo.planned_date ?? '')
      setStartDate(todo.start_date ?? '')
      setComplexity(todo.complexity || 'medium')
      setTagsText((todo.tags ?? []).join(', '))
      setListId(todo.list_id)
      setStatus(todo.status)
      setDueExpanded(false)
      setPlannedExpanded(false)
    }
  }, [todo?.id])

  if (!todo) {
    return (
      <aside className="w-72 bg-white border-l border-gray-200 p-4">
        <p className="text-sm text-gray-400">点击待办查看详情</p>
      </aside>
    )
  }

  const tags = tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean)

  // 构造完整保存数据（与 useEffect 自动保存的字段一一对应）
  const buildData = (): Todo => ({
    ...todo!,
    title: title.trim(),
    body: body.trim() || null,
    importance,
    due_date: dueDate || null,
    planned_date: plannedDate || null,
    start_date: startDate || null,
    complexity,
    tags: tags.length ? tags : null,
    list_id: listId,
    status,
  })

  // 显式保存：保存并关闭面板（切走时仍有自动保存兜底）
  const save = () => {
    if (savingRef.current) return
    if (!title.trim() || !listId) return
    savingRef.current = true
    setSaving(true)
    onSave(buildData())
    onClose()
  }

  return (
    <aside
      className="w-72 bg-white border-l border-gray-200 flex flex-col overflow-hidden"
      onKeyDown={(e) => {
        // Ctrl/Cmd + Enter 直接保存（新建待办时同样生效）
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault()
          if (title.trim() && listId && !savingRef.current) save()
        }
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <p className="text-xs text-gray-400 uppercase tracking-wide">待办详情</p>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600" title="关闭">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <textarea
          autoFocus
          rows={2}
          className="w-full text-base font-medium border-0 border-b border-transparent hover:border-gray-200 focus:border-blue-400 focus:outline-none py-1 resize-none break-words whitespace-pre-wrap"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题"
        />

        <textarea
          className="w-full text-sm border border-gray-200 rounded-md p-2 min-h-[80px] focus:border-blue-400 focus:outline-none resize-y cursor-text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onDoubleClick={() => setNotesModalOpen(true)}
          title="双击放大编辑"
          placeholder="备注（可选）"
        />

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            <span className="block mb-1">列表</span>
            <select className="tt-input" value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.display_name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            <span className="block mb-1">重要性</span>
            <select className="tt-input" value={importance} onChange={(e) => setImportance(e.target.value)}>
              {IMPORTANCE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className={clsx('text-xs text-gray-500', dueExpanded && 'col-span-2', plannedExpanded && 'hidden')}>
            <span className="block mb-1">截止日期</span>
            <DueDateQuickPicker value={dueDate} onChange={setDueDate} expanded={dueExpanded} setExpanded={setDueExpanded} />
          </label>
          <label className={clsx('text-xs text-gray-500', plannedExpanded && 'col-span-2', dueExpanded && 'hidden')}>
            <span className="block mb-1">计划日期</span>
            <DueDateQuickPicker value={plannedDate} onChange={setPlannedDate} expanded={plannedExpanded} setExpanded={setPlannedExpanded} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            <span className="block mb-1">开始日</span>
            <input type="date" className="tt-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="text-xs text-gray-500">
            <span className="block mb-1">复杂度</span>
            <select className="tt-input" value={complexity} onChange={(e) => setComplexity(e.target.value)}>
              {COMPLEXITY_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            <span className="block mb-1">状态</span>
            <select className="tt-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="text-xs text-gray-500 block">
          <span className="block mb-1">标签（逗号分隔，自定义）</span>
          <input
            className="tt-input"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="工作, 学习, 家庭…"
          />
          {tags.length > 0 && (
            <span className="flex flex-wrap gap-1 mt-1.5">
              {tags.map((t) => (
                <span key={t} className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{t}</span>
              ))}
            </span>
          )}
        </label>
      </div>

      <div className="px-4 py-3 border-t border-gray-100 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => {
              if (confirm(`删除待办「${todo.title}」？`)) onDelete(todo.id)
            }}
            className="flex items-center gap-1 text-sm text-red-500 hover:text-red-600 whitespace-nowrap"
          >
            <Trash2 size={14} /> 删除
          </button>
          <button
            onClick={save}
            disabled={!title.trim() || !listId || saving}
            className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40 whitespace-nowrap"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 text-right leading-none whitespace-nowrap">
          切换页面自动保存 · <span className="font-medium text-gray-500">Ctrl+Enter</span> 直接保存
        </p>
      </div>
      <NotesEditorModal
        open={notesModalOpen}
        initialValue={body}
        title={title || '备注'}
        onClose={(next) => {
          setBody(next)
          setNotesModalOpen(false)
        }}
      />
    </aside>
  )
})

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nextMonday(): Date {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? 1 : 8 - day
  d.setDate(d.getDate() + diff)
  return d
}

function DueDateQuickPicker({
  value,
  onChange,
  expanded,
  setExpanded,
}: {
  value: string
  onChange: (v: string) => void
  expanded: boolean
  setExpanded: (v: boolean) => void
}) {
  const today = fmtDate(new Date())
  const tomorrow = fmtDate(new Date(Date.now() + 86400000))
  const monday = fmtDate(nextMonday())

  if (expanded) {
    return (
      <div className="flex gap-1">
        <input type="date" className="tt-input flex-1" value={value} onChange={(e) => onChange(e.target.value)} autoFocus />
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="px-2 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-md"
        >
          返回
        </button>
      </div>
    )
  }

  const presets = [
    { key: 'today', label: '今天', val: today },
    { key: 'tomorrow', label: '明天', val: tomorrow },
    { key: 'monday', label: '下周一', val: monday },
  ]
  const matched = presets.find((p) => p.val === value)
  const label = value ? (matched ? matched.label : value.slice(5)) : '无'

  return (
    <select
      className="tt-input"
      value={matched ? matched.key : (value ? value : '__none__')}
      onChange={(e) => {
        if (e.target.value === '__none__') onChange('')
        else if (e.target.value === '__custom__') setExpanded(true)
        else if (presets.find((x) => x.key === e.target.value)) {
          onChange(presets.find((x) => x.key === e.target.value)!.val)
        }
      }}
    >
      {!matched && value && <option value={value}>{value}（自定义）</option>}
      <option value="__none__">无</option>
      <option value="today">今天（{today.slice(5)}）</option>
      <option value="tomorrow">明天（{tomorrow.slice(5)}）</option>
      <option value="monday">下周一（{monday.slice(5)}）</option>
      <option value="__custom__">选择日期…</option>
    </select>
  )
}
