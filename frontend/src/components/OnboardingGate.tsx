import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getApiBase } from '../api/client'
import { useT } from '../i18n'

// 首启动欢迎页。以前文案是中英并列（语言刚选完又出现英文，等于白选），
// 现在跟随用户刚选的语言；语言选择页本身负责「选之前」的双语兜底。

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
  const t = useT()
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
      setError(t('onboarding.saveFailed'))
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
      setError(t('onboarding.imported'))
      if ('__TAURI_INTERNALS__' in window) {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('restart_app')
      } else {
        window.location.reload()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('onboarding.importFailed'))
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
        {t('onboarding.preparing')}
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
          {t('onboarding.tagline')}
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.85, color: 'var(--cal-muted)' }}>
          {t('onboarding.subtitle')}
        </p>

        <div style={{ marginTop: 26 }}>
          <Row label={t('onboarding.localLabel')} value={t('onboarding.localValue')} />
          <Row label={t('onboarding.backupLabel')} value={t('onboarding.backupValue')} />
          <Row label={t('onboarding.dataLabel')} value={status?.data_dir || '—'} mono />
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
          {t('onboarding.start')}
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
          {t('onboarding.importOld')}
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
          {t('onboarding.importHint')}
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
