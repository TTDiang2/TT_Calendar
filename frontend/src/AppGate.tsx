import { useHasChosenLang } from './i18n'
import { LanguagePickerScreen } from './components/LanguagePickerScreen'
import App from './App'

// P2 AppGate（手册 §9）：未完成首次语言选择 → 语言选择页；确认后进主界面。
// chooseLang 触发 store 订阅，useHasChosenLang 响应式切换，无需刷新。
// （自 main.tsx 提出为独立组件，便于对门控行为做纯 UI 测试。）
export function AppGate() {
  const hasChosen = useHasChosenLang()
  if (!hasChosen) return <LanguagePickerScreen />
  return <App />
}
