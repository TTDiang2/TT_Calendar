<div align="center">

# 🗓️ TT Calendar

**一款本地优先的桌面日历应用** —— 日程管理 · 待办 · 倒计时 · 投资日历数据层 · 统计洞察

所有数据存储在本机，无需注册、无需联网、无任何遥测。

![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?logo=fastapi&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-Launcher-dea584?logo=rust&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)

</div>

---

## ✨ 功能特性

- **多视图日历**：月 / 周 / 日 / 年四种视图自由切换
- **日程管理**：AM / PM / EV 三段式时间表，支持事件、时间表条目与拖拽移动
- **待办事项**：独立待办视图，按截止日期染色提醒
- **重要日期 & 纪念日**：手动标记 + 自动生成倒计时（99 / 100 / 365 / 520 / 1000 天……）
- **充实度染色**：五档绿色直观呈现每天的日程密度
- **数据层（Layers）**：内置中国节假日与调休、集思录投资日历（新股、可转债、分红、REITs、股指期权等 15 类），按需拉取
- **统计视图**：日程分布与充实度洞察
- **全文搜索**：快速跳转到任意日程或事件
- **本地优先**：SQLite 存储，数据 100% 留在本机

## 📸 截图

> 截图待补充 —— 请将真实截图保存为 `docs/images/` 下对应文件后替换占位图。

| | |
|---|---|
| ![主界面](docs/images/screenshot-main.png) | ![月视图](docs/images/screenshot-month-view.png) |
| ![周视图](docs/images/screenshot-week-view.png) | ![待办](docs/images/screenshot-todo.png) |
| ![倒计时](docs/images/screenshot-countdown.png) | ![统计](docs/images/screenshot-stats.png) |

## 🧱 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 · TypeScript · Vite · Tailwind CSS 4 · TanStack Query · lucide-react |
| 桌面壳 | Tauri 2（WebView） |
| 后端 | FastAPI · uvicorn · SQLite（标准库 `sqlite3`） |
| 启动器 | Rust（Windows Job Object 进程生命周期管理） |
| 打包 | Tauri bundle（MSI / NSIS）· PyInstaller（后端 sidecar） |

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────┐
│  TT-Calendar-Launcher.exe (Rust)                    │
│  · 拉起后端进程   · /health 轮询就绪               │
│  · Job Object 统一生命周期（退出即清理）            │
└──────────────┬──────────────────────────────────────┘
               │ spawn + 端口 8765
┌──────────────▼──────────────────────────────────────┐
│  tt-calendar-backend (FastAPI, 127.0.0.1:8765)      │
│  · REST API (/api/*)    · SQLite 持久化             │
│  · 生产模式静态托管前端 dist（单端口）              │
└──────────────┬──────────────────────────────────────┘
               │ HTTP
┌──────────────▼──────────────────────────────────────┐
│  TT Calendar.exe (Tauri WebView + React)            │
│  · 月/周/日/年视图 · 待办 · 倒计时 · 统计           │
└─────────────────────────────────────────────────────┘
```

- **启动器**（Rust）：负责进程编排 —— 启动前清理端口残留、拉起后端、通过 `/health` 轮询确认就绪后再启动界面，所有子进程挂在同一个 Job Object 上，退出时统一回收。
- **后端**（FastAPI）：业务核心，提供日程、待办、图层、倒计时、统计等 REST API；开发时由 uvicorn 单独运行（端口 8000），生产时作为 PyInstaller sidecar 由启动器拉起。
- **前端**（React + Tauri）：纯本地 UI，通过 `useApi` hook 与后端通信；`data/` 下的 SQLite 数据库是唯一数据源。

## 🚀 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+ & npm
- Rust（可选，仅构建启动器时需要）

### 1. 启动后端

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

### 2. 启动前端（开发模式）

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`，或运行 `npm run tauri dev` 启动桌面窗口。

### 3. 构建启动器（可选）

```bash
cd launcher
cargo build --release
```

## 🗂️ 目录结构

```
├── tt_calendar/        # 核心 Python 包：数据模型、图层、数据源、工具
│   ├── layers/         #   数据层（内置节假日、集思录等）
│   ├── sources/        #   数据源（集思录投资日历 API）
│   └── utils/          #   日期、文本、渐变工具
├── backend/            # FastAPI 后端：REST API + 静态托管
├── frontend/           # React + Tauri 桌面端
│   └── src-tauri/      #   Tauri 壳配置与 Rust 入口
├── launcher/           # Rust 启动器：进程编排与生命周期
├── scripts/            # 辅助脚本（数据导出等）
├── tests/              # 自动化测试
└── docs/               # 文档与截图
```

## 🔒 数据与隐私

- 所有数据（日程、待办、配置）存储在应用目录下的 `data/calendar.db`（SQLite）
- 无账号体系、无云同步、无遥测、无任何网络上报
- 集思录数据仅在用户打开相应图层时按需拉取公开的投资日历接口
- 数据目录被 `.gitignore` 排除，个人数据不会进入版本库

## 📄 许可证

MIT License（LICENSE 文件待补充）
