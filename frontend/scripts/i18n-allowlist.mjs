// 生成/修剪 i18n 中文棘轮白名单 eslint-i18n-allowlist.json（老端版，沿 Neo 端 scripts/i18n-allowlist.mjs）。
//
// 原理：用 ESLint JS API 以「只有中文串规则」的配置扫描 i18n 棘轮作用域内的
// 全部文件（白名单不生效，保证能准确检测存量文件是否已抽完）：
//   - 仍有违规 → 保留/加入白名单
//   - 已无违规 → 移出白名单
// 白名单为空数组 = 抽词完成。规则作用域与 eslint.config.js 的棘轮块保持一致：
//   frontend/src/**/*.{ts,tsx}
//   （豁免 __tests__、*.test.*、src/i18n/**）
//
// 用法：node scripts/i18n-allowlist.mjs（须用 Node 22）
// 坑（Neo 端实录）：独立 ESLint 实例必须显式挂 TS parser（下方 languageOptions.parser），
// 否则所有 TS 文件「解析失败」被当成违规、白名单虚高；Windows 偶发文件锁读到陈旧结果，
// 隔 2 秒重跑一次再下结论。
import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ALLOWLIST_PATH = fileURLToPath(new URL('../eslint-i18n-allowlist.json', import.meta.url))

const SCOPE = ['src/**/*.{ts,tsx}']
const EXEMPT = ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'src/i18n/**']

const CN_STRING_RULES = [
  { selector: 'Literal[value=/[\\u4e00-\\u9fff]/]', message: 'CN' },
  { selector: 'JSXText[value=/[\\u4e00-\\u9fff]/]', message: 'CN' },
  { selector: 'TemplateElement[value.raw=/[\\u4e00-\\u9fff]/]', message: 'CN' },
]

const previous = existsSync(ALLOWLIST_PATH) ? JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) : []

const eslint = new ESLint({
  cwd: ROOT,
  overrideConfig: {
    files: SCOPE,
    ignores: EXEMPT,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: { 'no-restricted-syntax': ['error', ...CN_STRING_RULES] },
  },
  overrideConfigFile: true, // 只用 overrideConfig，不叠加仓库默认配置
})

const results = await eslint.lintFiles(SCOPE)
const violating = new Set()
for (const r of results) {
  if (r.messages.length > 0) violating.add(r.filePath.replaceAll('\\', '/'))
}

const rel = (p) => p.slice(ROOT.length).replaceAll('\\', '/')
const nextList = [...violating].map(rel).sort()

const prevSet = new Set(previous)
const removed = previous.filter((f) => !nextList.includes(f))
const added = nextList.filter((f) => !prevSet.has(f))
if (removed.length) console.log(`移出白名单（已抽完）：\n  ${removed.join('\n  ')}`)
if (added.length) console.log(`新增白名单（仍有中文串）：\n  ${added.join('\n  ')}`)
console.log(`白名单共 ${nextList.length} 个文件`)

writeFileSync(ALLOWLIST_PATH, JSON.stringify(nextList, null, 2) + '\n')
