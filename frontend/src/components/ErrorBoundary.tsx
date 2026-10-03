import { Component, type ErrorInfo, type ReactNode } from 'react'
import { activeLang, makeI18n } from '../i18n'

interface State {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      // 类组件无 hook：走 makeI18n 非 React 路径（按组装时语言取，手册 §3.2）
      const { t } = makeI18n(activeLang())
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-lg font-semibold text-gray-700">{t('detail.errorBoundary.title')}</p>
          <p className="text-sm text-gray-500 max-w-md">{this.state.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="mt-2 px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            {t('detail.errorBoundary.retry')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
