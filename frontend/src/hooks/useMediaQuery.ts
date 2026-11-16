import { useEffect, useState } from 'react'

function readMatch(query: string): boolean {
  // jsdom / 老 WebView 没有 matchMedia：退化成「不进入紧凑模式」，不要抛错
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(query).matches
}

/**
 * 订阅一条媒体查询。窗口宽度决定顶栏要不要把搜索框收成图标——
 * 用一个 hook 而不是 CSS 断点，是因为收起后还要换 aria-label / title 和交互，
 * 纯 CSS 只能藏一个显示另一个，读屏会读到隐藏的那份文案。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => readMatch(query))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
