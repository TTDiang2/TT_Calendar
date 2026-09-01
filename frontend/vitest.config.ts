import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // 组件级测试需要 JSX 转换
  plugins: [react()],
  test: {
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
})
