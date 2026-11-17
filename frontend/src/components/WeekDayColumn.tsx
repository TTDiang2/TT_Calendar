import { memo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import type { Day, Layer } from '../types'
import { parseDate, softTint } from '../data'
import { getTodoBusyConfig } from '../api/client'
import { fmtMonthName } from '../i18n/format'
import { useLang, useT, useTPlural } from '../i18n'
import type { CalendarColorStyle } from '../lib/calendar-style'
import { useCalendarTheme, withAlpha } from '../lib/calendar-theme'
import { colorLayersOf, scheduleGroupsOf, visibleEventsOf } from '../lib/day-presentation'

interface Props {
  day: Day
  weekday: string
  showMonth: boolean
  layers: Layer[]
  selected: boolean
  dragOver: boolean
  colorStyle: CalendarColorStyle
  onClick: (date: string) => void
  onDoubleClick: (date: string) => void
  onContextMenu: (e: { clientX: number; clientY: number }, date: string) => void
  onDragStart: (date: string) => void
  onDragEnter: (date: string) => void
  onDrop: (date: string) => void
}

/** 一列能排下的正文行数：超出后收成「还有 N 条」，避免把列撑出滚动条 */
const MAX_ROWS = 7

/**
 * 周视图的一天 = 一张纵向卡片，而不是月视图的格子放大。
 *
 * 月格用整格底色表达「这天有多忙」，周视图有 7 列的高度，不需要靠面积表达强度：
 * 底色只留顶部 3px 的多段色条，正文留给真正要看的东西——几点、什么事。
 */
export const WeekDayColumn = memo(function WeekDayColumn({
  day, weekday, showMonth, layers, selected, dragOver, colorStyle,
  onClick, onDoubleClick, onContextMenu, onDragStart, onDragEnter, onDrop,
}: Props) {
  const t = useT()
  const tPlural = useTPlural()
  const lang = useLang()
  const { theme } = useCalendarTheme()
  const [hover, setHover] = useState(false)
  const { y, m, d } = parseDate(day.date)
  const isSoft = colorStyle === 'soft'
  const { data: busyConfig } = useQuery({ queryKey: ['todoBusyConfig'], queryFn: getTodoBusyConfig, staleTime: 60_000 })

  const colorLayers = colorLayersOf(day, layers, theme, busyConfig)
  const events = visibleEventsOf(day, layers)
  const { timed, allDay, continuations } = scheduleGroupsOf(day)

  // 行预算：延续条占 0.4 行，其余各占一行；超出的汇总成一条「还有 N 条」
  const rows: { key: string; node: React.ReactNode }[] = []

  for (const it of allDay) {
    rows.push({
      key: `ad-${it.id ?? it.title}`,
      node: (
        <div key={`ad-${it.id ?? it.title}`} className="flex items-center gap-1.5">
          <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ backgroundColor: it.color ?? theme.accent }} />
          <span className="text-[11.5px] leading-tight truncate" style={{ color: theme.ink }} title={it.title}>
            {it.title}
          </span>
        </div>
      ),
    })
  }
  for (const it of continuations) {
    rows.push({
      key: `ct-${it.id ?? it.title}`,
      node: (
        <div
          key={`ct-${it.id ?? it.title}`}
          className="h-[5px] rounded-full"
          style={{
            backgroundColor: it.color ?? theme.accent,
            backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0) 40%, rgba(0,0,0,0.05))',
          }}
          title={t('calendar.contTitle', { title: it.title, i: String(it.span_index), total: String(it.span_total), start: String(it.span_start) })}
        />
      ),
    })
  }
  for (const it of timed) {
    rows.push({
      key: `tm-${it.id ?? it.title}`,
      node: (
        <div key={`tm-${it.id ?? it.title}`} className="flex items-start gap-1.5">
          <span className="w-[32px] flex-shrink-0 text-[10px] leading-[14px] tabular-nums text-right" style={{ color: theme.muted }}>
            {it.start_time}
          </span>
          <span className="w-[2px] self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: it.color ?? theme.accent }} />
          <span className="text-[11.5px] leading-[14px] truncate flex-1 min-w-0" style={{ color: theme.ink }} title={`${it.start_time} ${it.title}`}>
            {it.title}
            {(it.span_total ?? 1) > 1 && (
              <span className="ml-1 text-[9.5px]" style={{ color: theme.muted }}>
                {t('calendar.spanDays', { n: it.span_total ?? 1 })}
              </span>
            )}
          </span>
        </div>
      ),
    })
  }
  for (const ev of events) {
    const layer = layers.find((l) => l.layer_id === ev.layer_id)
    rows.push({
      key: `ev-${ev.id ?? ev.title}`,
      node: (
        <div key={`ev-${ev.id ?? ev.title}`} className="flex items-center gap-1.5">
          <span
            className="w-[5px] h-[5px] rounded-full flex-shrink-0"
            style={{ backgroundColor: ev.color ?? layer?.color ?? theme.muted }}
          />
          <span className="text-[11.5px] leading-tight truncate" style={{ color: theme.muted }} title={ev.title}>
            {ev.title}
          </span>
        </div>
      ),
    })
  }

  const shown = rows.slice(0, MAX_ROWS)
  const hidden = rows.length - shown.length
  const isEmpty = rows.length === 0

  const ring = dragOver
    ? `0 0 0 2px ${theme.success}`
    : day.is_today
      ? `0 0 0 1.5px ${theme.today}`
      : selected
        ? `0 0 0 1.5px ${withAlpha(theme.accent, 0.5)}`
        : undefined

  return (
    <div
      onClick={() => onClick(day.date)}
      onDoubleClick={() => onDoubleClick(day.date)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu({ clientX: e.clientX, clientY: e.clientY }, day.date) }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', day.date)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(day.date)
      }}
      onDragEnter={() => onDragEnter(day.date)}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDrop={(e) => { e.preventDefault(); onDrop(day.date) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={clsx(
        // min-w 只做「再窄就横向滚」的兜底：118px 会让 1280 带详情面板时第 7 列被裁掉
        'group relative flex flex-col flex-1 basis-0 min-w-[80px] min-h-0 overflow-hidden rounded-xl border cursor-pointer',
        'transition-[box-shadow,border-color,transform] duration-150',
        day.is_other_month && 'opacity-55',
        dragOver && 'scale-[1.01]',
        hover && 'shadow-[0_1px_2px_rgba(17,24,39,0.05),0_10px_24px_-14px_rgba(17,24,39,0.28)]',
      )}
      style={{
        backgroundColor: 'var(--cal-panel)',
        borderColor: dragOver ? theme.success : hover ? withAlpha(theme.accent, 0.45) : theme.border,
        boxShadow: ring,
      }}
    >
      {/* 顶部多段色条：忙度 / 充实度 / 节假日按层叠顺序并排，整格不再铺色 */}
      <div className="flex h-[3px] flex-shrink-0" aria-hidden="true">
        {colorLayers.length === 0 ? (
          <span className="flex-1" style={{ backgroundColor: isSoft ? softTint(theme.border, { dense: true }) : theme.border }} />
        ) : (
          colorLayers.map((c) => (
            <span key={c.id} className="flex-1" style={{ backgroundColor: isSoft ? softTint(c.color) : c.color }} />
          ))
        )}
      </div>

      {/* 列头：周几 / 日期大字 / 今天 pill / 节假日 */}
      <div className="px-2.5 pt-1.5 pb-1.5 flex-shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }}>
        <div className="flex items-center justify-between gap-1">
          <span
            className="text-[10px] tracking-wide"
            style={{ color: day.is_weekend ? theme.weekend : theme.muted }}
          >
            {weekday}
          </span>
          {(showMonth || d === 1) && (
            <span className="text-[9px] tabular-nums" style={{ color: theme.muted }}>
              {fmtMonthName(lang, new Date(y, m - 1, 1), 'short')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className="text-[22px] leading-none font-semibold tabular-nums"
            style={{ color: day.is_today ? theme.today : theme.ink }}
          >
            {d}
          </span>
          {day.is_today && (
            <span
              className="text-[9.5px] px-1.5 py-[1px] rounded-full font-medium"
              style={{ backgroundColor: withAlpha(theme.today, 0.12), color: theme.today }}
            >
              {t('topbar.today')}
            </span>
          )}
          {day.holiday?.is_workday_made_up && (
            <span
              className="text-[9px] px-1 rounded leading-tight"
              style={{ backgroundColor: withAlpha(theme.warning, 0.14), color: theme.warningInk }}
            >
              {t('calendar.makeUpWorkday')}
            </span>
          )}
          {day.holiday?.name && (
            <span
              className="text-[9px] px-1 rounded leading-tight truncate max-w-[64px]"
              style={{ backgroundColor: withAlpha(theme.danger, 0.1), color: theme.dangerInk }}
              title={day.holiday.name}
            >
              {day.holiday.name}
            </span>
          )}
        </div>
      </div>

      {/* 正文：全天 → 延续条 → 定时日程 → 事件 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1.5 flex flex-col gap-[3px]">
        {isEmpty ? (
          <span
            className={clsx('text-[11px] mt-1', hover && 'opacity-100')}
            style={{ color: theme.muted, opacity: hover ? 1 : 0.55 }}
          >
            {t('calendar.noPlans')}
          </span>
        ) : (
          <>
            {shown.map((r) => r.node)}
            {hidden > 0 && (
              <span className="text-[10px] tabular-nums" style={{ color: theme.muted }}>
                {tPlural('calendar.scheduleMore', hidden)}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
})
