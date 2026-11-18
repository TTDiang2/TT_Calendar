import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider, QueryErrorResetBoundary } from '@tanstack/react-query'
import { ErrorBoundary } from './components/ErrorBoundary'
import { I18nProvider } from './i18n'
import { CalendarThemeProvider } from './lib/calendar-theme'
import { AppGate } from './AppGate'
import { getApiBase, initApiBase, waitForBackend } from './api/client'
import './index.css'

// 启动页在 I18nProvider 挂载之前渲染，拿不到 t()。这是全应用唯一豁免 i18n 规则的
// 位置：文案保持中英并列，且只在后端未就绪/启动失败时出现。
/* eslint-disable no-restricted-syntax */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // 后端是 onedir，冷启动约 2-3s；这里仍保留退避，覆盖首次迁移/杀毒扫描等慢路径。
      retry: (failureCount) => failureCount < 6,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
})

const bootStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#faf9f7',
  color: '#3f3a34',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
}

function BootScreen({ error }: { error?: string }) {
  return (
    <div style={bootStyle}>
      <div style={{ width: 420, maxWidth: '90vw', textAlign: 'center' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase', opacity: 0.5 }}>
          TT Calendar
        </div>
        {error ? (
          <>
            <h1 style={{ fontSize: 19, fontWeight: 600, margin: '18px 0 10px' }}>
              后端启动失败 / Backend failed to start
            </h1>
            <p style={{ fontSize: 13, lineHeight: 1.8, opacity: 0.75, margin: 0 }}>{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                marginTop: 22,
                padding: '8px 18px',
                borderRadius: 999,
                border: '1px solid rgba(63,58,52,0.25)',
                background: 'transparent',
                color: 'inherit',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              重试 / Retry
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 19, fontWeight: 600, margin: '18px 0 10px' }}>正在启动…</h1>
            <p style={{ fontSize: 13, lineHeight: 1.8, opacity: 0.65, margin: 0 }}>
              正在连接本地服务 / Connecting to local service
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function App() {
  return (
    <React.StrictMode>
      <I18nProvider>
        <CalendarThemeProvider>
          <QueryClientProvider client={queryClient}>
            <QueryErrorResetBoundary>
              <ErrorBoundary>
                <AppGate />
              </ErrorBoundary>
            </QueryErrorResetBoundary>
          </QueryClientProvider>
        </CalendarThemeProvider>
      </I18nProvider>
    </React.StrictMode>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<BootScreen />)

async function bootstrap() {
  await initApiBase()
  if (!(await waitForBackend())) {
    root.render(
      <BootScreen
        error={`无法连接本地服务（${getApiBase()}）。请确认后端已启动，或查看日志：%LOCALAPPDATA%\\TT Calendar\\data\\backend.log`}
      />,
    )
    return
  }
  root.render(<App />)
}

void bootstrap()
