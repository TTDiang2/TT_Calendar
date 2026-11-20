import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useT, type TxKey } from '../i18n'

/**
 * 首次使用引导（20261120 用户反馈：装完完全不知道从哪下手，全靠自己摸）。
 *
 * 做法是「聚光灯 + 一张卡片」：目标元素挖个洞亮出来，其余压暗，卡片贴着它走。
 * 不要求用户真的去点目标（引导里的点击反而容易被误认为操作失败），
 * 只要求看懂「这块是干什么的」，所以遮罩吃掉点击、卡片上只有下一步。
 *
 * 高亮框用 framer-motion 的 left/top/width/height 动画在目标之间滑过去，
 * 而不是每个目标淡入淡出——这样用户能感知到「从左边跳到了上面」的空间关系。
 */

const SEEN_KEY = 'tt-tour-v1'
const TIP_W = 332
const TIP_H = 176
const PAD = 8

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true
  }
}

export function markTourSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* 写不了就别再弹了，交给调用方的内存状态 */
  }
}

type Step = {
  /** data-tour 的值；null 表示居中欢迎卡 */
  target: string | null
  titleKey: TxKey
  bodyKey: TxKey
}

const STEPS: Step[] = [
  { target: null, titleKey: 'onboarding.guideWelcomeTitle', bodyKey: 'onboarding.guideWelcomeBody' },
  { target: 'sidebar', titleKey: 'onboarding.guideSidebarTitle', bodyKey: 'onboarding.guideSidebarBody' },
  { target: 'views', titleKey: 'onboarding.guideViewsTitle', bodyKey: 'onboarding.guideViewsBody' },
  { target: 'today', titleKey: 'onboarding.guideCreateTitle', bodyKey: 'onboarding.guideCreateBody' },
  { target: 'search', titleKey: 'onboarding.guideSearchTitle', bodyKey: 'onboarding.guideSearchBody' },
]

export function GuideTour({ onDone }: { onDone: () => void }) {
  const t = useT()
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const step = STEPS[index]!

  const finish = useCallback(() => {
    markTourSeen()
    onDone()
  }, [onDone])

  const advance = useCallback(() => {
    setIndex((i) => {
      if (i >= STEPS.length - 1) {
        markTourSeen()
        onDone()
        return i
      }
      return i + 1
    })
  }, [onDone])

  // 目标位置：窗口缩放、侧栏折叠导致的重排都可能挪动它，所以每次都重新量。
  useLayoutEffect(() => {
    if (!step.target) {
      setBox(null)
      return
    }
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`)
      if (!el) {
        setBox(null)
        return
      }
      const r = el.getBoundingClientRect()
      setBox({ left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 })
    }
    measure()
    // 首帧数据可能还没到（视图切换/侧栏图层异步加载），补一次延迟测量
    const timer = window.setTimeout(measure, 120)
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', measure)
    }
  }, [step.target, index])

  useEffect(() => {
    nextRef.current?.focus()
  }, [index])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
      } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault()
        advance()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, finish])

  const pos = useMemo(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (!box) {
      return { left: Math.max(16, (vw - TIP_W) / 2), top: Math.max(16, (vh - TIP_H) / 2) }
    }
    // 竖向长条（侧栏）：卡片放它右边、垂直居中——上下都塞不下，放上会压住半条侧栏。
    if (box.height > vh * 0.5 && box.width < vw * 0.4) {
      return {
        left: Math.min(box.left + box.width + 14, Math.max(16, vw - TIP_W - 16)),
        top: Math.max(16, (vh - TIP_H) / 2),
      }
    }
    const below = vh - (box.top + box.height)
    const preferBelow = below > TIP_H + 32
    const top = preferBelow
      ? box.top + box.height + 14
      : Math.max(16, box.top - TIP_H - 14)
    const left = Math.min(Math.max(16, box.left + box.width / 2 - TIP_W / 2), Math.max(16, vw - TIP_W - 16))
    return { left, top }
  }, [box])

  const last = index === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label={t('onboarding.guideWelcomeTitle')}>
      {/* 遮罩 + 高亮洞：box-shadow 的 9999px 扩散把整屏压暗，只留目标本身亮着 */}
      {box ? (
        <motion.div
          className="absolute rounded-xl"
          initial={false}
          animate={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          transition={{ type: 'spring', stiffness: 420, damping: 38 }}
          style={{ boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55), 0 0 0 1.5px rgba(255,255,255,0.85)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-900/55" />
      )}

      <motion.div
        className="absolute rounded-2xl border border-[color:var(--cal-border)] bg-[var(--cal-panel)] p-4 shadow-2xl"
        initial={false}
        animate={{ left: pos.left, top: pos.top }}
        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        style={{ width: TIP_W }}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--cal-muted)]">
            {t('onboarding.guideStep', { n: index + 1, total: STEPS.length })}
          </span>
        </div>
        <h3 className="text-[15px] font-semibold text-[var(--cal-ink)]">{t(step.titleKey)}</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--cal-muted)]">{t(step.bodyKey)}</p>

        <div className="mt-3.5 flex items-center justify-between">
          <button
            onClick={finish}
            className="rounded-lg px-2 py-1 text-[12px] text-[var(--cal-muted)] transition hover:bg-[var(--cal-subtle)]"
          >
            {t('onboarding.guideSkip')}
          </button>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1" aria-hidden="true">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className="h-1 rounded-full transition-all"
                  style={{
                    width: i === index ? 14 : 5,
                    backgroundColor: i === index ? 'var(--cal-accent)' : 'var(--cal-border)',
                  }}
                />
              ))}
            </div>
            <button
              ref={nextRef}
              onClick={advance}
              className="rounded-lg bg-[var(--cal-accent)] px-3.5 py-1.5 text-[12.5px] font-medium text-white transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--cal-accent)]/40"
            >
              {last ? t('onboarding.guideDone') : t('onboarding.guideNext')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
