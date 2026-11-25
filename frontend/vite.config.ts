import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: {
    // dist/ 不只是 vite 的产物目录：tauri.conf.json 的 resources 会从这里取
    // dist/tt-calendar-backend/（PyInstaller 打的 sidecar）。让 vite 清空 outDir
    // 会连后端起删掉，而且一次删几万个文件还会被宿主的删除保护拦下（trash 失败，
    // 构建直接中断）。产物的清理交给发布脚本，这里只覆盖、不删除。
    emptyOutDir: false,
  },
})
