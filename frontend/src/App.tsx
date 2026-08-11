import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useViewData, useCountdown } from './hooks/useApi'
import { toggleLayer, moveDay, getTodoStats, getTodos } from './api/client'
import { shiftMonthKey, shiftYearKey } from './data'
import type { CalEvent, Layer, MonthData, TopTab, ViewMode, YearData } from './types'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { MonthGrid } from './components/MonthGrid'
import { WeekView } from './components/WeekView'
import { DayView } from './components/DayView'
import { YearView } from './components/YearView'
import { DetailPanel } from './components/DetailPanel'
import { TodoView } from './components/TodoView'
import { CountdownView } from './components/CountdownView'
import {
  EventEditor,
  ScheduleEditor,
  ColoringPicker,
  SearchDialog,
  ImportDialog,
  ContextMenu,
  DotEntryDialog,
  ColorEntryDialog,
} from './components/dialogs'
import { SettingsDialog } from './components/SettingsDialog'

type DialogState =
  | { kind: 'event'; date: string; event?: CalEvent | null }
  | { kind: 'schedule'; date: string }
  | { kind: 'coloring'; date: string }
  | { kind: 'dot'; date: string }
  | { kind: 'color'; date: string }
  | { kind: 'search' }
  | { kind: 'import' }
  | { kind: 'settings' }
  | null

interface CtxMenuState {
  x: number
  y: number
  date: string
}

export default function App() {
  const [monthKey, setMonthKey] = useState('2026-8')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [mode, setMode] = useState<ViewMode>('month')
  const [topTab, setTopTab] = useState<TopTab>('calendar')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null)
  const dragSource = useRef<string | null>(null)
  const qc = useQueryClient()

  // week/day 视图需要具体日期 anchor；selectedDate 为空时用当月 1 号（零填充，backend date.fromisoformat 要求）
  const dayAnchor = useMemo(() => {
    if (selectedDate) return selectedDate
    const [y, m] = monthKey.split('-').map(Number)
    return `${y}-${String(m).padStart(2, '0')}-01`
  }, [selectedDate, monthKey])
  const { data: monthData, isLoading } = useViewData(
    mode === 'countdown' ? 'month' : mode,
    mode === 'week' || mode === 'day' ? dayAnchor : monthKey,
  )
  const { data: countdownData } = useCountdown()

  // 预取待办数据：首次进入日历页时就后台拉取，切到待办 tab 秒开
  useEffect(() => {
    if (topTab === 'calendar') {
      qc.prefetchQuery({ queryKey: ['todoStats', null], queryFn: () => getTodoStats(undefined) })
      qc.prefetchQuery({ queryKey: ['todos', null, 'incomplete', 'due_importance'], queryFn: () => getTodos({ status: 'notStarted', sort: 'due_importance' }) })
    }
  }, [qc, topTab])

  const layers = monthData?.layers ?? []

  const toggleMutation = useMutation({
    mutationFn: ({ layerId, enabled }: { layerId: string; enabled: boolean }) =>
      toggleLayer(layerId, enabled),
    onMutate: async ({ layerId, enabled }) => {
      const cache = qc.getQueryData<MonthData>(['view', mode, mode === 'week' || mode === 'day' ? dayAnchor : monthKey])
      if (cache) {
        qc.setQueryData(['view', mode, mode === 'week' || mode === 'day' ? dayAnchor : monthKey], {
          ...cache,
          layers: cache.layers.map((l) => (l.layer_id === layerId ? { ...l, enabled } : l)),
        })
      }
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['view'] })
    },
  })

  const moveMutation = useMutation({
    mutationFn: ({ src, dst }: { src: string; dst: string }) => moveDay(src, dst),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['view'] }),
  })

  function toggleLayerFn(layerId: string) {
    const current = layers.find((l) => l.layer_id === layerId)
    if (!current) return
    toggleMutation.mutate({ layerId, enabled: !current.enabled })
  }

  function navigate(delta: number) {
    if (mode === 'countdown') return
    if (mode === 'week') {
      const d = new Date(dayAnchor + 'T00:00:00')
      d.setDate(d.getDate() + delta * 7)
      shiftAnchor(d)
    } else if (mode === 'day') {
      const d = new Date(dayAnchor + 'T00:00:00')
      d.setDate(d.getDate() + delta)
      shiftAnchor(d)
    } else {
      setMonthKey((k) => (mode === 'year' ? shiftYearKey(k, delta) : shiftMonthKey(k, delta)))
    }
  }

  function shiftAnchor(d: Date) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setSelectedDate(iso)
  }

  function goToday() {
    const now = new Date()
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (mode === 'week' || mode === 'day') {
      shiftAnchor(now)
    } else {
      setMonthKey(`${now.getFullYear()}-${now.getMonth() + 1}`)
      setSelectedDate(iso)
    }
  }

  const openEvent = useCallback((date: string, event: CalEvent | null = null) => {
    setDialog({ kind: 'event', date, event })
  }, [])

  const handleDoubleClick = useCallback((date: string) => openEvent(date), [openEvent])

  const handleContextMenu = useCallback(
    (e: { clientX: number; clientY: number }, date: string) => {
      setSelectedDate(date)
      setCtxMenu({ x: e.clientX, y: e.clientY, date })
    },
    [],
  )

  const handleDragStart = useCallback((date: string) => {
    dragSource.current = date
  }, [])

  const handleDrop = useCallback(
    (dst: string) => {
      const src = dragSource.current
      dragSource.current = null
      if (!src || src === dst) return
      moveMutation.mutate({ src, dst })
    },
    [moveMutation],
  )

  // 键盘快捷键：←→ 翻月，T 今天，N 新建，/ 搜索
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (dialog || ctxMenu) return
      if (e.key === 'ArrowLeft') navigate(-1)
      else if (e.key === 'ArrowRight') navigate(1)
      else if (e.key === 't' || e.key === 'T') goToday()
      else if ((e.key === 'n' || e.key === 'N') && selectedDate) openEvent(selectedDate)
      else if (e.key === '/') {
        e.preventDefault()
        setDialog({ kind: 'search' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, ctxMenu, selectedDate, openEvent, mode, dayAnchor])

  const title = useMemo(() => {
    if (!monthData) return '—'
    if (mode === 'year' && 'year' in monthData && !('days' in monthData)) return `${monthData.year} 年`
    return `${monthData.year} 年 ${('month' in monthData ? monthData.month : '')} 月`
  }, [mode, monthData])

  const selectedDay = useMemo(() => {
    if (!selectedDate || !monthData || mode === 'year') return null
    if (!('days' in monthData)) return null
    return monthData.days.find((d) => d.date === selectedDate) ?? null
  }, [selectedDate, monthData, mode])

  function jumpToEvent(ev: CalEvent) {
    const [y, m] = ev.date.split('-').map(Number)
    setMonthKey(`${y}-${m}`)
    setSelectedDate(ev.date)
    setDialog(null)
  }

  const monthData2 = mode === 'year' || !monthData || !('days' in monthData) ? null : monthData
  const importStart = monthData2?.days[6]?.date ?? '2026-08-01'
  const importEnd = monthData2?.days[36]?.date ?? '2026-08-31'

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <TopBar
        title={isLoading ? '加载中…' : title}
        topTab={topTab}
        mode={mode}
        onTopTabChange={setTopTab}
        onModeChange={setMode}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        onToday={goToday}
        canPrev={true}
        canNext={true}
        onOpenSearch={() => setDialog({ kind: 'search' })}
        onOpenImport={() => setDialog({ kind: 'import' })}
        onOpenSettings={() => setDialog({ kind: 'settings' })}
      />
      <div className="flex-1 flex overflow-hidden">
        {topTab === 'todo' ? (
          <TodoView />
        ) : mode === 'countdown' ? (
          <CountdownView />
        ) : (
          <>
            <Sidebar
              layers={layers}
              onToggle={toggleLayerFn}
              countdown={countdownData?.text ?? '…'}
            />
            <main className="flex-1 flex flex-col p-4 min-w-0">
              {isLoading || !monthData ? (
                <div className="flex-1 flex items-center justify-center text-gray-400">加载中…</div>
              ) : mode === 'year' ? (
                <YearView
                  yearData={monthData as YearData}
                  layers={layers}
                  selectedDate={selectedDate}
                  onSelectDate={(date) => {
                    const [y, m] = date.split('-').map(Number)
                    setMonthKey(`${y}-${m}`)
                    setSelectedDate(date)
                    setMode('month')
                  }}
                />
              ) : mode === 'week' ? (
                <WeekView
                  monthData={monthData2!}
                  layers={layers}
                  selectedDate={selectedDate}
                  onSelect={setSelectedDate}
                  onDoubleClick={handleDoubleClick}
                  onContextMenu={handleContextMenu}
                  onDragStart={handleDragStart}
                  onDrop={handleDrop}
                />
              ) : mode === 'day' ? (
                <DayView
                  monthData={monthData2!}
                  layers={layers}
                  selectedDate={selectedDate}
                  onSelect={setSelectedDate}
                  onDoubleClick={handleDoubleClick}
                />
              ) : (
                <MonthGrid
                  monthData={monthData2!}
                  layers={layers}
                  selectedDate={selectedDate}
                  onSelect={setSelectedDate}
                  onDoubleClick={handleDoubleClick}
                  onContextMenu={handleContextMenu}
                  onDragStart={handleDragStart}
                  onDrop={handleDrop}
                />
              )}
            </main>
            {mode !== 'year' && (
              <DetailPanel
                day={selectedDay}
                layers={layers}
                onEditEvent={openEvent}
                onAddEvent={(d) => openEvent(d)}
                onEditSchedule={(d) => setDialog({ kind: 'schedule', date: d })}
                onSetColoring={(d) => setDialog({ kind: 'coloring', date: d })}
                onAddDot={(d) => setDialog({ kind: 'dot', date: d })}
                onAddColor={(d) => setDialog({ kind: 'color', date: d })}
              />
            )}
          </>
        )}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          date={ctxMenu.date}
          onNew={() => {
            const d = ctxMenu.date
            setCtxMenu(null)
            openEvent(d)
          }}
          onSchedule={() => {
            const d = ctxMenu.date
            setCtxMenu(null)
            setDialog({ kind: 'schedule', date: d })
          }}
          onColoring={() => {
            const d = ctxMenu.date
            setCtxMenu(null)
            setDialog({ kind: 'coloring', date: d })
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {dialog?.kind === 'event' && (
        <EventEditor
          date={dialog.date}
          layers={layers}
          event={dialog.event}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'schedule' && (
        <ScheduleEditor
          date={dialog.date}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'coloring' && (
        <ColoringPicker
          date={dialog.date}
          current={selectedDay?.coloring_level ?? null}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'dot' && (
        <DotEntryDialog
          date={dialog.date}
          layers={layers}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'color' && (
        <ColorEntryDialog
          date={dialog.date}
          layers={layers}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'search' && (
        <SearchDialog onClose={() => setDialog(null)} onJump={jumpToEvent} />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog
          defaultStart={importStart}
          defaultEnd={importEnd}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'settings' && (
        <SettingsDialog
          layers={layers}
          onToggleLayer={toggleLayerFn}
          defaultStart={importStart}
          defaultEnd={importEnd}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
