import { Calendar, CheckSquare, ChevronLeft, ChevronRight, ListTodo, Rss, Search, Settings } from 'lucide-react'
import clsx from 'clsx'
import type { TopTab, ViewMode } from '../types'

interface Props {
  title: string
  topTab: TopTab
  mode: ViewMode
  onTopTabChange: (t: TopTab) => void
  onModeChange: (m: ViewMode) => void
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  canPrev: boolean
  canNext: boolean
  onOpenSearch: () => void
  onOpenSubscription: () => void
  onOpenSettings: () => void
}

const MODES: { key: ViewMode; label: string }[] = [
  { key: 'month', label: '月' },
  { key: 'week', label: '周' },
  { key: 'day', label: '日' },
  { key: 'year', label: '年' },
  { key: 'countdown', label: '倒数日' },
]

export function TopBar({ title, topTab, mode, onTopTabChange, onModeChange, onPrev, onNext, onToday, canPrev, canNext, onOpenSearch, onOpenSubscription, onOpenSettings }: Props) {
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
            <Calendar size={14} /> 日历
          </button>
          <button
            onClick={() => onTopTabChange('todo')}
            className={clsx(
              'flex items-center gap-1 px-3 py-1 text-sm rounded-md transition',
              topTab === 'todo' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <CheckSquare size={14} /> 待办
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
                  title={mode === 'year' ? '上一年' : mode === 'week' ? '上一周' : mode === 'day' ? '上一天' : '上一月'}
                >
                  <ChevronLeft size={18} />
                </button>
                <h1 className="text-lg font-semibold text-gray-800 min-w-[140px] text-center">{title}</h1>
                <button
                  onClick={onNext}
                  disabled={!canNext}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title={mode === 'year' ? '下一年' : mode === 'week' ? '下一周' : mode === 'day' ? '下一天' : '下一月'}
                >
                  <ChevronRight size={18} />
                </button>
                <button
                  onClick={onToday}
                  className="ml-2 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition"
                >
                  今天
                </button>
              </>
            )}
            {mode === 'countdown' && (
              <>
                {/* 与月/周/日/年模式同构的占位（上一月/下一月/今天同宽），保持模式按钮组位置一致 */}
                <div className="w-[34px] flex-shrink-0" aria-hidden />
                <h1 className="text-lg font-semibold text-gray-800 flex items-center gap-1.5 min-w-[140px]">
                  <ListTodo size={18} /> 倒数日
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
                  {m.label}
                </button>
              ))}
            </div>
          </>
        )}

        {topTab === 'todo' && <h1 className="text-lg font-semibold text-gray-800 flex items-center gap-1.5"><ListTodo size={18} /> 待办</h1>}
      </div>

      <div className="flex items-center gap-2">
        {topTab === 'calendar' && (
          <button
            onClick={onOpenSearch}
            className="relative flex items-center w-48 pl-2.5 pr-3 py-1.5 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded-lg hover:bg-white hover:text-gray-600 transition"
          >
            <Search size={14} className="mr-2" />
            搜索事件…
          </button>
        )}
        <button onClick={onOpenSubscription} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition" title="订阅">
          <Rss size={18} />
        </button>
        <button onClick={onOpenSettings} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition" title="设置">
          <Settings size={18} />
        </button>
      </div>
    </header>
  )
}
