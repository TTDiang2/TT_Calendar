/**
 * 视觉探针：对 ① 升级前后拍同一批截图 + 量同一批可访问性指标。
 *
 * 判分不靠观感：主指标是「模态是否锁焦点 / Esc 是否关 / aria-modal 是否存在」，
 * 这些是手搓 Modal 明确缺失、shadcn Dialog 明确提供的可测量能力。截图只作辅证。
 *
 * 用法：
 *   node scripts/visual-probe.mjs --out shots/before --base http://localhost:5173
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const args = {}
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]
}
const OUT = args.out ?? 'shots/probe'
const BASE = args.base ?? 'http://localhost:5173'
const W = Number(args.width ?? 1440)
const H = Number(args.height ?? 900)

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  locale: 'zh-CN',
})
// 跳过首启语言选择页，否则截到的是引导页而不是主界面
await ctx.addInitScript(() => {
  localStorage.setItem('tt.lang', 'zh-CN')
})

const page = await ctx.newPage()

const report = { base: BASE, viewport: [W, H], shots: [], a11y: {}, errors: [] }
let settingsRestored = null
page.on('pageerror', (e) => report.errors.push(`pageerror: ${String(e.message).slice(0, 200)}`))

// 优先语义化模态根；找不到才退回手搓遮罩。
// 注意不能把两者放进同一个 querySelector 选择器列表：Radix 的 Overlay 也在文档中
// 且更靠前，会被先命中，导致量到的是遮罩而不是对话框内容。
const MODAL_SEMANTIC = '[role="dialog"], [aria-modal="true"]'
const MODAL_FALLBACK = '.fixed.inset-0'

async function resolveModalSel() {
  const hasSemantic = await page.evaluate((s) => !!document.querySelector(s), MODAL_SEMANTIC)
  return hasSemantic ? MODAL_SEMANTIC : MODAL_FALLBACK
}

async function resetScroll() {
  // 弹窗开关会让侧栏等容器的滚动位置漂移，造成整屏「重影」式的假差异。
  // 每张图前把所有滚动容器归零，保证 before/after 比的是样式而不是滚动位置。
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollTop > 0) el.scrollTop = 0
      if (el.scrollLeft > 0) el.scrollLeft = 0
    }
  })
  await page.waitForTimeout(200)
}

async function shot(name) {
  await resetScroll()
  await page.waitForTimeout(400)
  const path = join(OUT, `${name}.png`)
  await page.screenshot({ path })
  report.shots.push(path)
}

async function modalOpen() {
  const sel = await resolveModalSel()
  return page.evaluate((s) => !!document.querySelector(s), sel)
}

async function probeModal(label) {
  const MODAL_SEL = await resolveModalSel()

  // 打开时记录背景滚动是否被锁、当前焦点归属，供关闭后比对
  const scrollLockedOpen = await page.evaluate(() => {
    const v = getComputedStyle(document.body).overflow
    return v === 'hidden' || document.body.getAttribute('data-scroll-locked') !== null
  })
  const triggerBefore = await page.evaluate(() => {
    const el = document.activeElement
    return el ? { tag: el.tagName, text: (el.textContent || '').trim().slice(0, 20) } : null
  })

  const res = await page.evaluate((sel) => {
    const dlg = document.querySelector(sel)
    if (!dlg) return { found: false }
    const focusables = dlg.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )
    return {
      found: true,
      ariaModal: dlg.getAttribute('aria-modal'),
      role: dlg.getAttribute('role'),
      labelled: !!(dlg.getAttribute('aria-label') || dlg.getAttribute('aria-labelledby')),
      focusableCount: focusables.length,
      focusInside: dlg.contains(document.activeElement),
    }
  }, MODAL_SEL)

  if (!res.found) {
    report.a11y[label] = { found: false }
    return false
  }

  let focusTrapped = false
  if (res.focusableCount > 0) {
    for (let i = 0; i < res.focusableCount + 3; i++) await page.keyboard.press('Tab')
    focusTrapped = await page.evaluate(
      (sel) => {
        const dlg = document.querySelector(sel)
        return dlg ? dlg.contains(document.activeElement) : false
      },
      MODAL_SEL,
    )
  }

  const wasOpen = await modalOpen()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const escCloses = wasOpen && !(await modalOpen())

  // 关闭后：焦点是否归还触发元素、背景滚动是否解锁
  const focusRestored = await page.evaluate((t) => {
    const el = document.activeElement
    if (!el || el === document.body) return false
    return !!t && el.tagName === t.tag && (el.textContent || '').trim().slice(0, 20) === t.text
  }, triggerBefore)
  const scrollUnlockedAfterClose = await page.evaluate(() => {
    const v = getComputedStyle(document.body).overflow
    return v !== 'hidden'
  })

  report.a11y[label] = {
    ...res,
    focusTrapped,
    escCloses,
    scrollLockedOpen,
    focusRestored,
    scrollUnlockedAfterClose,
  }
  return true
}

async function closeAny() {
  if (await modalOpen()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
  }
  if (await modalOpen()) {
    await page.mouse.click(5, 5)
    await page.waitForTimeout(250)
  }
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForTimeout(1500)

  const booted = await page.evaluate(() => document.body.innerText.length > 400)
  if (!booted) report.errors.push('仍在语言选择页，主界面未加载')

  await shot('01-month-view')

  const cell = page.locator('.grid.grid-cols-7 > div.relative').first()
  if (await cell.count()) {
    await cell.dblclick()
    await page.waitForTimeout(700)
    if (await modalOpen()) await shot('02-event-dialog'); await probeModal('event-dialog')
    await closeAny()
  } else {
    report.errors.push('未找到日期单元格，02 跳过')
  }

  const candidates = [
    page.locator('[title*="设置"]').first(),
    page.locator('[aria-label*="设置"]').first(),
    page.locator('button:has(svg.lucide-settings)').first(),
    page.locator('button').filter({ hasText: /设置|Settings/i }).first(),
  ]
  let opened = false
  for (const c of candidates) {
    if (await c.count()) {
      // 打开前显式聚焦并打标记：焦点归还必须对比「打开前的触发元素」，
      // 而不是模态内部的元素（后者会让测试恒为 false，测了个寂寞）
      await c.focus().catch(() => {})
      await page.evaluate(() => {
        document.activeElement?.setAttribute('data-probe-trigger', 'settings')
      })
      await c.click()
      await page.waitForTimeout(700)
      if (await modalOpen()) {
        opened = true
        break
      }
    }
  }
  if (opened) {
    if (await modalOpen()) await shot('03-settings-dialog')
    await probeModal('settings-dialog')
    // 基线版本的 Esc 关不掉对话框，这里必须强制收尾，否则 04 之后拍到的
    // 是「模态还开着」的界面，会让 before/after 的像素对比变成状态对比
    await closeAny()
    settingsRestored = await page.evaluate(
      () => document.activeElement?.getAttribute('data-probe-trigger') === 'settings',
    )
  } else {
    report.errors.push('设置入口未命中，03 跳过')
  }

  await page.waitForTimeout(300)
  await shot('04-shell')

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(700)
  await shot('05-dark-attempt')
  await page.emulateMedia({ colorScheme: 'light' })

  await page.setViewportSize({ width: 1024, height: 768 })
  await page.waitForTimeout(600)
  await shot('06-narrow')
} catch (e) {
  report.errors.push(`FATAL: ${String(e.message).slice(0, 300)}`)
} finally {
  await browser.close()
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify({ ...report, settingsRestored }, null, 2), 'utf-8')

console.log(`\n截图 ${report.shots.length} 张 -> ${OUT}`)
console.log('模态可访问性：')
for (const [k, v] of Object.entries(report.a11y)) {
  if (!v.found) {
    console.log(`  ${k}: 未打开`)
    continue
  }
  console.log(
    `  ${k}: aria-modal=${v.ariaModal} role=${v.role} labelled=${v.labelled} ` +
      `focusInside=${v.focusInside} focusTrapped=${v.focusTrapped} escCloses=${v.escCloses}`,
  )
  console.log(
    `      背景锁滚(${v.scrollLockedOpen}) 关后解锁(${v.scrollUnlockedAfterClose})`,
  )
}
console.log(`焦点归还到触发按钮: ${settingsRestored}`)
if (report.errors.length) {
  console.log('异常：')
  report.errors.slice(0, 8).forEach((e) => console.log('  ' + e))
}
