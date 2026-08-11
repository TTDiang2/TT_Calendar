# 桌面版（TT Calendar.exe）问题排查复盘

> **给 AI 模型的指引**：用户遇到"TT Calendar.exe 桌面窗口 **一直加载中** / **看不到改动** / **HTML5 拖拽不工作**，但浏览器 localhost:5173 完全正常"时，**先读本文档再动手**。本文档是 2026-08-07 踩坑得出的完整复盘：
> - 第 1-7 节：一直加载中 / 看不到改动（CORS + sidecar + 缓存三层链路）
> - 第 8 节：桌面版 HTML5 拖拽失效（dragDropEnabled + dropEffect）

---

## 1. 现象特征（先对照确认是不是同一个问题）

- 浏览器打开 `http://localhost:5173` → 一切正常，改动可见
- 双击 `TT-Calendar-Launcher.exe` 启动桌面版 → **永远"加载中"**：
  - 日历面板一直转圈
  - todo 列表空白
- 后端日志（`backend.stdout.log`）显示请求 **200 OK**，但前端就是拿不到数据

**如果你看到以上特征，直接跳到第 3 节**。不要浪费时间查"代码改没改对""缓存清没清"。

---

## 2. 根本原因（一句话版）

**CORS origin 不匹配**。

- 桌面版前端（Tauri 内嵌）在 Windows 上请求后端时，浏览器 origin 是：
  ```
  http://tauri.localhost
  ```
- 而后端 `main.py` 的 CORS 白名单如果只写了 `tauri://localhost`（或漏了 `http://` 前缀），就会被**自己的后端拦截**：
  ```
  Access to fetch at 'http://127.0.0.1:8765/api/todo' from origin 'http://tauri.localhost'
  has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
  ```
- 后端**确实收到了请求并返回 200**（所以日志是 200 OK），但浏览器层把响应拦下，前端永远拿不到 → 永远"加载中"。这就是"日志 200 但界面空白"的完美解释。

### 为什么浏览器 5173 一直正常？
浏览器 dev 模式前端 origin 是 `http://localhost:5173`，CORS 白名单里有它，所以不受影响。**用浏览器排查永远发现不了这个问题**，这就是之前反复修不好的原因。

### 两个"陷阱叠加"让问题更难发现
1. **Tauri 桌面版的后端是独立打包的 sidecar 二进制**（`tt-calendar-backend-x86_64-pc-windows-msvc.exe`），不是直接跑 `main.py`。改了 `main.py` 的 CORS **必须重新打包 sidecar** 才生效，只重新 `tauri build` 没用——sidecar 是旧版本的话，exe 里跑的仍是旧 CORS。
2. **CORS origin 的正确写法**：Tauri v2 Windows 是 `http://tauri.localhost`（`http://` + `tauri.localhost`），不是 `tauri://localhost`（自定义协议形式）。两个都写最稳。

---

## 3. 标准排查流程（30 秒定位）

### 3.1 打开桌面版开发者工具（F12）

**前提**：`frontend/src-tauri/Cargo.toml` 里 `tauri` 依赖必须带 `devtools` feature：
```toml
tauri = { version = "2.11.3", features = ["custom-protocol", "devtools"] }
```
已加上。重新 build 后桌面窗口支持：
- 右键 → **Inspect**（推荐）
- 或 **Ctrl+Shift+I**

（注：曾用 F12 菜单加速键实现，但会在窗口顶部产生一个菜单栏，用户不想要，已移除。devtools 能力保留。）

### 3.2 看 Console 报错，三秒判断

打开开发者工具 → Console 标签。看到：
```
from origin 'http://tauri.localhost' has been blocked by CORS policy
```
→ **就是本文档的问题，直接执行第 4 节修复**。

看到其他 JS 报错（红色堆栈、某个变量 undefined）→ 是前端代码问题，按报错定位即可，与本文档无关。

### 3.3 辅助验证：请求是否无限重试

- CORS 被拦时：React Query 会疯狂重试，`backend.stdout.log` 里同一接口几十条重复请求
- 修复后：每个接口只请求一次（4 条左右：countdown / todo/stats / todo / view/month），且不再增长

---

## 4. 修复步骤（一次性根治）

### 4.1 修后端 CORS 白名单（backend/main.py）

`app.add_middleware(CORSMiddleware, ...)` 的 `allow_origins` 必须包含：
```python
allow_origins=[
    "http://localhost:5173",        # 浏览器 dev
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://tauri.localhost",        # Tauri v2 Windows 生产 origin（关键！）
    "https://tauri.localhost",       # Tauri macOS/Linux 生产 origin
    "tauri://localhost",             # 旧版 Tauri origin（兜底）
],
allow_methods=["*"],
allow_headers=["*"],
```

### 4.2 重新打包 sidecar（关键步骤，别漏！）

桌面版后端是独立二进制，改了 `main.py` 必须重建它：

```powershell
# 1. 杀进程避免锁文件
Get-Process -Name "tt-calendar-backend","TT Calendar","TT-Calendar-Launcher" -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. 在项目根目录打包（用根目录的 spec 文件）
python -m PyInstaller --clean --noconfirm tt-calendar-backend.spec

# 3. 复制到 Tauri 期望的位置和文件名（注意 -x86_64-pc-windows-msvc 后缀）
Copy-Item "dist\tt-calendar-backend.exe" `
  "frontend\src-tauri\binaries\tt-calendar-backend-x86_64-pc-windows-msvc.exe" -Force
```

> `tauri.conf.json` 里 `externalBin: ["binaries/tt-calendar-backend"]`，Tauri 会自动找带平台后缀的文件。

### 4.3 验证新 sidecar 的 CORS（可选但推荐）

```powershell
$p = Start-Process "dist\tt-calendar-backend.exe" -PassThru -WindowStyle Hidden
Start-Sleep 10
Invoke-WebRequest -Uri "http://127.0.0.1:8765/api/todo" -Method Options `
  -Headers @{Origin="http://tauri.localhost"; "Access-Control-Request-Method"="GET"} -UseBasicParsing
# 期望：200 + Access-Control-Allow-Origin: http://tauri.localhost
```

### 4.4 重新 build Tauri exe + 部署

```powershell
cd frontend
npx tauri build --no-bundle

# 复制 + 清缓存 + 启动
Get-Process -Name "TT Calendar","TT-Calendar-Launcher","tt-calendar-backend" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 3
Copy-Item "frontend\src-tauri\target\release\app.exe" "TT Calendar.exe" -Force
Remove-Item "$env:LOCALAPPDATA\com.tt.calendar" -Recurse -Force
Start-Process "TT-Calendar-Launcher.exe"
```

### 4.5 验证成功

```powershell
# 清空日志重启后，20-30 秒内请求数应稳定在 ~4 条（不增长）
(Get-Content backend.stdout.log | Measure-Object -Line).Lines
```
- 每个接口请求一次且 200 → 成功
- 请求疯狂增长 → CORS 仍被拦，回到 4.1

---

## 5. 为什么以前"杀进程 / 清缓存 / 重 build"时好时坏

这套应用的"更新链路"有三层，**每一层独立**，漏掉任何一层都可能显示旧版本：

| 层 | 是什么 | 更新方式 | 漏掉的后果 |
|---|---|---|---|
| 前端 dist | `frontend/dist/` | `tauri build` 前的 `npm run build`（vite） | 界面没有新功能 |
| **后端 sidecar** | `tt-calendar-backend-*.exe` | **PyInstaller 重新打包 + 复制到 binaries/** | **CORS 旧配置 → 加载中（本次的元凶）** |
| WebView2 缓存 | `%LOCALAPPDATA%\com.tt.calendar` | 删目录（必须在杀进程后） | 界面显示旧前端代码 |

**历史教训**：
- 之前多次"修好又坏"，是因为一直在调第 1、3 层（build/缓存），而真正的病在**第 2 层（sidecar 里的 CORS）**。sidecar 是 8/5 打包的，早于 main.py 加 CORS 白名单，一直没人重建它。
- 用浏览器验证（5173 正常）会**强烈误导**排查方向，因为浏览器走 dev 后端，CORS 白名单里一直有它。

---

## 6. 一键更新脚本（build_and_update_exe.bat）

项目根目录已有，双击即可。它现在包含：双轮杀进程 + 等锁释放 + 复制重试 + 字节校验。

**注意**：该脚本目前**不重建 sidecar**（PyInstaller 太慢）。如果本次改动涉及 `backend/main.py`（尤其是 CORS/路由），必须手动执行 4.2 步重建 sidecar，否则脚本 build 出来的 exe 里跑的还是旧后端。

---

## 7. 附带发现（记录备用）

- `App.tsx` L68 有个 prefetchQuery 硬编码 `sort: 'due_importance'`（启动预取用），TodoView 列表实际用 `due_planned_importance`。**日志里看到 `due_importance` 是正常的**，不代表旧代码。
- exe 内嵌资源被压缩，grep 二进制找不到 JS 变量名；但**字符串字面量**（如 `due_planned_importance`、`ring-2`）能搜到。验证 exe 是否最新：搜 exe 里的 dist 文件名 hash（如 `index-Bomb6ZbR`）与 `frontend/dist/assets/` 下的实际文件比对。
- Tauri build 产物 hash 每次可能不同（vite 内容 hash），**不要**凭 hash 判断新旧，要凭"exe 引用的 hash == dist 实际文件名"判断。

---

## 8. 桌面版拖拽失效（HTML5 drag & drop 在 WebView2 里不工作）复盘（2026-08-07）

> **给 AI 模型的指引**：用户报告"**todo 拖拽排序在 exe 里不能拖 / 拖出红色禁止符号，但浏览器 5173 里完全正常**"时，读本节。这是 WebView2 + Tauri 的已知平台差异，与代码逻辑无关。

### 8.1 现象特征

- 浏览器 5173：拖拽自然流畅（onDragStart/onDragOver/onDrop 全部正常）
- exe 桌面版：**拖拽直接显示红色禁止符号**（⛔ no-drop cursor），或完全无反应
- 用设置页版本号（见 8.4）已确认 exe 加载的确实是最新代码——排除"exe 没更新"因素后，就是本节问题

### 8.2 根本原因（两层）

**层 1：Tauri 窗口默认注册了"文件拖放处理器"，与 HTML5 拖拽互斥（主因）**

Tauri 窗口配置默认 `dragDropEnabled: true`，Tauri 自己的拖放处理会**抢占**拖拽事件。Tauri 官方 issue #13171 明确回复：

> "If you need the native html/js drag and drop api to work you **must disable tauri's own drag drop events** by adding `dragDropEnabled: false` to the window config. They are **mutually exclusive** because of webview limitations that we currently cannot work around."

即：**`dragDropEnabled: true` 时 HTML5 的 dragover/drop 事件根本收不到**。浏览器没有这层 Tauri 拦截，所以正常。

**层 2：dragover 里没设 `dropEffect`，默认是 `none`（规范行为）**

按 HTML 规范，dragover 事件处理器里**必须**显式设置 `e.dataTransfer.dropEffect = 'move'`（并 `preventDefault()`），否则 dropEffect 保持 `none` = 红色禁止符号。Chrome 宽松地自动推断为 move，WebView2 严格按规范显示 none。

### 8.3 修复（两层都要改，缺一不可）

**修复 1：`frontend/src-tauri/tauri.conf.json` 的 window 配置加 `dragDropEnabled: false`**

```json
"app": {
  "windows": [
    {
      "title": "TT Calendar",
      "width": 1280,
      "height": 820,
      "dragDropEnabled": false   // 关键！释放 HTML5 拖拽给前端
    }
  ]
}
```

**修复 2：所有 onDragOver 处理器显式设 dropEffect**

```tsx
onDragOver={(e) => {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'   // 必须显式设置，否则禁止符号
  setDragOverId(t.id)
}}
```

**配套最佳实践（本项目已应用）**：
- `onDragStart` 里必须 `e.dataTransfer.setData('text/plain', ...)` + `e.dataTransfer.effectAllowed = 'move'`（HTML5 规范要求，WebView2 严格）
- 可拖拽容器加 `select-none`（防止拖拽变文本选中）
- 拖拽成功（onDrop）后自动切到"手动排序"（`sort=manual`），让 sort_order 持久化

### 8.4 排查工具：设置页版本号

`SettingsDialog.tsx` 底部有一行版本号小字（如 `TT Calendar v0.4.2-dragfix`）。**这是判断 exe 是否加载最新代码的最快手段**——先看版本号确认代码是最新的，再判断是交互差异还是代码问题，避免绕圈。

### 8.5 一句话总结

**exe 里 HTML5 拖拽不工作 = Tauri 的 `dragDropEnabled` 抢占（改 tauri.conf.json）+ dragover 缺 `dropEffect`（改前端）**，两层都要修，只修一层不够。
