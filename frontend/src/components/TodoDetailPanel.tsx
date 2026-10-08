import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import type { Todo, TodoList } from '../types'
import { useT, type TxKey } from '../i18n'
import { layerLabel } from '../i18n/adapt/layerLabel'
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

const IMPORTANCE_OPTIONS: { key: string; labelKey: TxKey }[] = [
  { key: 'high', labelKey: 'todoDetail.importance.high' },
  { key: 'normal', labelKey: 'todoDetail.importance.normal' },
  { key: 'low', labelKey: 'todoDetail.importance.low' },
]

const STATUS_OPTIONS: { key: string; labelKey: TxKey }[] = [
  { key: 'notStarted', labelKey: 'todoDetail.status.notStarted' },
  { key: 'inProgress', labelKey: 'todoDetail.status.inProgress' },
  { key: 'completed', labelKey: 'todoDetail.status.completed' },
  { key: 'waitingOnOthers', labelKey: 'todoDetail.status.waitingOnOthers' },
  { key: 'deferred', labelKey: 'todoDetail.status.deferred' },
]

const COMPLEXITY_OPTIONS: { key: string; labelKey: TxKey }[] = [
  { key: 'simple', labelKey: 'todoDetail.complexity.simple' },
  { key: 'medium', labelKey: 'todoDetail.complexity.medium' },
  { key: 'hard', labelKey: 'todoDetail.complexity.hard' },
]

const REPEAT_OPTIONS: { key: string; labelKey: TxKey }[] = [
  { key: 'none', labelKey: 'todoDetail.repeat.none' },
  { key: 'daily', labelKey: 'todoDetail.repeat.daily' },
  { key: 'weekdays', labelKey: 'todoDetail.repeat.weekdays' },
  { key: 'weekly', labelKey: 'todoDetail.repeat.weekly' },
]

export const TodoDetailPanel = forwardRef<TodoDetailPanelRef, Props>(function TodoDetailPanel(
  { todo, lists, onClose, onSave, onDelete },
  ref,
) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [importance, setImportance] = useState('normal')
  const [dueDate, setDueDate] = useState('')
  const [plannedDate, setPlannedDate] = useState('')
  const [startDate, setStartDate] = useState('')
  const [complexity, setComplexity] = useState('medium')
  const [repeat, setRepeat] = useState('none')
  const [tagsText, setTagsText] = useState('')
  const [notesModalOpen, setNotesModalOpen] = useState(false)
  const [listId, setListId] = useState('')
  const [status, setStatus] = useState('notStarted')
  const [dueExpanded, setDueExpanded] = useState(false)

  useImperativeHandle(ref, () => ({
    openNotes: () => setNotesModalOpen(true),
  }))
  const [plannedExpanded, setPlannedExpanded] = useState(false)

  const formRef = useRef({ title, body, importance, dueDate, plannedDate, startDate, repeat, complexity, tagsText, listId, status })
  formRef.current = { title, body, importance, dueDate, plannedDate, startDate, repeat, complexity, tagsText, listId, status }

  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  // 当前正在编辑的对象（可能是真实 todo，也可能是「新建待办」的幻影 id=''）
  // cleanup 必须读 ref 的当前值，不能闭包捕获 —— 详见下方 effect 说明
  const prevTodoRef = useRef<Todo | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  // 消费型标记：显式保存 / 删除已自行落盘，紧随其后的那一次 cleanup 不得重复提交
  const skipFlushRef = useRef(false)

  /**
   * 把当前表单内容落盘 —— 所有「离开编辑态」路径的唯一出口。
   * - 真实任务：有改动才 PUT，无改动静默跳过（避免每次开合都打一次接口）
   * - 幻影新建（id === '' / '__NEW__'）：标题非空就 POST 创建
   */
  const flushSave = (target: Todo) => {
    const f = formRef.current
    const title = f.title.trim()
    // 空标题 / 无归属列表 = 用户放弃编辑，不落盘（否则会建出空任务或 list_id 为空的脏数据）
    if (!title || !f.listId) return
    const tags = f.tagsText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
    const isPhantom = target.id === '' || target.id === '__NEW__'
    if (!isPhantom) {
      const changed =
        f.title !== target.title ||
        (f.body || '') !== (target.body ?? '') ||
        f.importance !== target.importance ||
        (f.dueDate || '') !== (target.due_date ?? '') ||
        (f.plannedDate || '') !== (target.planned_date ?? '') ||
        (f.startDate || '') !== (target.start_date ?? '') ||
        f.complexity !== (target.complexity || 'medium') ||
        (f.repeat || 'none') !== (target.repeat || 'none') ||
        JSON.stringify(tags) !== JSON.stringify(target.tags ?? []) ||
        f.listId !== target.list_id ||
        f.status !== target.status
      if (!changed) return
    }
    onSaveRef.current({
      ...target,
      title,
      body: f.body.trim() || null,
      importance: f.importance,
      due_date: f.dueDate || null,
      planned_date: f.plannedDate || null,
      start_date: f.startDate || null,
      repeat: f.repeat === 'none' ? null : f.repeat,
      complexity: f.complexity,
      tags: tags.length ? tags : null,
      list_id: f.listId,
      status: f.status,
    })
  }

  useEffect(() => {
    prevTodoRef.current = todo

    if (todo) {
      // 同步把表单快照写进 formRef，使 ref 与「刚装载的 todo」保持一致。
      // 两个必要作用：
      // 1) StrictMode 开发模式下 React 会「body → cleanup → body」模拟一次卸载，
      //    若 ref 还停在初始空值，那次模拟 cleanup 会拿空表单去 flush，可能误发 PUT；
      // 2) 保证「打开后没改动就关闭」时 flushSave 的 changed 判定恒为 false。
      formRef.current = {
        title: todo.title,
        body: todo.body ?? '',
        importance: todo.importance,
        dueDate: todo.due_date ?? '',
        plannedDate: todo.planned_date ?? '',
        startDate: todo.start_date ?? '',
        repeat: todo.repeat || 'none',
        complexity: todo.complexity || 'medium',
        tagsText: (todo.tags ?? []).join(', '),
        listId: todo.list_id,
        status: todo.status,
      }
      setTitle(todo.title)
      setBody(todo.body ?? '')
      setImportance(todo.importance)
      setDueDate(todo.due_date ?? '')
      setPlannedDate(todo.planned_date ?? '')
      setStartDate(todo.start_date ?? '')
      setRepeat(todo.repeat || 'none')
      setComplexity(todo.complexity || 'medium')
      setTagsText((todo.tags ?? []).join(', '))
      setListId(todo.list_id)
      setStatus(todo.status)
      setDueExpanded(false)
      setPlannedExpanded(false)
      savingRef.current = false
      setSaving(false)
    }
    skipFlushRef.current = false

    return () => {
      // 离开「上一个编辑对象」时统一落盘。
      //
      // 为什么放在 cleanup 而不是 body：
      //   cleanup 在 React 提交新渲染之后、下一个 effect body 之前执行，此时
      //   formRef.current 仍是用户刚输入的值；而组件卸载时 React 同样会执行 cleanup。
      //   于是这一条路径同时覆盖了 ——
      //     点 X 关闭 / 点侧栏切列表 / 切到另一个待办 / 切视图导致整个面板卸载
      //   之前把条件写成「prevIsPhantom && curId === null」，只覆盖了「切到无选中」
      //   一种情况，另外三种都会静默丢输入（用户报的就是这个）。
      //
      // 为什么读 ref 而不是闭包捕获 prev：
      //   捕获到的是「body 执行那一刻」的上一个 todo，A→B→C 连续切换时会拿到 null 导致漏存。
      if (skipFlushRef.current) {
        skipFlushRef.current = false
        return
      }
      const leaving = prevTodoRef.current
      if (leaving) flushSave(leaving)
    }
  }, [todo?.id])

  if (!todo) {
    return (
      <aside className="w-72 bg-white border-l border-gray-200 p-4">
        <p className="text-sm text-gray-400">{t('todoDetail.emptyPanel')}</p>
      </aside>
    )
  }

  const tags = tagsText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)

  // 构造完整保存数据（与 useEffect 自动保存的字段一一对应）
  const buildData = (): Todo => ({
    ...todo!,
    title: title.trim(),
    body: body.trim() || null,
    importance,
    due_date: dueDate || null,
    planned_date: plannedDate || null,
    start_date: startDate || null,
    repeat: repeat === 'none' ? null : repeat,
    complexity,
    tags: tags.length ? tags : null,
    list_id: listId,
    status,
  })

  // 显式保存：自己提交一次，再用 skipFlushRef 让紧随其后的 cleanup 别重复提交
  const save = () => {
    if (savingRef.current) return
    if (!title.trim() || !listId) return
    savingRef.current = true
    setSaving(true)
    skipFlushRef.current = true
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
        <p className="text-xs text-gray-400 uppercase tracking-wide">{t('todoDetail.title')}</p>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600" title={t('todoDetail.action.close')}>
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
          placeholder={t('todoDetail.field.title')}
        />

        <textarea
          className="w-full text-sm border border-gray-200 rounded-md p-2 min-h-[80px] focus:border-blue-400 focus:outline-none resize-y cursor-text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onDoubleClick={() => setNotesModalOpen(true)}
          title={t('todoDetail.dblClickEdit')}
          placeholder={t('todoDetail.field.bodyOptional')}
        />

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            <span className="block mb-1">{t('todoDetail.field.list')}</span>
            <select className="tt-input" value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{layerLabel(l, t)}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            <span className="block mb-1">{t('todoDetail.field.importance')}</span>
            <select className="tt-input" value={importance} onChange={(e) => setImportance(e.target.value)}>
              {IMPORTANCE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{t(o.labelKey)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className={clsx('text-xs text-gray-500', dueExpanded && 'col-span-2', plannedExpanded && 'hidden')}>
            <span className="block mb-1">{t('todoDetail.field.dueDate')}</span>
            <DueDateQuickPicker value={dueDate} onChange={setDueDate} expanded={dueExpanded} setExpanded={setDueExpanded} />
          </label>
          <label className={clsx('text-xs text-gray-500', plannedExpanded && 'col-span-2', dueExpanded && 'hidden')}>
            <span className="block mb-1">{t('todoDetail.field.plannedDate')}</span>
            <DueDateQuickPicker value={plannedDate} onChange={setPlannedDate} expanded={plannedExpanded} setExpanded={setPlannedExpanded} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            <span className="block mb-1">{t('todoDetail.field.startDate')}</span>
            <input type="date" className="tt-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="text-xs text-gray-500">
            <span className="block mb-1">{t('todoDetail.field.complexity')}</span>
            <select className="tt-input" value={complexity} onChange={(e) => setComplexity(e.target.value)}>
              {COMPLEXITY_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{t(o.labelKey)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            <span className="block mb-1">{t('todoDetail.field.status')}</span>
            <select className="tt-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{t(o.labelKey)}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            <span className="block mb-1">{t('todoDetail.field.repeat')}</span>
            <select className="tt-input" value={repeat} onChange={(e) => setRepeat(e.target.value)} title={t('todoDetail.field.repeatHint')}>
              {REPEAT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{t(o.labelKey)}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="text-xs text-gray-500 block">
          <span className="block mb-1">{t('todoDetail.field.tags')}</span>
          <input
            className="tt-input"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder={t('todoDetail.tagsPlaceholder')}
          />
          {tags.length > 0 && (
            <span className="flex flex-wrap gap-1 mt-1.5">
              {tags.map((tag) => (
                <span key={tag} className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{tag}</span>
              ))}
            </span>
          )}
        </label>
      </div>

      <div className="px-4 py-3 border-t border-gray-100 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => {
              // 删除后面板会关闭，必须阻止 cleanup 把这条刚删掉的记录又 flush 回去
              if (confirm(t('todoDetail.deleteConfirm', { title: todo.title }))) {
                skipFlushRef.current = true
                onDelete(todo.id)
              }
            }}
            className="flex items-center gap-1 text-sm text-red-500 hover:text-red-600 whitespace-nowrap"
          >
            <Trash2 size={14} /> {t('todoDetail.action.delete')}
          </button>
          <button
            onClick={save}
            disabled={!title.trim() || !listId || saving}
            className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40 whitespace-nowrap"
          >
            {saving ? t('todoDetail.action.saving') : t('todoDetail.action.save')}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 text-right leading-none whitespace-nowrap">
          {t('todoDetail.autosavePrefix')}<span className="font-medium text-gray-500">Ctrl+Enter</span>{t('todoDetail.autosaveSuffix')}
        </p>
      </div>
      <NotesEditorModal
        open={notesModalOpen}
        initialValue={body}
        title={title || t('todoDetail.notesFallbackTitle')}
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
  const t = useT()
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
          {t('todoDetail.due.back')}
        </button>
      </div>
    )
  }

  const presets: { key: string; labelKey: TxKey; val: string }[] = [
    { key: 'today', labelKey: 'todoDetail.due.today', val: today },
    { key: 'tomorrow', labelKey: 'todoDetail.due.tomorrow', val: tomorrow },
    { key: 'monday', labelKey: 'todoDetail.due.nextMonday', val: monday },
  ]
  const matched = presets.find((p) => p.val === value)
  const label = value ? (matched ? t(matched.labelKey) : value.slice(5)) : t('todoDetail.due.none')

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
      {!matched && value && <option value={value}>{t('todoDetail.due.customValue', { value })}</option>}
      <option value="__none__">{t('todoDetail.due.none')}</option>
      <option value="today">{t('todoDetail.due.todayWithDate', { date: today.slice(5) })}</option>
      <option value="tomorrow">{t('todoDetail.due.tomorrowWithDate', { date: tomorrow.slice(5) })}</option>
      <option value="monday">{t('todoDetail.due.nextMondayWithDate', { date: monday.slice(5) })}</option>
      <option value="__custom__">{t('todoDetail.due.pickDate')}</option>
    </select>
  )
}
