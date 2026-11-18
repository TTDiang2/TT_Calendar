import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getApiBase } from '../api/client'

// 首次启动页发生在用户尚未进入应用之前，用中英并列文案而不是 i18n：
// 此时语言选择刚完成但设置尚未落盘，双语是最稳妥的表达。
/* eslint-disable no-restricted-syntax */

type Phase = 'loading' | 'first' | 'ready'

type StatusPayload = {
  first_run: boolean
  data_dir: string
  plugins_dir: string
  version: string
}

const FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 18, padding: '13px 0', borderTop: '1px solid var(--cal-border)' }}>
      <div style={{ flex: '0 0 150px', fontSize: 12, letterSpacing: '0.04em', color: 'var(--cal-muted)' }}>
        {label}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: mono ? 11.5 : 13,
          lineHeight: 1.65,
          color: 'var(--cal-ink)',
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Consolas, monospace' : FONT,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
    </div>
  )
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetch(`${getApiBase()}/api/onboarding/status`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<StatusPayload>
      })
      .then((data) => {
        if (!alive) return
        setStatus(data)
        setPhase(data.first_run ? 'first' : 'ready')
      })
      .catch(() => {
        // 状态端点异常不应把用户挡在门外；直接进入应用，后续设置里仍可导入。
        if (alive) setPhase('ready')
      })
    return () => {
      alive = false
    }
  }, [])

  const complete = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`${getApiBase()}/api/onboarding/complete`, { method: 'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setPhase('ready')
    } catch {
      setError('未能保存设置 / Could not save. Please retry.')
    } finally {
      setBusy(false)
    }
  }

  const importDb = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch(`${getApiBase()}/api/onboarding/import`, { method: 'POST', body: form })
      if (!r.ok) {
        const detail = await r.json().catch(() => null)
        throw new Error(detail?.detail || `HTTP ${r.status}`)
      }
      setError('导入完成，正在重启… / Imported. Restarting…')
      if ('__TAURI_INTERNALS__' in window) {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('restart_app')
      } else {
        window.location.reload()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败 / Import failed')
      setBusy(false)
    }
  }

  if (phase === 'loading') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--cal-surface)',
          color: 'var(--cal-muted)',
          fontFamily: FONT,
          fontSize: 13,
        }}
      >
        正在准备 / Preparing…
      </div>
    )
  }

  if (phase === 'ready') return <>{children}</>

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--cal-surface)',
        color: 'var(--cal-ink)',
        fontFamily: FONT,
        padding: 24,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: 580,
          maxWidth: '94vw',
          background: 'var(--cal-panel)',
          border: '1px solid var(--cal-border)',
          borderRadius: 18,
          padding: '40px 44px 34px',
          boxShadow: '0 30px 70px -48px rgba(40, 32, 24, 0.55)',
        }}
      >
        <div style={{ width: 42, height: 3, background: 'var(--cal-accent)', borderRadius: 2 }} />
        <div
          style={{
            marginTop: 18,
            fontSize: 10.5,
            letterSpacing: '0.26em',
            textTransform: 'uppercase',
            color: 'var(--cal-muted)',
          }}
        >
          TT Calendar{status?.version ? ` · v${status.version}` : ''}
        </div>
        <h1 style={{ margin: '12px 0 10px', fontSize: 25, lineHeight: 1.35, fontWeight: 600 }}>
          把日子安顿好
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.85, color: 'var(--cal-muted)' }}>
          所有数据都保存在这台电脑上，不登录、不上传。
          <br />
          Everything stays on this computer. No account, no cloud.
        </p>

        <div style={{ marginTop: 26 }}>
          <Row label="本地优先 / Local-first" value="断网也能用；关闭程序后数据仍在。" />
          <Row label="每日备份 / Backup" value="每次启动自动备份，最近 14 天保留在 backups 文件夹。" />
          <Row label="数据位置 / Data" value={status?.data_dir || '—'} mono />
        </div>

        <button
          type="button"
          onClick={complete}
          disabled={busy}
          style={{
            marginTop: 30,
            width: '100%',
            padding: '12px 18px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--cal-accent)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '0.02em',
            cursor: busy ? 'progress' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          开始使用 / Get started
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          style={{
            marginTop: 10,
            width: '100%',
            padding: '11px 18px',
            borderRadius: 10,
            border: '1px solid var(--cal-border)',
            background: 'transparent',
            color: 'var(--cal-ink)',
            fontSize: 13,
            cursor: busy ? 'progress' : 'pointer',
          }}
        >
          导入旧数据 / Import existing data
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".db,.sqlite,.sqlite3"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importDb(file)
          }}
        />
        <div style={{ marginTop: 12, fontSize: 11.5, lineHeight: 1.7, color: 'var(--cal-muted)' }}>
          选择旧版 <code>data/calendar.db</code>；导入前会自动备份当前数据。
        </div>
        {error && (
          <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6, color: 'var(--cal-danger-ink, #c2543d)' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
