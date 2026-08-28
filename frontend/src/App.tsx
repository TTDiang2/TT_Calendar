import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useViewData, useCountdown } from './hooks/useApi'
import { toggleLayer, moveDay, getTodoStats, getTodos, getSyncStatus, getSyncConfig, syncNow, refreshDueSubscriptions } from './api/client'
import { shiftMonthKey, shiftYearKey } from './data'
import type { CalEvent, Layer, MonthData, TopTab, TodoViewMode, ViewMode, YearData } from './types'
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
  SubscriptionDialog,
  ContextMenu,
  DotEntryDialog,
  ColorEntryDialog,
} from './components/dialogs'
import { SettingsDialog } from './components/SettingsDialog'
import { ReminderBanner } from './components/ReminderBanner'

type DialogState =
  | { kind: 'event'; date: string; event?: CalEvent | null }
  | { kind: 'schedule'; date: string }
  | { kind: 'coloring'; date: string }
  | { kind: 'dot'; date: string }
  | { kind: 'color'; date: string }
  | { kind: 'search' }
  | { kind: 'subscription' }
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
  const [todoView, setTodoViewState] = useState<TodoViewMode>(() => {
    const v = localStorage.getItem('todo-view')
    return v === 'matrix' || v === 'kanban' || v === 'gantt' || v === 'jar' || v === 'stickies' ? v : 'list'
  })
  const setTodoView = (v: TodoViewMode) => {
    localStorage.setItem('todo-view', v)
    setTodoViewState(v)
  }
  const [dialog, setDialog] = useState<DialogState>(null)
  const [exitSync, setExitSync] = useState<{ state: 'syncing' } | { state: 'failed'; error: string } | null>(null)
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

  // 启动自动同步：延迟到首屏渲染后静默执行，失败不打扰
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const [st, cfg] = await Promise.all([getSyncStatus(), getSyncConfig()])
        if (st.configured && cfg.auto_on_start) {
          await syncNow()
          qc.invalidateQueries()
        }
      } catch {
        /* 网络异常等，静默跳过 */
      }
      // 订阅自动更新：enabled+auto_update+今日未刷的订阅静默拉取（如集思录）
      try {
        const r = await refreshDueSubscriptions()
        if (r.refreshed.some((x) => x.ok && (x.inserted ?? 0) > 0)) {
          qc.invalidateQueries({ queryKey: ['view'] })
        }
      } catch {
        /* 拉取失败不打扰启动 */
      }
    }, 2000)
    return () => clearTimeout(t)
  }, [qc])

  // 关闭前自动同步（仅 Tauri 桌面版）：拦截窗口关闭 → 同步 → 自动退出；
  // 失败时询问（重试/强制退出/取消）；「正在进行中」视为已有同步在跑，直接退出
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return
    let unlisten: (() => void) | null = null
    let cancelled = false
    import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const w = getCurrentWindow()
      unlisten = await w.onCloseRequested(async (event) => {
        try {
          const [st, cfg] = await Promise.all([getSyncStatus(), getSyncConfig()])
          if (!st.configured || !cfg.sync_on_close) return
          event.preventDefault()
          setExitSync({ state: 'syncing' })
          try {
            await syncNow()
            await w.destroy()
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (msg.includes('正在进行')) {
              await w.destroy()
              return
            }
            setExitSync({ state: 'failed', error: msg })
          }
        } catch {
          /* 配置读取失败（后端已死等）→ 不拦截，正常关闭 */
        }
      })
      if (cancelled) unlisten?.()
    })
    return () => { cancelled = true; unlisten?.() }
  }, [])

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
      {exitSync && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl px-8 py-6 w-[360px] text-center">
            {exitSync.state === 'syncing' ? (
              <>
                <div className="mx-auto mb-3 w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-700">正在同步，同步完成后会自动退出……</p>
              </>
            ) : (
              <>
                <p className="text-sm text-red-600 font-medium mb-1">关闭前同步失败</p>
                <p className="text-xs text-gray-500 mb-4 break-all max-h-24 overflow-y-auto">{exitSync.error}</p>
                <div className="flex justify-center gap-2">
                  <button
                    onClick={async () => {
                      setExitSync({ state: 'syncing' })
                      try {
                        await syncNow()
                        const { getCurrentWindow } = await import('@tauri-apps/api/window')
                        await getCurrentWindow().destroy()
                      } catch (e) {
                        setExitSync({ state: 'failed', error: e instanceof Error ? e.message : String(e) })
                      }
                    }}
                    className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    重试同步
                  </button>
                  <button
                    onClick={async () => {
                      const { getCurrentWindow } = await import('@tauri-apps/api/window')
                      await getCurrentWindow().destroy()
                    }}
                    className="px-4 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                  >
                    强制退出
                  </button>
                  <button
                    onClick={() => setExitSync(null)}
                    className="px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg"
                  >
                    取消关闭
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <TopBar
        title={isLoading ? '加载中…' : title}
        topTab={topTab}
        mode={mode}
        todoView={todoView}
        onTopTabChange={setTopTab}
        onModeChange={setMode}
        onTodoViewChange={setTodoView}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        onToday={goToday}
        canPrev={true}
        canNext={true}
        onOpenSearch={() => setDialog({ kind: 'search' })}
        onOpenSubscription={() => setDialog({ kind: 'subscription' })}
        onOpenSettings={() => setDialog({ kind: 'settings' })}
      />
      <ReminderBanner onJumpToTodo={() => setTopTab('todo')} />
      <div className="flex-1 flex overflow-hidden">
        {topTab === 'todo' ? (
          <TodoView viewMode={todoView} />
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
      {dialog?.kind === 'subscription' && (
        <SubscriptionDialog onClose={() => setDialog(null)} />
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
