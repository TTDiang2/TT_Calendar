/**
 * 首启动语言选择页（P2，A3；结构沿 Neo packages/ui/src/components/LanguagePickerScreen.tsx）。
 *
 * 需求：所有用户首次打开 App 必须经过语言选择；系统语言只做预选高亮，
 * 必须显式点确认才进入主界面。选择持久化到 localStorage（tt.lang）。
 * 语言名用 endonym（日本語/한국어…），示例句是各语言本体数据——都永不走翻译。
 * 只列「已有字典」的语言（SELECTABLE_LANGS）：无字典的语言选了会静默回落中文，
 * 属于虚假选项（20261008 用户实测：设置里能点繁中/法语等但界面不变）。
 * 说明文字跟随所选语言即时切换（makeI18n(picked)，20261004 用户反馈：
 * 选 English 后提示仍是中文不直观——Neo 原版的 activeLang 方案已弃用）。
 * 视觉：老端蓝色系（Neo 为粉色系），其余结构逐字对齐。
 */
import { useState } from 'react'
import { Check, Languages } from 'lucide-react'
import { clsx } from 'clsx'
import { chooseLang, systemLang, SELECTABLE_LANGS, LANG_META, makeI18n, type Lang } from '../i18n'

export function LanguagePickerScreen() {
  const [picked, setPicked] = useState<Lang>(systemLang())
  // 说明文字跟随所选语言即时切换（用户反馈 20261004：选 English 后提示仍是中文不直观）
  const uiLang = picked
  const tp = makeI18n(uiLang).t

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-b from-blue-50 to-indigo-100 overflow-y-auto">
      <div className="w-full max-w-sm px-6 py-10">
        <div className="flex flex-col items-center text-center mb-6">
          <span className="w-14 h-14 rounded-2xl bg-white/70 shadow-sm flex items-center justify-center mb-3">
            <Languages size={26} className="text-blue-500" />
          </span>
          <h1 className="text-xl font-semibold text-gray-800">
            {tp('language.title')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {tp('language.subtitle')}
          </p>
        </div>

        <div
          className="flex flex-col gap-2 mb-6"
          role="radiogroup"
          aria-label={LANG_META[uiLang] ? LANG_META[uiLang].endonym : 'language'}
        >
          {SELECTABLE_LANGS.map((lang) => {
            const meta = LANG_META[lang]
            const selected = picked === lang
            return (
              <button
                key={lang}
                role="radio"
                aria-checked={selected}
                onClick={() => setPicked(lang)}
                className={clsx(
                  'flex items-center gap-3 w-full px-4 py-3 rounded-2xl border text-left transition',
                  selected
                    ? 'border-blue-400 bg-white/90 shadow-sm'
                    : 'border-white/60 bg-white/50 hover:bg-white/70',
                )}
              >
                <span className="flex-1 min-w-0">
                  <span className={clsx('block text-sm font-medium', selected ? 'text-gray-900' : 'text-gray-700')}>
                    {meta.endonym}
                  </span>
                  <span className="block text-xs text-gray-400 truncate">{meta.sample}</span>
                </span>
                {selected && <Check size={16} className="text-blue-500 flex-shrink-0" />}
              </button>
            )
          })}
        </div>

        <button
          onClick={() => chooseLang(picked)}
          className="w-full py-3 rounded-2xl bg-blue-500 text-white text-sm font-semibold shadow-sm hover:bg-blue-600 active:bg-blue-600 transition"
        >
          {tp('language.start')}
        </button>
      </div>
    </div>
  )
}
