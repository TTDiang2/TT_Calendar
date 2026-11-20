import { Fragment, memo, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import type { Day, Layer } from '../types'
import { parseDate, pickContrastColor, softTextColor, softTint } from '../data'
import { getTodoBusyConfig } from '../api/client'
import { useT, useTPlural } from '../i18n'
import type { CalendarColorStyle } from '../lib/calendar-style'
import { useCalendarTheme, withAlpha } from '../lib/calendar-theme'
import { colorLayersOf, dotsOf, visibleEventsOf } from '../lib/day-presentation'

interface Props {
  day: Day
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
  maxLabels?: number
}

export const DayCell = memo(function DayCell({ day, layers, selected, dragOver, colorStyle, onClick, onDoubleClick, onContextMenu, onDragStart, onDragEnter, onDrop, maxLabels = 3 }: Props) {
  const t = useT()
  const tPlural = useTPlural()
  const { theme } = useCalendarTheme()
  const { y, m, d } = parseDate(day.date)
  const isSoft = colorStyle === 'soft'
  const isWeekend = [0, 6].includes(new Date(y, m - 1, d).getDay())
  const { data: busyConfig } = useQuery({ queryKey: ['todoBusyConfig'], queryFn: getTodoBusyConfig, staleTime: 60_000 })

  // 可见事件、色点、底色三组规则与周列共用一份（lib/day-presentation），
  // 月格只管版式，避免两个视图各写一套后慢慢走偏。
  const visibleEvents = useMemo(() => visibleEventsOf(day, layers), [day, layers])
  const dots = useMemo(() => dotsOf(day, layers, visibleEvents), [day, layers, visibleEvents])
  const colorLayers = useMemo(
    () => colorLayersOf(day, layers, theme, busyConfig),
    [day, layers, theme, busyConfig],
  )

  const scheduleItems = day.schedule_items ?? []
  const primaryColor = colorLayers[colorLayers.length - 1]?.color
  const softBg = primaryColor ? softTint(primaryColor) : undefined
  const softText = softBg ? softTextColor(softBg) : '#111827'
  // 今天 / 选中 / 拖拽都用同一个 box-shadow 环，避免 Tailwind ring 与主题色打架
  const ringShadow = dragOver
    ? '0 0 0 2px #4ade80'
    : day.is_today
      ? `0 0 0 2px ${theme.today}`
      : selected
        ? `0 0 0 2px ${withAlpha(theme.accent, 0.35)}`
        : undefined

  return (
    <div
      onClick={() => onClick(day.date)}
      onDoubleClick={() => onDoubleClick(day.date)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu({ clientX: e.clientX, clientY: e.clientY }, day.date)
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', day.date)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(day.date)
      }}
      onDragEnter={() => onDragEnter(day.date)}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop(day.date)
      }}
      data-tour={day.is_today ? 'today' : undefined}
      className={clsx(
        'relative p-1.5 rounded-lg border cursor-pointer transition-all flex flex-col gap-0.5 overflow-hidden',
        // 柔和模式左边有 4px 色条，正文让出一点呼吸位
        isSoft && 'pl-2.5',
        maxLabels >= 6 ? 'min-h-[160px]' : 'min-h-[104px]',
        'hover:shadow-md hover:-translate-y-0.5',
        day.is_other_month && 'opacity-40',
        dragOver && 'scale-[1.02]',
      )}
      style={{
        borderColor: theme.border,
        borderWidth: !isSoft && day.is_today ? 2 : 1,
        boxShadow: ringShadow,
      }}
    >
      {/* 底色层：图层开关一变，底色组成就变。用 composition key + AnimatePresence
          做一次交叉淡出/淡入——旧的底色退场、新的底色进场，所以「关掉充实度」
          在月网格上是看得见的过渡，而不是唰一下变白。 */}
      <AnimatePresence initial={false}>
        <motion.div
          key={colorLayers.map((c) => c.id).join('|') || 'empty'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="absolute inset-0"
        >
          {colorLayers.length === 1 ? (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: isSoft ? softTint(colorLayers[0].color) : colorLayers[0].color }}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col">
              {colorLayers.map((c, i) => (
                <Fragment key={c.id}>
                  <div
                    className="flex-1"
                    style={{ backgroundColor: isSoft ? softTint(c.color) : c.color }}
                  />
                  {i < colorLayers.length - 1 && <div className="h-[2px] bg-white flex-shrink-0" />}
                </Fragment>
              ))}
            </div>
          )}

          {/* 柔和模式的深浅刻度：底色已压到纸白，强弱改由左侧满色细条传达，
              多层（今天：预测 + 已完成）时分段堆叠，与上面的底色层一一对应。 */}
          {isSoft && (
            <span className="absolute left-[2px] top-2 bottom-2 flex w-[4px] flex-col overflow-hidden rounded-full" aria-hidden="true">
              {colorLayers.map((c) => (
                <span key={c.id} className="flex-1" style={{ backgroundColor: c.color }} />
              ))}
            </span>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="relative z-10 flex flex-col gap-0.5 flex-1 min-h-0">
      {/* 头部：日期 + 角标 */}
      <div className="flex items-center justify-between">
        <span
          className={clsx(
            'text-sm font-semibold',
            day.is_today && 'text-white rounded-full w-5 h-5 flex items-center justify-center text-xs',
          )}
          style={day.is_today ? { backgroundColor: theme.today } : (() => {
            if (isSoft) {
              return { color: isWeekend && softText !== '#ffffff' ? theme.weekend : softText }
            }
            const last = colorLayers[colorLayers.length - 1]
            if (!last) return undefined
            return { color: pickContrastColor(last.color) }
          })()}
        >
          {d}
        </span>
        {day.holiday?.is_workday_made_up && (
          <span className={clsx(
            'text-[9px] px-1 rounded leading-tight',
            isSoft ? 'bg-white/80 text-amber-800' : 'bg-amber-500 text-white',
          )}>{t('calendar.makeUpWorkday')}</span>
        )}
        {day.holiday?.name && (
          <span className={clsx(
            'text-[9px] px-1 rounded leading-tight truncate max-w-[40px]',
            isSoft ? 'bg-white/80 text-purple-700' : 'bg-purple-500 text-white',
          )}>
            {day.holiday.name}
          </span>
        )}
      </div>

      {/* 色点 */}
      {dots.length > 0 && (
        <div className="flex gap-0.5">
          {dots.map((c, i) => (
            <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
          ))}
        </div>
      )}

      {/* 事件标签 */}
      {(() => {
        const last = colorLayers[colorLayers.length - 1]
        const labelColor = isSoft ? softText : last ? pickContrastColor(last.color) : '#6b7280'
        return (
          <div className="flex flex-col gap-px overflow-hidden">
            {visibleEvents.slice(0, maxLabels).map((ev, i) => (
              <span
                key={ev.id ?? i}
                className="text-[10px] truncate leading-tight"
                style={{ color: labelColor }}
                title={ev.title}
              >
                {ev.title}
              </span>
            ))}
            {visibleEvents.length > maxLabels && (
              <span className="text-[10px]" style={{ color: isSoft ? (softText === '#ffffff' ? 'rgba(255,255,255,0.72)' : '#6b7280') : last ? labelColor : '#9ca3af' }}>+{visibleEvents.length - maxLabels}</span>
            )}
          </div>
        )
      })()}

      {/* 日程：多日日程首日显示标题，后续天画延续条（避免长日程占满每个格子） */}
      {scheduleItems.length > 0 && (
        <div className="flex flex-col gap-px overflow-hidden">
          {(() => {
            const last = colorLayers[colorLayers.length - 1]
            const labelColor = isSoft ? softText : last ? pickContrastColor(last.color) : '#3D6BFB'
            const sorted = [...scheduleItems].sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
            // 延续天（span_index > 1）不占文字行，画细色条
            const continuations = sorted.filter((i) => (i.span_index ?? 1) > 1)
            const heads = sorted.filter((i) => (i.span_index ?? 1) === 1)
            const shown = heads.slice(0, Math.max(1, maxLabels - continuations.length))
            const hidden = sorted.length - continuations.length - shown.length
            return (
              <>
                {continuations.map((it, i) => (
                  <span
                    key={`cont-${it.id ?? i}`}
                    className="block h-[6px] rounded-full my-[2px] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
                    style={{
                      backgroundColor: it.color ?? '#3D6BFB',
                      backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0.28), rgba(255,255,255,0) 30%, rgba(0,0,0,0.06))',
                    }}
                    title={t('calendar.contTitle', { title: it.title, i: String(it.span_index), total: String(it.span_total), start: String(it.span_start) })}
                  />
                ))}
                {shown.map((it, i) => (
                  <span
                    key={it.id ?? `s-${i}`}
                    className="text-[10px] truncate leading-tight font-medium"
                    style={{ color: labelColor }}
                    title={it.span_total && it.span_total > 1
                      ? t('calendar.multiDayTitle', { title: it.title, start: String(it.span_start), end: String(it.span_end), total: it.span_total })
                      : it.title}
                  >
                    {it.start_time ? `${it.start_time} ${it.title}` : it.title}
                    {it.span_total && it.span_total > 1 && (
                      <span className="opacity-70">{t('calendar.spanDays', { n: it.span_total })}</span>
                    )}
                  </span>
                ))}
                {hidden > 0 && (
                  <span className="text-[10px]" style={{ color: labelColor }}>{tPlural('calendar.scheduleMore', hidden)}</span>
                )}
              </>
            )
          })()}
        </div>
      )}
      </div>
    </div>
  )
})