/**
 * 新建待办「离开编辑态自动保存」端到端验证（真实浏览器）
 *
 * 用 CDP 驱动本机 Edge headless 打开 http://127.0.0.1:8765，模拟用户真实点击，
 * 再用后端 API 计数校验。jsdom 只能证明组件逻辑成立，这个脚本证明真实交互路径成立。
 *
 * 用法：node tests/e2e_todo_autosave.cjs
 * 前置：后端已在 8765 运行，且 frontend/dist 已 npm run build
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const APP = 'http://127.0.0.1:8765'
const API = `${APP}/api`
const PORT = 9333
const MARK = 'E2E_AUTOSAVE_'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- CDP ----------
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.events = []
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      } else if (msg.method) {
        this.events.push(msg)
      }
    }
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error('页面 JS 异常: ' + JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  async clickAt(x, y) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
      })
    }
    await sleep(220)
  }
  /** 按可见文本点元素，优先 button，其次最深匹配节点 */
  async clickText(text, { exact = true, nth = 0 } = {}) {
    const pt = await this.eval(`(() => {
      const all = [...document.querySelectorAll('button, a, [role=button], div, span, p')]
      const hit = (e) => {
        const t = (e.textContent || '').trim()
        return ${exact} ? t === ${JSON.stringify(text)} : t.includes(${JSON.stringify(text)})
      }
      const cands = all.filter(hit).filter((e) => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
      if (!cands.length) return null
      // 取最靠内的元素（避免点到祖先容器），再按 nth 选
      const inner = cands.filter((e) => !cands.some((o) => o !== e && e.contains(o)))
      const pick = (inner.length ? inner : cands)[${nth}]
      if (!pick) return null
      const r = pick.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    if (!pt) throw new Error(`找不到可点击元素：${text}`)
    await this.clickAt(pt.x, pt.y)
  }
  async typeInto(selector, text) {
    const r = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    })()`)
    if (!r) throw new Error(`找不到输入框：${selector}`)
    await this.clickAt(r.x, r.y)
    await this.send('Input.insertText', { text })
    await sleep(220)
  }
  async ctrlEnter(selector) {
    await this.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`)
    await sleep(120)
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2,
    })
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2,
    })
    await sleep(400)
  }
}

// ---------- 后端 API ----------
async function api(pathname, init) {
  const r = await fetch(API + pathname, init)
  if (!r.ok) throw new Error(`${r.status} ${pathname}`)
  return r.status === 204 ? null : r.json()
}
const countMarked = async () => {
  const all = await api('/todo?status=notStarted&limit=500')
  return all.filter((t) => t.title.startsWith(MARK))
}

// ---------- 主流程 ----------
async function waitForBrowser() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) return r.json()
    } catch {}
    await sleep(500)
  }
  throw new Error('Edge 调试端口未就绪')
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-e2e-'))
  const edge = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--remote-allow-origins=*',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore' })

  const results = []
  let cdp
  try {
    await waitForBrowser()
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = targets.find((t) => t.type === 'page')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    cdp = new Cdp(ws)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')

    await cdp.send('Page.navigate', { url: APP })
    // 等待 React 挂载出「待办」入口
    for (let i = 0; i < 60; i++) {
      const ok = await cdp.eval(
        `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='待办')`,
      )
      if (ok) break
      await sleep(500)
    }
    await cdp.clickText('待办')
    await sleep(1200)

    // 场景 0：确认面板已就绪
    const ready = await cdp.eval(
      `!!document.querySelector('button') && [...document.querySelectorAll('button')].some(b=>b.textContent.includes('新建待办'))`,
    )
    if (!ready) throw new Error('待办视图未加载')

    // 1a. 点另一个待办
    {
      const title = `${MARK}点另一个待办`
      const before = (await countMarked()).length
      await cdp.clickText('新建待办')
      await sleep(400)
      await cdp.typeInto('textarea[placeholder="标题"]', title)
      const pt = await cdp.eval(`(() => {
        const row = document.querySelector('.tt-row-enter')
        if (!row) return null
        const p = row.querySelector('p')
        const r = (p || row).getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })()`)
      if (!pt) throw new Error('任务列表里找不到可点击的待办行')
      await cdp.clickAt(pt.x, pt.y)
      await sleep(1000)
      const after = (await countMarked()).length
      results.push(['1a. 输入标题 → 点另一个待办', after - before, 1, title])
    }

    // 1b. 切到日历 tab（面板整体卸载）
    {
      const title = `${MARK}切到日历`
      const before = (await countMarked()).length
      await cdp.clickText('待办') // 回到待办视图
      await sleep(800)
      await cdp.clickText('新建待办')
      await sleep(400)
      await cdp.typeInto('textarea[placeholder="标题"]', title)
      await cdp.clickText('日历')
      await sleep(1200)
      const after = (await countMarked()).length
      results.push(['1b. 输入标题 → 切到日历 tab（卸载）', after - before, 1, title])
    }

    // 1c. 点 X 关闭
    {
      const title = `${MARK}点X关闭`
      const before = (await countMarked()).length
      await cdp.clickText('待办')
      await sleep(800)
      await cdp.clickText('新建待办')
      await sleep(400)
      await cdp.typeInto('textarea[placeholder="标题"]', title)
      await cdp.eval(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => x.title === '关闭')
        b && b.click()
      })()`)
      await sleep(1000)
      const after = (await countMarked()).length
      results.push(['1c. 输入标题 → 点 X 关闭', after - before, 1, title])
    }

    // 2. 点保存按钮
    {
      const title = `${MARK}点保存`
      const before = (await countMarked()).length
      await cdp.clickText('新建待办')
      await sleep(400)
      await cdp.typeInto('textarea[placeholder="标题"]', title)
      await cdp.clickText('保存')
      await sleep(1200)
      const after = (await countMarked()).length
      results.push(['2. 输入标题 → 点「保存」', after - before, 1, title])
    }

    // 3. Ctrl+Enter
    {
      const title = `${MARK}CtrlEnter`
      const before = (await countMarked()).length
      await cdp.clickText('新建待办')
      await sleep(400)
      await cdp.typeInto('textarea[placeholder="标题"]', title)
      await cdp.ctrlEnter('textarea[placeholder="标题"]')
      await sleep(1200)
      const after = (await countMarked()).length
      results.push(['3. 输入标题 → Ctrl+Enter', after - before, 1, title])
    }

    // 4. 空标题切走 —— 不应创建
    {
      const before = (await countMarked()).length
      await cdp.clickText('新建待办')
      await sleep(400)
      await cdp.clickText('日历')
      await sleep(1000)
      const after = (await countMarked()).length
      results.push(['4. 空标题 → 切走（不应创建）', after - before, 0, null])
    }
  } finally {
    if (cdp) { try { cdp.ws.close() } catch {} }
    edge.kill()
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  }

  // ---------- 报告 + 清理 ----------
  console.log('\n========== 端到端结果（真实 Edge + 真实后端）==========')
  let failed = 0
  for (const [name, actual, expect] of results) {
    const ok = actual === expect
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      实际新增 ${actual} 条 / 期望 ${expect} 条`)
  }
  console.log('======================================================')

  const created = await countMarked()
  for (const t of created) {
    await fetch(`${API}/todo/${t.id}`, { method: 'DELETE' })
  }
  console.log(`已清理测试数据 ${created.length} 条`)
  if (failed) {
    console.log(`\n${failed} 个场景未通过`)
    process.exit(1)
  }
  console.log('\n全部场景通过')
}

main().catch((e) => { console.error('E2E 失败:', e); process.exit(1) })
