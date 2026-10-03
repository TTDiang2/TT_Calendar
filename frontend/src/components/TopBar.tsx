import { Calendar, CheckSquare, ChevronLeft, ChevronRight, ListTodo, Rss, Search, Settings } from 'lucide-react'
import clsx from 'clsx'
import { useT, type TxKey } from '../i18n'
import type { TopTab, TodoViewMode, ViewMode } from '../types'

interface Props {
  title: string
  topTab: TopTab
  mode: ViewMode
  todoView: TodoViewMode
  onTopTabChange: (t: TopTab) => void
  onModeChange: (m: ViewMode) => void
  onTodoViewChange: (v: TodoViewMode) => void
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  canPrev: boolean
  canNext: boolean
  onOpenSearch: () => void
  onOpenSubscription: () => void
  onOpenSettings: () => void
}

/** 视图模式切换（labelKey 模式：模块常量不存文案，渲染时 t(m.labelKey)） */
const MODES: { key: ViewMode; labelKey: TxKey }[] = [
  { key: 'month', labelKey: 'topbar.mode.month' },
  { key: 'week', labelKey: 'topbar.mode.week' },
  { key: 'day', labelKey: 'topbar.mode.day' },
  { key: 'year', labelKey: 'topbar.mode.year' },
  { key: 'countdown', labelKey: 'topbar.mode.countdown' },
]

const TODO_MODES: { key: TodoViewMode; labelKey: TxKey }[] = [
  { key: 'list', labelKey: 'topbar.todoMode.list' },
  { key: 'matrix', labelKey: 'topbar.todoMode.matrix' },
  { key: 'kanban', labelKey: 'topbar.todoMode.kanban' },
  { key: 'gantt', labelKey: 'topbar.todoMode.gantt' },
  { key: 'stickies', labelKey: 'topbar.todoMode.stickies' },
]

export function TopBar({ title, topTab, mode, todoView, onTopTabChange, onModeChange, onTodoViewChange, onPrev, onNext, onToday, canPrev, canNext, onOpenSearch, onOpenSubscription, onOpenSettings }: Props) {
  const t = useT()
  const prevTitle = mode === 'year' ? t('topbar.nav.prevYear') : mode === 'week' ? t('topbar.nav.prevWeek') : mode === 'day' ? t('topbar.nav.prevDay') : t('topbar.nav.prevMonth')
  const nextTitle = mode === 'year' ? t('topbar.nav.nextYear') : mode === 'week' ? t('topbar.nav.nextWeek') : mode === 'day' ? t('topbar.nav.nextDay') : t('topbar.nav.nextMonth')
  return (
    <header className="h-14 flex items-center justify-between px-4 bg-white border-b border-gray-200">
      <div className="flex items-center gap-1">
        {/* 顶级 tab：日历 / 待办 */}
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 mr-3">
          <button
            onClick={() => onTopTabChange('calendar')}
            className={clsx(
              'flex items-center gap-1 px-3 py-1 text-sm rounded-md transition',
              topTab === 'calendar' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <Calendar size={14} /> {t('terms.calendar')}
          </button>
          <button
            onClick={() => onTopTabChange('todo')}
            className={clsx(
              'flex items-center gap-1 px-3 py-1 text-sm rounded-md transition',
              topTab === 'todo' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <CheckSquare size={14} /> {t('terms.todo')}
          </button>
        </div>

        {/* 日历 tab：翻月/翻年 + 视图切换；倒数日模式隐藏翻页/今天，保留模式切换避免布局大跳 */}
        {topTab === 'calendar' && (
          <>
            {mode !== 'countdown' && (
              <>
                <button
                  onClick={onPrev}
                  disabled={!canPrev}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title={prevTitle}
                >
                  <ChevronLeft size={18} />
                </button>
                <h1 className="text-lg font-semibold text-gray-800 min-w-[140px] text-center">{title}</h1>
                <button
                  onClick={onNext}
                  disabled={!canNext}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title={nextTitle}
                >
                  <ChevronRight size={18} />
                </button>
                <button
                  onClick={onToday}
                  className="ml-2 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition"
                >
                  {t('topbar.today')}
                </button>
              </>
            )}
            {mode === 'countdown' && (
              <>
                {/* 与月/周/日/年模式同构的占位（上一月/下一月/今天同宽），保持模式按钮组位置一致 */}
                <div className="w-[34px] flex-shrink-0" aria-hidden />
                <h1 className="text-lg font-semibold text-gray-800 flex items-center gap-1.5 min-w-[140px]">
                  <ListTodo size={18} /> {t('terms.countdown')}
                </h1>
                <div className="w-[34px] flex-shrink-0" aria-hidden />
                <div className="w-[52px] ml-2 flex-shrink-0" aria-hidden />
              </>
            )}
            <div className="ml-4 inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => onModeChange(m.key)}
                  className={clsx(
                    'px-3 py-1 text-sm rounded-md transition',
                    mode === m.key ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  {t(m.labelKey)}
                </button>
              ))}
            </div>
          </>
        )}

        {topTab === 'todo' && (
          <>
            <h1 className="text-lg font-semibold text-gray-800 flex items-center gap-1.5"><ListTodo size={18} /> {t('terms.todo')}</h1>
            <div className="ml-4 inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {TODO_MODES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => onTodoViewChange(m.key)}
                  className={clsx(
                    'px-3 py-1 text-sm rounded-md transition',
                    todoView === m.key ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  {t(m.labelKey)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        {topTab === 'calendar' && (
          <button
            onClick={onOpenSearch}
            className="relative flex items-center w-48 pl-2.5 pr-3 py-1.5 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded-lg hover:bg-white hover:text-gray-600 transition"
          >
            <Search size={14} className="mr-2" />
            {t('topbar.searchPlaceholder')}
          </button>
        )}
        <button onClick={onOpenSubscription} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition" title={t('terms.subscription')}>
          <Rss size={18} />
        </button>
        <button onClick={onOpenSettings} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition" title={t('settings.title')}>
          <Settings size={18} />
        </button>
      </div>
    </header>
  )
}
