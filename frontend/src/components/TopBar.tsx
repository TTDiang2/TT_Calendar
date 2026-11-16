import { Calendar, CheckSquare, ChevronLeft, ChevronRight, ListTodo, Rss, Search, Settings } from 'lucide-react'
import { useT, type TxKey } from '../i18n'
import { useMediaQuery } from '../hooks/useMediaQuery'
import type { TopTab, TodoViewMode, ViewMode } from '../types'
import { WindowControls } from './WindowControls'
import { SegmentedTabs } from './ui/SegmentedTabs'

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
  // 窄宽度（960 最小窗口）下搜索框收成图标，把横向预算让给「期间导航 + 视图切换」
  const compact = useMediaQuery('(max-width: 1100px)')
  const prevTitle = mode === 'year' ? t('topbar.nav.prevYear') : mode === 'week' ? t('topbar.nav.prevWeek') : mode === 'day' ? t('topbar.nav.prevDay') : t('topbar.nav.prevMonth')
  const nextTitle = mode === 'year' ? t('topbar.nav.nextYear') : mode === 'week' ? t('topbar.nav.nextWeek') : mode === 'day' ? t('topbar.nav.nextDay') : t('topbar.nav.nextMonth')
  return (
    <header data-tauri-drag-region="deep" className="h-14 flex items-center gap-3 px-4 cal-panel-bg border-b cal-line-b select-none">
      <div className="flex items-center gap-1 min-w-0">
        {/* 顶级 tab：日历 / 待办 —— 应用级的两个世界，权重最高 */}
        <SegmentedTabs
          className="mr-2 shrink-0"
          value={topTab}
          onChange={onTopTabChange}
          items={[
            { value: 'calendar' as const, label: <><Calendar size={14} /> {t('terms.calendar')}</> },
            { value: 'todo' as const, label: <><CheckSquare size={14} /> {t('terms.todo')}</> },
          ]}
        />

        {/* 日历 tab：翻月/翻年 + 视图切换；倒数日模式隐藏翻页/今天，保留模式切换避免布局大跳 */}
        {topTab === 'calendar' && (
          <>
            {mode !== 'countdown' && (
              /* 期间导航收成一个视觉组：‹ 2026年11月 › + 今天，一起读作「我在看哪段时间」 */
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  onClick={onPrev}
                  disabled={!canPrev}
                  className="p-1.5 rounded-lg cal-muted cal-hover-bg hover:text-[color:var(--cal-ink)] disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title={prevTitle}
                >
                  <ChevronLeft size={18} />
                </button>
                <h1 className="max-w-[190px] truncate px-1 text-[15px] font-semibold cal-ink text-center">{title}</h1>
                <button
                  onClick={onNext}
                  disabled={!canNext}
                  className="p-1.5 rounded-lg cal-muted cal-hover-bg hover:text-[color:var(--cal-ink)] disabled:opacity-30 disabled:cursor-not-allowed transition"
                  title={nextTitle}
                >
                  <ChevronRight size={18} />
                </button>
                <button
                  onClick={onToday}
                  className="ml-1 shrink-0 whitespace-nowrap rounded-md border border-[color:var(--cal-border)] px-2 py-1 text-[13px] font-medium cal-ink cal-hover-bg transition"
                >
                  {t('topbar.today')}
                </button>
              </div>
            )}
            {mode === 'countdown' && (
              <div className="flex shrink-0 items-center gap-0.5">
                {/* 与月/周/日/年模式同构的占位（上一月/下一月/今天同宽），保持模式按钮组位置一致 */}
                <div className="w-[30px] flex-shrink-0" aria-hidden />
                <h1 className="px-1 text-[15px] font-semibold cal-ink flex items-center gap-1.5 max-w-[190px]">
                  <ListTodo size={18} /> {t('terms.countdown')}
                </h1>
                <div className="w-[30px] flex-shrink-0" aria-hidden />
                <div className="w-[46px] ml-1 flex-shrink-0" aria-hidden />
              </div>
            )}
            {/* 分隔线：左边是「时间轴」，右边是「看的方式」 */}
            <span className="mx-1.5 h-5 w-px shrink-0 bg-[var(--cal-border)]" aria-hidden="true" />
            <SegmentedTabs
              className="shrink-0"
              value={mode}
              onChange={onModeChange}
              items={MODES.map((m) => ({ value: m.key, label: t(m.labelKey) }))}
            />
          </>
        )}

        {topTab === 'todo' && (
          <>
            <h1 className="flex shrink-0 items-center gap-1.5 text-[15px] font-semibold cal-ink"><ListTodo size={18} /> {t('terms.todo')}</h1>
            <span className="mx-1.5 h-5 w-px shrink-0 bg-[var(--cal-border)]" aria-hidden="true" />
            <SegmentedTabs
              className="shrink-0"
              value={todoView}
              onChange={onTodoViewChange}
              items={TODO_MODES.map((m) => ({ value: m.key, label: t(m.labelKey) }))}
            />
          </>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {topTab === 'calendar' && (
          compact ? (
            <button
              onClick={onOpenSearch}
              className="p-2 rounded-lg cal-muted cal-hover-bg transition"
              title={t('topbar.searchPlaceholder')}
              aria-label={t('topbar.searchPlaceholder')}
            >
              <Search size={18} />
            </button>
          ) : (
            <button
              onClick={onOpenSearch}
              className="relative flex w-44 items-center rounded-lg border border-[color:var(--cal-border)] cal-subtle-bg py-1.5 pl-2.5 pr-3 text-sm cal-muted transition hover:text-[color:var(--cal-ink)]"
            >
              <Search size={14} className="mr-2" />
              <span className="truncate">{t('topbar.searchPlaceholder')}</span>
            </button>
          )
        )}
        <button onClick={onOpenSubscription} className="p-2 rounded-lg cal-muted cal-hover-bg transition" title={t('terms.subscription')}>
          <Rss size={18} />
        </button>
        <button onClick={onOpenSettings} className="p-2 rounded-lg cal-muted cal-hover-bg transition" title={t('settings.title')}>
          <Settings size={18} />
        </button>
        <WindowControls />
      </div>
    </header>
  )
}
