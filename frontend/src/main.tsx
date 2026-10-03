import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider, QueryErrorResetBoundary } from '@tanstack/react-query'
import { ErrorBoundary } from './components/ErrorBoundary'
import { I18nProvider, useHasChosenLang } from './i18n'
import { LanguagePickerScreen } from './components/LanguagePickerScreen'
import App from './App'
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

// P2 AppGate（手册 §9）：未完成首次语言选择 → 语言选择页；确认后进主界面。
// chooseLang 触发 store 订阅，useHasChosenLang 响应式切换，无需刷新。
function AppGate() {
  const hasChosen = useHasChosenLang()
  if (!hasChosen) return <LanguagePickerScreen />
  return <App />
}

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
