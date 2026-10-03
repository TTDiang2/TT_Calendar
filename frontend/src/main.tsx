import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider, QueryErrorResetBoundary } from '@tanstack/react-query'
import { ErrorBoundary } from './components/ErrorBoundary'
import { I18nProvider } from './i18n'
import { AppGate } from './AppGate'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // 容忍 sidecar 冷启动（生产环境 backend exe 首次启动 ~8s）
      retry: (failureCount) => failureCount < 6,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <QueryErrorResetBoundary>
          <ErrorBoundary>
            <AppGate />
          </ErrorBoundary>
        </QueryErrorResetBoundary>
      </QueryClientProvider>
    </I18nProvider>
  </React.StrictMode>,
)
