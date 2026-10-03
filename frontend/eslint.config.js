import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import { readFileSync, existsSync } from 'node:fs'

// i18n 中文棘轮白名单（scripts/i18n-allowlist.mjs 生成/修剪）：
// 还没完成抽词的文件列在这里面（中文串规则对它们暂不生效）。
// 每抽完一个文件重跑脚本，文件会自动移出白名单；白名单归零 = 抽词完成。
// 规则细节见 scripts/i18n-allowlist.mjs 头注释。机制沿 Neo 端（docs/i18n-handoff-tt-calendar.md §4）。
const ALLOWLIST_PATH = './eslint-i18n-allowlist.json'
const i18nAllowlist = existsSync(ALLOWLIST_PATH)
  ? JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'))
  : []

const CN_STRING_RULES = [
  {
    selector: 'Literal[value=/[\\u4e00-\\u9fff]/]',
    message: 'UI 字符串字面量含中文：必须走 t()（src/i18n）。用户数据/持久化 key 除外——若属此类请勿写在本目录。',
  },
  {
    selector: 'JSXText[value=/[\\u4e00-\\u9fff]/]',
    message: 'JSX 文本含中文：必须改为 {t(...)}（src/i18n）。',
  },
  {
    selector: 'TemplateElement[value.raw=/[\\u4e00-\\u9fff]/]',
    message: '模板串含中文：必须走 t()/tPlural() 具名插值（src/i18n）。',
  },
]

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'dist/**',
      'src-tauri/**',
      '**/.vite/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Neo 端终审经验：tsc/冒烟测试是 hooks 顺序违规的盲区，规则能查每一次
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 存量代码有 20 处 unused-vars（A0 实测），按 Neo 同款降为 warn；新代码由 review 把关
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Node 脚本（scripts/*.mjs）跑在 Node 里，需要 Node 全局对象
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022,
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    // i18n 中文棘轮：作用域 = frontend/src（豁免 __tests__、*.test.*、src/i18n/**）。
    // 白名单里的存量文件暂不生效，抽词完成后由 allowlist 脚本移出。
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'src/i18n/**', ...i18nAllowlist],
    rules: {
      'no-restricted-syntax': ['error', ...CN_STRING_RULES],
    },
  },
)
