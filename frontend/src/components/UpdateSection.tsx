/* eslint-disable no-restricted-syntax -- 更新检查是桌面安装版专属功能，文案中英并列，不为 8 种语言各写一套 */
import { useRef, useState } from 'react'
import { Download, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import type { Update } from '@tauri-apps/plugin-updater'
import { activeLang } from '../i18n'

const zh = () => activeLang().startsWith('zh')

function text() {
  return zh()
    ? {
        title: '版本与更新',
        desc: '依次尝试 GitHub、镜像源与 Gitee 检查新版本，下载完成后自动重启。日历数据和插件都在用户目录，升级不会动它们。',
        check: '检查更新',
        checking: '正在检查…',
        latest: '已是最新版本',
        available: (v: string) => `发现新版本 v${v}`,
        notes: '更新说明',
        install: '下载并安装',
        downloading: '正在下载…',
        installing: '安装中，完成后会自动重启…',
        restartHint: '安装完成，点此重启生效',
        restart: '立即重启',
        failed: '检查失败',
        noRelease: '发布页上还没有更新信息',
        network: '连不上更新服务器，检查一下网络',
        detail: '技术细节',
        unsupported: '仅桌面安装版支持自动更新。',
        retry: '重试',
        releasePage: '打开发布页',
        mirrorPage: '国内镜像下载',
        timeoutHint: '（每个源最多等 5 秒，会自动换下一个）',
      }
    : {
        title: 'Version & updates',
        desc: 'Tries GitHub, then mirror sources, then Gitee, and restarts when done. Your calendar data and plugins live in your user folder, so upgrading never touches them.',
        check: 'Check for updates',
        checking: 'Checking…',
        latest: 'You are on the latest version',
        available: (v: string) => `Version v${v} is available`,
        notes: 'Release notes',
        install: 'Download and install',
        downloading: 'Downloading…',
        installing: 'Installing — the app will restart when it finishes…',
        restartHint: 'Installed. Restart to finish.',
        restart: 'Restart now',
        failed: 'Check failed',
        noRelease: 'No update information published yet',
        network: 'Cannot reach the update server — check your connection',
        detail: 'Details',
        unsupported: 'Automatic updates are only available in the desktop installer build.',
        retry: 'Retry',
        releasePage: 'Open releases',
        mirrorPage: 'Download from mirror',
        timeoutHint: '(5s per source, then it moves on)',
      }
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available'; version: string; notes: string | null }
  | { kind: 'downloading'; pct: number | null }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string }

const RELEASES_URL = 'https://github.com/TTDiang2/TT_Calendar/releases'
/** Gitee 镜像仓库：国内直连，只放安装包和更新清单，不碰用户数据 */
const MIRROR_URL = 'https://gitee.com/TTDiang/tt-calendar-update/releases'
/**
 * 每个更新源的单次超时。
 *
 * updater 会按 endpoints 顺序逐个试，但 Rust 侧的请求默认没有超时——国内连
 * github.com 时 TCP 会卡到系统默认的 ~21s，后面的镜像源永远轮不到。5 秒是折中：
 * 国内基本可以认定「5 秒还没拿到 JSON = 这个源不通」，海外慢网也够用。
 */
const CHECK_TIMEOUT_MS = 5000

function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 用系统浏览器打开外链：桌面走 opener 插件，Web 预览退回 window.open */
async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}

export function UpdateSection() {
  const c = text()
  /** updater 抛的是 Rust 侧英文错误，直接甩给用户等于没解释，先做一层归类。 */
  const friendly = (raw: string) => {
    if (/valid release JSON|404|not found|release json/i.test(raw)) return c.noRelease
    if (/timed? ?out|network|connect|dns|unreachable/i.test(raw)) return c.network
    return raw
  }
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  // Update 对象不能进 state：它带 Rust 侧资源句柄，重渲染会丢引用
  const updateRef = useRef<Update | null>(null)

  const check = async () => {
    if (!isDesktop()) {
      setPhase({ kind: 'failed', message: c.unsupported })
      return
    }
    setPhase({ kind: 'checking' })
    try {
      const { check: checkUpdate } = await import('@tauri-apps/plugin-updater')
      // 5 秒一源：GitHub 不通就自动落到镜像源，不必让用户干等系统 TCP 超时
      const found = await checkUpdate({ timeout: CHECK_TIMEOUT_MS })
      updateRef.current = found
      setPhase(found
        ? { kind: 'available', version: found.version, notes: found.body ?? null }
        : { kind: 'latest' })
    } catch (e) {
      setPhase({ kind: 'failed', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const install = async () => {
    const update = updateRef.current
    if (!update) return
    setPhase({ kind: 'downloading', pct: null })
    let total = 0
    let got = 0
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0
          setPhase({ kind: 'downloading', pct: total ? 0 : null })
        } else if (event.event === 'Progress') {
          got += event.data.chunkLength
          setPhase({ kind: 'downloading', pct: total ? Math.min(100, Math.round((got / total) * 100)) : null })
        } else {
          setPhase({ kind: 'downloading', pct: 100 })
        }
      })
      setPhase({ kind: 'ready' })
    } catch (e) {
      setPhase({ kind: 'failed', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const restart = async () => {
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch {
      /* 非桌面环境：调用不到，忽略 */
    }
  }

  const openReleases = async () => {
    await openExternal(RELEASES_URL)
  }

  const openMirror = async () => {
    await openExternal(MIRROR_URL)
  }

  const busy = phase.kind === 'checking' || phase.kind === 'downloading'

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold cal-muted uppercase tracking-wide">{c.title}</h3>
        <button
          onClick={check}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-[color:var(--cal-border)] px-2 py-1 text-[11px] cal-hover-bg disabled:opacity-40"
        >
          <RefreshCw size={12} className={phase.kind === 'checking' ? 'animate-spin' : undefined} />
          {phase.kind === 'checking' ? c.checking : c.check}
        </button>
      </div>
      <p className="mb-2 text-xs cal-muted">{c.desc}</p>

      {phase.kind === 'latest' && (
        <p className="rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700">{c.latest}</p>
      )}

      {phase.kind === 'available' && (
        <div className="rounded-lg border border-[color:var(--cal-border)] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium cal-ink">{c.available(phase.version)}</span>
            <button
              onClick={install}
              className="inline-flex items-center gap-1 rounded-md bg-blue-500 px-2.5 py-1 text-[11px] text-white hover:bg-blue-600"
            >
              <Download size={11} />
              {c.install}
            </button>
          </div>
          {phase.notes && (
            <div className="mt-2">
              <div className="text-[11px] cal-muted">{c.notes}</div>
              <p className="mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed cal-muted">{phase.notes}</p>
            </div>
          )}
        </div>
      )}

      {phase.kind === 'downloading' && (
        <div className="rounded-md bg-blue-50 px-2 py-1.5 text-[11px] text-blue-700">
          <span className="inline-flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" />
            {phase.pct == null ? c.downloading : `${c.downloading} ${phase.pct}%`}
          </span>
          {phase.pct != null && (
            <div className="mt-1 h-1 overflow-hidden rounded bg-blue-100">
              <div className="h-full bg-blue-500 transition-[width] duration-200" style={{ width: `${phase.pct}%` }} />
            </div>
          )}
          <div className="mt-1 text-blue-600/80">{c.installing}</div>
        </div>
      )}

      {phase.kind === 'ready' && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700">
          <span>{c.restartHint}</span>
          <button
            onClick={restart}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] text-white hover:bg-emerald-700"
          >
            <RotateCcw size={11} />
            {c.restart}
          </button>
        </div>
      )}

      {phase.kind === 'failed' && (
        <div className="rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-600">
          <div>{c.failed}：{friendly(phase.message)}</div>
          {friendly(phase.message) !== phase.message && (
            <div className="mt-0.5 break-all text-[10px] text-red-400" title={c.detail}>{phase.message}</div>
          )}
          <div className="mt-1 flex items-center gap-2">
            <button onClick={check} className="underline">{c.retry}</button>
            <button onClick={openReleases} className="underline">{c.releasePage}</button>
            <button onClick={openMirror} className="underline">{c.mirrorPage}</button>
          </div>
          <div className="mt-0.5 text-[10px] text-red-400">{c.timeoutHint}</div>
        </div>
      )}
    </section>
  )
}
