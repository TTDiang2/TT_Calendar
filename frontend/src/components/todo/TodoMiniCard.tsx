import clsx from 'clsx'
import type { Todo } from '../../types'
import { COMPLEXITY_KEYS, IMPORTANCE_KEYS, STATUS_KEYS, dueInDays, labelOf } from '../../utils/todoLogic'
import { useT, useTPlural } from '../../i18n'
import { useCalendarTheme, withAlpha } from '../../lib/calendar-theme'
import { AnimatedCheck } from '../ui/AnimatedCheck'

/**
 * 卡片密度。
 * comfortable：卡片全文（标题 + 元信息 + 标签 + 备注预览），列表/便签首屏用。
 * compact：矩阵 / 看板用。板上已经用「列 / 象限」表达了某个维度，卡片再重复一遍
 * 只会把 13px 的标题压成一片小字，所以 compact 默认隐藏被分组维度、备注正文，
 * 只留标题 + 一行元信息 + 最多两个标签。
 */
export type CardDensity = 'comfortable' | 'compact'

export interface CardHide {
  status?: boolean
  importance?: boolean
  complexity?: boolean
  due?: boolean
  planned?: boolean
  start?: boolean
  tags?: boolean
  body?: boolean
}

const STATUS_DOT: Record<string, string> = {
  notStarted: 'var(--cal-border)',
  inProgress: 'var(--cal-info)',
  waitingOnOthers: 'var(--cal-warning)',
  deferred: 'var(--cal-muted)',
}

function shortDate(d: string): string {
  // 元信息行空间有限，08-18 短格式够用；跨年任务罕见，若遇到保留原串
  return d.length >= 10 ? d.slice(5, 10) : d
}

export function TodoMiniCard({ todo, selected, sub, onClick, onToggle, density = 'comfortable', hide }: {
  todo: Todo
  selected: boolean
  sub?: string
  onClick: () => void
  onToggle?: (done: boolean) => void
  density?: CardDensity
  hide?: CardHide
}) {
  const done = todo.status === 'completed'
  const t = useT()
  const tPlural = useTPlural()
  const { theme } = useCalendarTheme()
  const compact = density === 'compact'
  const din = dueInDays(todo)
  const overdue = !done && din !== null && din < 0
  const dueToday = !done && din === 0
  const tags = todo.tags ?? []
  const shownTags = compact ? tags.slice(0, 2) : tags
  const restTags = tags.length - shownTags.length

  return (
    <div
      className={clsx(
        'group cal-card cal-card-hover flex items-start select-none',
        compact ? 'gap-1.5 px-2 py-1.5' : 'gap-2 px-2.5 py-2',
        done && 'opacity-70',
      )}
      style={
        selected
          ? { borderColor: theme.accent, boxShadow: `0 0 0 3px ${withAlpha(theme.accent, 0.16)}` }
          : undefined
      }
    >
      {onToggle && (
        <AnimatedCheck
          checked={done}
          onClick={(e) => { e.stopPropagation(); onToggle(!done) }}
          ariaLabel={done ? t('todoboards.aria.markUndone') : t('todoboards.aria.markDone')}
          shape="circle"
          checkSize={compact ? 9 : 10}
          className={clsx(
            'mt-0.5 cursor-pointer border flex-shrink-0',
            done
              ? 'border-transparent text-white'
              : 'hover:border-[color:var(--cal-success)]',
          )}
          style={done ? { backgroundColor: theme.success, borderColor: theme.success } : { borderColor: theme.border }}
          checkClassName="text-white"
        />
      )}
      <button onClick={onClick} className="flex-1 text-left min-w-0 cursor-pointer">
        <div className="flex items-start justify-between gap-1">
          <span
            className={clsx(
              'leading-snug break-words',
              compact ? 'text-[13px]' : 'text-sm',
              done && 'line-through',
            )}
            style={{ color: done ? theme.muted : theme.ink }}
          >
            {todo.title}
          </span>
          <span className="flex flex-col items-end gap-0.5 flex-shrink-0">
            {overdue && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap tabular-nums"
                style={{ backgroundColor: withAlpha(theme.danger, 0.1), color: theme.danger }}
              >
                {tPlural('todoboards.card.overdueBy', -(din ?? 0))}
              </span>
            )}
            {dueToday && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap"
                style={{ backgroundColor: withAlpha(theme.warning, 0.12), color: theme.warning }}
              >
                {t('todoboards.card.today')}
              </span>
            )}
          </span>
        </div>

        {/* 元信息行：状态/重要性/复杂度/三类日期，条件渲染避免空分隔符堆积 */}
        {!done && (
          <div
            className={clsx(
              'mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-none',
              compact ? 'text-[10px]' : 'text-[10px]',
            )}
            style={{ color: theme.muted }}
          >
            {!hide?.status && (
              <span className="flex items-center gap-1">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: STATUS_DOT[todo.status] ?? theme.muted }}
                />
                {labelOf(STATUS_KEYS, todo.status, t)}
              </span>
            )}
            {!hide?.importance && (
              <span
                className="font-medium"
                style={{ color: todo.importance === 'high' ? theme.danger : theme.muted }}
              >
                {labelOf(IMPORTANCE_KEYS, todo.importance, t)}
              </span>
            )}
            {!hide?.complexity && (
              <span
                style={{
                  color:
                    todo.complexity === 'hard' ? theme.danger
                      : todo.complexity === 'medium' ? theme.warning
                        : theme.muted,
                }}
              >
                {labelOf(COMPLEXITY_KEYS, todo.complexity, t)}
              </span>
            )}
            {!hide?.due && todo.due_date && (
              <span
                className={clsx('tabular-nums', overdue && 'font-medium')}
                style={overdue ? { color: theme.danger } : undefined}
              >
                {t('todoboards.card.due', { date: shortDate(todo.due_date) })}
              </span>
            )}
            {!hide?.planned && todo.planned_date && (
              <span className="tabular-nums">{t('todoboards.card.planned', { date: shortDate(todo.planned_date) })}</span>
            )}
            {!hide?.start && todo.start_date && (
              <span className="tabular-nums">{t('todoboards.card.start', { date: shortDate(todo.start_date) })}</span>
            )}
          </div>
        )}

        {!hide?.tags && shownTags.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {shownTags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded leading-none"
                style={{ backgroundColor: theme.subtle, color: theme.muted }}
              >
                #{tag}
              </span>
            ))}
            {restTags > 0 && (
              <span className="text-[10px] leading-none tabular-nums" style={{ color: theme.muted }}>
                +{restTags}
              </span>
            )}
          </div>
        )}

        {/* 备注预览：单行截断，完整内容在详情面板看；紧凑模式不占行 */}
        {!compact && !hide?.body && todo.body && (
          <div className="mt-1 text-[10px] leading-snug truncate" style={{ color: theme.muted }}>
            {todo.body}
          </div>
        )}

        {sub && (
          <div className={clsx('mt-1 truncate', compact ? 'text-[10px]' : 'text-[11px]')} style={{ color: theme.muted }}>
            {sub}
          </div>
        )}
      </button>
    </div>
  )
}
