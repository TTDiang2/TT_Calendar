/**
 * 前后截图像素级对比。
 *
 * 目的：证明 ① 升级「没有改变观感」。若差异像素占比很低（预期 <5%），
 * 说明改动集中在对话框内部结构（关闭图标、阴影），而非整体重绘 —— 这正是 ① 的定位。
 *
 * 用法：node scripts/diff-shots.mjs --before ../.visual-probe/before --after ../.visual-probe/after
 */
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const argv = process.argv.slice(2)
const args = {}
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]
}
const BEFORE = args.before ?? '../.visual-probe/before'
const AFTER = args.after ?? '../.visual-probe/after'

if (!existsSync(BEFORE) || !existsSync(AFTER)) {
  console.error('缺少 before/after 目录')
  process.exit(1)
}

const names = readdirSync(BEFORE)
  .filter((f) => f.endsWith('.png'))
  .filter((f) => existsSync(join(AFTER, f)))
  .sort()

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()

console.log('文件                      差异像素   平均色差   尺寸')
console.log('─'.repeat(58))

for (const name of names) {
  const res = await page.evaluate(
    async ([b64a, b64b]) => {
      const load = (b64) =>
        new Promise((resolve) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.src = 'data:image/png;base64,' + b64
        })
      const [ia, ib] = await Promise.all([load(b64a), load(b64b)])
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { mismatch: true, sizeA: [ia.width, ia.height], sizeB: [ib.width, ib.height] }
      }
      const w = ia.width
      const h = ia.height
      const c1 = document.createElement('canvas')
      c1.width = w
      c1.height = h
      const x1 = c1.getContext('2d', { willReadFrequently: true })
      x1.drawImage(ia, 0, 0)
      const d1 = x1.getImageData(0, 0, w, h).data

      const c2 = document.createElement('canvas')
      c2.width = w
      c2.height = h
      const x2 = c2.getContext('2d', { willReadFrequently: true })
      x2.drawImage(ib, 0, 0)
      const d2 = x2.getImageData(0, 0, w, h).data

      let diff = 0
      let sum = 0
      let n = 0
      let minX = w
      let minY = h
      let maxX = -1
      let maxY = -1
      const pairs = new Map()
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          const delta =
            Math.abs(d1[i] - d2[i]) +
            Math.abs(d1[i + 1] - d2[i + 1]) +
            Math.abs(d1[i + 2] - d2[i + 2])
          if (delta > 12) {
            diff++
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
            const a = `#${[d1[i], d1[i + 1], d1[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`
            const b = `#${[d2[i], d2[i + 1], d2[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`
            const key = `${a}->${b}`
            pairs.set(key, (pairs.get(key) ?? 0) + 1)
          }
          sum += delta
          n++
        }
      }
      const top = [...pairs.entries()].sort((p, q) => q[1] - p[1]).slice(0, 6)
      return {
        diffPct: (100 * diff) / n,
        avgDelta: sum / n,
        size: [w, h],
        bbox: maxX < 0 ? null : [minX, minY, maxX, maxY],
        top,
      }
    },
    [
      (await import('node:fs')).readFileSync(join(BEFORE, name)).toString('base64'),
      (await import('node:fs')).readFileSync(join(AFTER, name)).toString('base64'),
    ],
  )

  if (res.mismatch) {
    console.log(`${name.padEnd(24)} 尺寸不同 ${res.sizeA} vs ${res.sizeB}`)
  } else {
    console.log(
      `${name.padEnd(24)} ${res.diffPct.toFixed(2).padStart(7)}%  ${res.avgDelta
        .toFixed(2)
        .padStart(8)}   ${res.size.join('x')}`,
    )
    if (res.bbox) {
      const [x1, y1, x2, y2] = res.bbox
      console.log(`  差异区域: x ${x1}-${x2}, y ${y1}-${y2}`)
      for (const [pair, count] of res.top) {
        console.log(`    ${pair}  x${count}`)
      }
    }
  }
}

await browser.close()
