/* eslint-disable no-restricted-syntax -- 插件市场是高级功能，文案中英并列，避免为 8 种语言各写一套 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Download, FolderOpen, Loader2, Puzzle, RefreshCw, Trash2 } from 'lucide-react'
import {
  getPlugins, getVersionInfo, installPlugin, reloadPlugins, uninstallPlugin,
  type PluginMarketItem,
} from '../api/client'
import { activeLang } from '../i18n'

const zh = () => activeLang().startsWith('zh')

function text() {
  return zh()
    ? {
        sectionTitle: '插件',
        desc: '插件是运行在应用内的 Python 代码，与主程序同权限。只安装你信任的来源。',
        refresh: '刷新列表',
        openFolder: '打开插件目录',
        copied: '路径已复制',
        offline: '无法连接插件源，且没有本地缓存。',
        retry: '重试',
        installed: '已安装',
        available: '可安装',
        update: '可更新',
        modified: '本地已修改',
        install: '安装',
        updateAction: '更新',
        uninstall: '卸载',
        confirmUninstall: '确认卸载',
        cancel: '取消',
        layers: '个图层',
        warningTitle: '安装前确认',
        warningBody: (name: string) => `「${name}」将以与 TT Calendar 相同的权限运行：它可以读取你的全部日历数据，也可以访问网络。只安装你信任的插件。`,
        warningConfirm: '确认安装',
        loading: '加载中…',
        reload: '重新加载插件',
        reloaded: '已重新加载',
        failed: '操作失败',
        empty: '暂无可安装的插件。',
        updateHint: '更新会覆盖本地修改。',
        needsInternet: '需要联网',
      }
    : {
        sectionTitle: 'Plugins',
        desc: 'Plugins are Python code that runs inside the app with the same permissions. Only install sources you trust.',
        refresh: 'Refresh',
        openFolder: 'Open plugin folder',
        copied: 'Path copied',
        offline: 'Cannot reach the plugin registry and no local cache is available.',
        retry: 'Retry',
        installed: 'Installed',
        available: 'Available',
        update: 'Update',
        modified: 'Modified locally',
        install: 'Install',
        updateAction: 'Update',
        uninstall: 'Uninstall',
        confirmUninstall: 'Confirm',
        cancel: 'Cancel',
        layers: 'layers',
        warningTitle: 'Before installing',
        warningBody: (name: string) => `"${name}" will run with the same permissions as TT Calendar: it can read all of your calendar data and access the network. Only install plugins you trust.`,
        warningConfirm: 'Install anyway',
        loading: 'Loading…',
        reload: 'Reload plugins',
        reloaded: 'Reloaded',
        failed: 'Failed',
        empty: 'No plugins available.',
        updateHint: 'Updating replaces local changes.',
        needsInternet: 'Needs internet',
      }
}

function formatSize(size: number | null): string {
  if (!size) return ''
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function PluginManager() {
  const c = text()
  const qc = useQueryClient()
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['plugins'],
    queryFn: getPlugins,
    staleTime: 60_000,
  })
  const { data: version } = useQuery({ queryKey: ['version'], queryFn: getVersionInfo })
  const [pending, setPending] = useState<PluginMarketItem | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refreshSources = () => {
    qc.invalidateQueries({ queryKey: ['plugins'] })
    qc.invalidateQueries({ queryKey: ['sources'] })
    qc.invalidateQueries({ queryKey: ['layers'] })
    qc.invalidateQueries({ queryKey: ['view'] })
  }

  const installMut = useMutation({
    mutationFn: installPlugin,
    onSuccess: () => {
      setPending(null)
      refreshSources()
    },
  })
  const removeMut = useMutation({
    mutationFn: uninstallPlugin,
    onSuccess: () => {
      setConfirmRemove(null)
      refreshSources()
    },
  })
  const reloadMut = useMutation({
    mutationFn: reloadPlugins,
    onSuccess: refreshSources,
  })

  const openFolder = async () => {
    const path = version?.plugins_dir
    if (!path) return
    try {
      if ('__TAURI_INTERNALS__' in window) {
        const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
        await revealItemInDir(path)
      } else {
        throw new Error('browser')
      }
    } catch {
      await navigator.clipboard.writeText(path).catch(() => undefined)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  const items = [...(data?.plugins ?? [])].sort((a, b) => {
    const rank = (p: PluginMarketItem) => (p.update_available ? 0 : p.installed ? 1 : 2)
    return rank(a) - rank(b) || a.display_name.localeCompare(b.display_name)
  })
  const error = installMut.error ?? removeMut.error ?? reloadMut.error

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold cal-muted uppercase tracking-wide">{c.sectionTitle}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[color:var(--cal-border)] cal-hover-bg"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : undefined} />
            {c.refresh}
          </button>
          <button
            onClick={openFolder}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[color:var(--cal-border)] cal-hover-bg"
          >
            <FolderOpen size={12} />
            {copied ? c.copied : c.openFolder}
          </button>
        </div>
      </div>
      <p className="text-xs cal-muted mb-2">{c.desc}</p>

      {error && (
        <div className="mb-2 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-600">
          {c.failed}: {error.message}
        </div>
      )}

      {pending && (
        <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50/70 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 text-amber-600 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-amber-900">{c.warningTitle}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">{c.warningBody(pending.display_name)}</p>
              {pending.update_available && <p className="mt-1 text-[11px] text-amber-800">{c.updateHint}</p>}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => installMut.mutate(pending.source_id)}
              disabled={installMut.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-40"
            >
              {installMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {c.warningConfirm}
            </button>
            <button
              onClick={() => setPending(null)}
              className="rounded-md border border-amber-300 px-3 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
            >
              {c.cancel}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs cal-muted"><Loader2 size={13} className="animate-spin" /> {c.loading}</div>
      ) : data?.offline ? (
        <div className="rounded-lg border border-[color:var(--cal-border)] px-3 py-3 text-xs cal-muted">
          {c.offline}
          <button onClick={() => refetch()} className="ml-2 underline">{c.retry}</button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs cal-muted">{c.empty}</p>
      ) : (
        <div className="max-h-[300px] overflow-y-auto rounded-lg border border-[color:var(--cal-border)]">
          {items.map((item, index) => {
            const badge = item.update_available
              ? { label: c.update, className: 'bg-amber-100 text-amber-800' }
              : item.installed
                ? { label: c.installed, className: 'bg-emerald-100 text-emerald-800' }
                : { label: c.available, className: 'bg-gray-100 text-gray-600' }
            return (
              <div
                key={item.source_id}
                className={`flex items-center gap-3 px-3 py-2 ${index > 0 ? 'border-t border-[color:var(--cal-border)]' : ''}`}
              >
                <Puzzle size={15} className="flex-shrink-0 cal-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium cal-ink">{item.display_name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${badge.className}`}>{badge.label}</span>
                    {item.local_modified && <span className="text-[10px] text-amber-700">{c.modified}</span>}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] cal-muted">
                    {item.source_id}
                    {item.layer_count > 0 && ` · ${item.layer_count} ${c.layers}`}
                    {item.size ? ` · ${formatSize(item.size)}` : ''}
                    {item.needs_internet ? ` · ${c.needsInternet}` : ''}
                  </div>
                </div>
                {confirmRemove === item.source_id ? (
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      onClick={() => removeMut.mutate(item.source_id)}
                      disabled={removeMut.isPending}
                      className="rounded-md bg-red-600 px-2 py-1 text-[11px] text-white hover:bg-red-700 disabled:opacity-40"
                    >
                      {c.confirmUninstall}
                    </button>
                    <button
                      onClick={() => setConfirmRemove(null)}
                      className="rounded-md border border-[color:var(--cal-border)] px-2 py-1 text-[11px] cal-muted"
                    >
                      {c.cancel}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      onClick={() => setPending(item)}
                      disabled={installMut.isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-blue-500 px-2.5 py-1 text-[11px] text-white hover:bg-blue-600 disabled:opacity-40"
                    >
                      <Download size={11} />
                      {item.update_available ? c.updateAction : c.install}
                    </button>
                    {item.installed && (
                      <button
                        onClick={() => setConfirmRemove(item.source_id)}
                        className="rounded-md border border-[color:var(--cal-border)] p-1 text-gray-400 hover:text-red-500"
                        title={c.uninstall}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => reloadMut.mutate()}
          disabled={reloadMut.isPending}
          className="inline-flex items-center gap-1 text-[11px] text-cal-muted hover:underline"
        >
          {reloadMut.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          {reloadMut.isSuccess ? c.reloaded : c.reload}
        </button>
      </div>
    </section>
  )
}
