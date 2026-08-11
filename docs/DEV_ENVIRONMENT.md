# 开发环境与构建笔记

> **先读这个**：如果桌面版 `TT Calendar.exe` 出现"一直加载中 / 看不到改动 / HTML5 拖拽不工作（红色禁止符号）"，**先看 [EXE_LOADING_TROUBLESHOOT.md](EXE_LOADING_TROUBLESHOOT.md)**——那是桌面版问题排查的完整复盘（CORS origin 坑、sidecar 重建、dragDropEnabled + dropEffect 拖拽坑）。下面的内容是环境速查。

## ⚠️ 最常见问题：改了代码但 exe/桌面窗口看不到改动

**短答**：`TT Calendar.exe` 是**编译时内嵌的静态快照**（不是加载实时 URL）。改代码后 exe 不会自动更新。

### 日常查看改动：一键脚本（推荐）

项目根目录有 `build_and_update_exe.bat`，**双击它**就行。它会做：
1. 杀掉占用的进程（TT Calendar.exe / app.exe）
2. `tauri build --no-bundle`（增量编译约 1-2 分钟）
3. 复制新 `app.exe` 到 `TT Calendar.exe`
4. 清 WebView2 缓存（不清理会显示旧代码）

跑完再双击 `TT-Calendar-Launcher.exe` 就能看到最新改动。

### 等价的 PowerShell 命令（了解原理）

```powershell
# 1. 杀掉占用进程
Get-Process -Name "TT Calendar","app" -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. 编译 Tauri release exe（前置会跑 vite build 更新 dist）
cd frontend; npx tauri build --no-bundle

# 3. 复制 app.exe 到项目根目录
Copy-Item "frontend\src-tauri\target\release\app.exe" "TT Calendar.exe" -Force

# 4. 清除 WebView2 缓存（关键！否则显示旧代码）
Remove-Item "$env:LOCALAPPDATA\com.tt.calendar\EBWebView" -Recurse -Force
```

### 为什么每次都要重新 build + 清缓存？

- `TT Calendar.exe` 编译时把 `frontend/dist/` 整个内嵌进 exe（origin 为 `http://tauri.localhost`，Windows；不是 `tauri://localhost`）
- 改前端代码 → 必须重新 build 才能更新 exe 内嵌的资源
- WebView2 把渲染数据缓存在 `%LOCALAPPDATA%\com.tt.calendar`，不清除可能继续用旧缓存

### ⚠️ 清缓存的陷阱（重要）

**必须先杀光所有 `TT Calendar.exe` 进程，再清缓存目录**。否则：

1. 清缓存时 exe 还在跑
2. exe 的 WebView2 检测到缓存被清空
3. WebView2 立即**从当前 exe 内嵌的资源重建缓存**
4. 如果当前 exe 是旧的（比如之前测试时启动的 Pake exe），缓存就被填成旧资源
5. 之后即使替换了新 exe，WebView2 还是用缓存里的旧代码

**症状**：API 请求中看到 `sort=due_importance`（旧默认排序），但代码里已是 `due_planned_importance`。

**正确顺序**（已写入 `build_and_update_exe.bat`）：
1. `taskkill /F /IM "TT Calendar.exe"`
2. `rd /s /q "%LOCALAPPDATA%\com.tt.calendar"`（清整个目录，不只 EBWebView）
3. 启动新 exe（WebView2 从新 exe 内嵌资源加载，无缓存污染）

### 开发调试模式（可选）

如果你不想每次都 build 来查看改动，可以用 `npm run tauri dev`——Tauri 窗口加载 `http://localhost:5173`（vite dev server），改代码即时热更新。但需要保持 backend（start_backend.bat）和 tauri dev 两个终端在跑：

```powershell
# 终端 1：backend
start_backend.bat

# 终端 2：tauri dev
cd frontend; npm run tauri dev
```

---

## 桌面应用架构：TT Calendar.exe = Tauri release build

### 关键概念：Pake 与 Tauri 的关系

- **Pake**（[tw93/Pake](https://github.com/tw93/Pake)）：一个基于 Tauri 的 CLI 工具，把任意网页 URL 快速打包成桌面应用。底层就是 Tauri。
- **本项目**：没有用 Pake CLI，而是**手写了 Tauri 项目**（`frontend/src-tauri/`）。launcher 注释里写的 "pake" 是历史遗留名称，实际就是 Tauri 应用。
- `TT Calendar.exe` = `npm run tauri build` 的产物，是一个标准 Tauri 应用。

### TT Calendar.exe 加载什么？

**内嵌的 dist 静态资源**，不是远程 URL。验证方法：扫描 exe 二进制，含 `tauri.localhost`（Tauri 内嵌资源 origin），不含 `localhost:5173`。

Tauri 配置（`frontend/src-tauri/tauri.conf.json`）：
```json
{
  "build": {
    "frontendDist": "../dist",           // release build：把 dist/ 内嵌进 exe
    "devUrl": "http://localhost:5173",   // tauri dev：加载 vite dev server
    "beforeBuildCommand": "npm run build",
    "beforeDevCommand": "npm run dev"
  }
}
```

| | 浏览器 localhost:5173 | TT Calendar.exe 桌面窗口 |
|---|---|---|
| 数据来源 | vite dev server 实时文件 | **exe 编译时内嵌的 dist 快照** |
| 改前端代码后 | 立即生效（HMR） | **必须重新 tauri build** |

### 启动链路

`TT-Calendar-Launcher.exe`（Rust 启动器，`launcher/src/main.rs`）：
1. 清理 8765 端口残留
2. 启动 Python uvicorn backend（127.0.0.1:8765）
3. 轮询 /health 确认后端就绪
4. 启动同目录 `TT Calendar.exe`（Tauri 应用）
5. 两者通过 Job Object 绑定，launcher 关闭时一起死

Tauri 应用内部（`src-tauri/src/lib.rs`）也会启动 Python backend sidecar（`tt-calendar-backend.exe`）监听 8765。窗口关闭时 kill sidecar。

> **注意**：launcher 和 Tauri 都会启动 backend。如果通过 launcher 启动，backend 由 launcher 管理；如果直接双击 TT Calendar.exe，backend 由 Tauri sidecar 管理。

## 前端改动后如何让桌面窗口看到效果

### 方法一：重新 build（生产模式，推荐用于日常使用）

```powershell
cd frontend
npx tauri build --no-bundle
```

流程：
1. `beforeBuildCommand: npm run build` → vite build → 更新 `frontend/dist/`
2. `cargo build --release` → 编译 Rust → 生成 `frontend/src-tauri/target/release/app.exe`（内嵌最新 dist）
3. `--no-bundle` 跳过 installer 打包（msi/nsis），只要 exe

产物 `app.exe` 需要复制到项目根目录并重命名：
```powershell
Copy-Item "frontend\src-tauri\target\release\app.exe" "TT Calendar.exe" -Force
```

增量编译约 1-2 分钟（首次更久）。

**重要：重新 build 后还需清除 WebView2 缓存**，否则桌面窗口仍显示旧代码：
```powershell
# 关闭正在运行的 Tauri 进程
Get-Process -Name "TT Calendar" -ErrorAction SilentlyContinue | Stop-Process -Force
# 删除 WebView2 缓存
Remove-Item "$env:LOCALAPPDATA\com.tt.calendar\EBWebView" -Recurse -Force
```
然后重启 `TT-Calendar-Launcher.exe`。

### 方法二：tauri dev（开发模式，热更新）

```powershell
cd frontend
npm run tauri dev
```

这会：
1. `beforeDevCommand: npm run dev` → 启动 vite dev server（5173）
2. 编译 Rust debug → 启动 Tauri 窗口加载 `http://localhost:5173`
3. 改前端代码 → vite HMR → Tauri 窗口实时更新

适合开发调试，但不是 launcher 启动方式。

### 方法三：直接浏览器开 5173（最快验证）

```powershell
cd frontend
npm run dev
```
浏览器开 `http://localhost:5173/`。不经过 Tauri，纯前端 + 后端 API。

## Vite dev server 反复挂的根因

用 `cmd /c "npm run dev"` 启动 vite 不稳定：cmd 包装 npm，npm 启动 vite 后 cmd 卡在 stdin（"是否终止批处理操作？"），被 Ctrl+C 杀掉。

**正确启动方式**：直接 `node node_modules/vite/bin/vite.js`，重定向 stdin + CreateNoWindow。启动脚本保存在临时目录的 `start_vite.ps1`。

## 调试 checklist

**用户报告"看不到改动"**：

1. 区分看的是**浏览器 5173** 还是**桌面窗口**：
   - 浏览器 5173 没变 → vite dev server 问题（检查 5173 监听、重启 vite）
   - 桌面窗口没变 → **exe 是旧的，需要重新 tauri build**（见上）
2. 验证 exe 内嵌代码版本：扫描 exe 找 dist hash（如 `index-Px0O-vE5`）
3. 检查 vite 5173：`Get-NetTCPConnection -LocalPort 5173`
4. 检查 backend 8765：`Invoke-WebRequest http://localhost:8765/api/health`

## 路径速查

| 用途 | 路径 |
|------|------|
| 前端源码 | `frontend/src/` |
| Tauri 项目 | `frontend/src-tauri/` |
| Tauri 配置 | `frontend/src-tauri/tauri.conf.json` |
| vite dev server | `http://localhost:5173/` |
| 前端生产构建 | `frontend/dist/` |
| Tauri build 产物 | `frontend/src-tauri/target/release/app.exe` |
| 桌面窗口 exe | `TT Calendar.exe`（项目根目录） |
| 启动器 exe | `TT-Calendar-Launcher.exe`（项目根目录） |
| 后端源码 | `backend/`, `tt_calendar/` |
| 后端 API（launcher） | `http://localhost:8765/` |
| 后端 API（手动调试） | `http://localhost:8000/` |
| 启动日志 | `launcher.log`, `backend.stdout.log`, `backend.stderr.log` |

## 常用命令

```powershell
# 前端 dev（浏览器调试）
cd frontend; npm run dev

# Tauri dev（桌面窗口 + 热更新）
cd frontend; npm run tauri dev

# 重新 build 桌面 exe（生产模式）
cd frontend; npx tauri build --no-bundle
Copy-Item "frontend\src-tauri\target\release\app.exe" "TT Calendar.exe" -Force

# 重启 backend（手动调试）
Stop-Process -Name python -Force -ErrorAction SilentlyContinue
cd <项目根>; python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```
