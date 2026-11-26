import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    {
      // emptyOutDir 关掉了（原因见下），但 chunk 文件名带 hash，改代码就会换名字，
      // 旧文件永远不会被覆盖，只会一直躺着。实测 2.5.7 的安装包里就混进了一份
      // 前一天的 802KB 产物。这里只清 assets 子目录：它纯粹是前端产物，删掉没有
      // 副作用，也碰不到 dist/ 里可能存在的 sidecar。
      name: 'clean-assets',
      buildStart() {
        rmSync(fileURLToPath(new URL('./dist/assets', import.meta.url)), {
          recursive: true,
          force: true,
        })
      },
    },
    react(),
    tailwindcss(),
  ],
  server: { port: 5173 },
  build: {
    // dist/ 不只是 vite 的产物目录：tauri.conf.json 的 resources 会从这里取
    // dist/tt-calendar-backend/（PyInstaller 打的 sidecar）。让 vite 清空 outDir
    // 会连后端起删掉，而且一次删几万个文件还会被宿主的删除保护拦下（trash 失败，
    // 构建直接中断）。产物的清理交给发布脚本，这里只覆盖、不删除。
    emptyOutDir: false,
  },
})
