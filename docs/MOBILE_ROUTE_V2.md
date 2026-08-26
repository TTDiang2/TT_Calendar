# TT Calendar 移动端路线 v2

> 状态：**决策完成（2026-08-17）**，未实施
> 替代：本文档替代 RESEARCH_MOBILE.md（旧 D→E→B 路线）和 PLAN_PWA.md（PWA 先导计划），后者保留作为历史参考（已冻结）

---

## 1. 决策

| 决策项 | 选择 |
|---|---|
| 移动端技术路线 | **一次性全栈 TypeScript 重写**（参照 LifeOS 架构） |
| 移动端壳 | **Tauri 2 iOS / Android** |
| 工程实践 | 全部 LifeOS 实践（分层 monorepo / zod contracts / drizzle / pnpm verify / data scripts / debug health），仅记录不立即实施 |

---

## 2. 目标

1. 一个 monorepo，包含桌面端（Windows Tauri）、移动端（iOS / Android Tauri）和可选 Web 模式
2. 业务逻辑（待办 / 日历 / 图层 / 聚合 / 同步）全部用 TypeScript 重写
3. 桌面端保持 Tauri 框架（替换 Python sidecar 为 Rust 命令层），前端 React 代码直接复用
4. 移动端复用同一套 React 前端（响应式布局适配手机屏幕）
5. 所有工程验收标准（lint / typecheck / test / build）通过 pnpm verify 一键门禁

---

## 3. 架构方向

```
TT_Calendar-Monorepo（新建）
├── packages/
│   ├── contracts/    # Zod schemas（从 SQLite schema 生成，TS/共享）
│   ├── domain/       # 纯业务逻辑：todo 评分 / 重复规则 / 依赖分析
│   │                 # 视图聚合（月/周/年/图层色/忙度）
│   │                 # 零 IO 依赖，可在任何 JS 环境单测
│   ├── db/           # Drizzle ORM schema + 迁移
│   │                 # 桌面：better-sqlite3（进程内）
│   │                 # 移动：tauri-plugin-sql（rusqlite）或 better-sqlite3 WASM
│   └── ui/           # 共享 React 组件（日历网格 / 待办卡片 / 设置面板…）
│                     # 条件渲染：桌面三栏 vs 手机底部 Tab + 抽屉
├── apps/
│   ├── desktop/      # Tauri 2 Windows（Rust 命令层调用 db/domain）
│   ├── mobile/       # Tauri 2 iOS/Android（复用 apps/desktop 前端）
│   └── web/          # 可选：Vite SPA，同一套 ui 包（届时 vite build --mode web）
└── scripts/
    ├── data:inspect.ts
    ├── data:reset.ts
    └── gen_types.ts   # 从 SQLite PRAGMA table_info 生成 zod schemas
```

---

## 4. 关键技术问题（待研究）

### 4.1 SQLite 持久化（Tauri mobile）

Tauri 2 mobile **不支持 sidecar 子进程**（不能像桌面那样塞 Python 二进制）。SQLite 必须内嵌：

- **方案 A**：`tauri-plugin-sql`（基于 rusqlite）——Tauri 官方插件，移动端稳定支持
- **方案 B**：`better-sqlite3` WASM 版（需要验证 iOS Safari / Android WebView 兼容性）
- **方案 C**：直接用 Drizzle ORM + `@libsql/client` 连 Turso（远程 SQLite，但违背「数据本地」约束）

**推荐**：方案 A，先行研究 `tauri-plugin-sql` 在 iOS / Android 上的实际表现。

### 4.2 农历 / 节假日库

TT_Calendar 现有依赖：
- `chinese_calendar`：节假日 + 调休（纯 Python）
- `borax`：农历日期（Python 专用）

TS 等价库调研（待执行）：
| 功能 | Python 库 | TS 候选库 | 状态 |
|---|---|---|---|
| 中国节假日 + 调休 | chinese_calendar | chinese-calendar / workdays.js | 需验证数据更新频率 |
| 农历 | borax | lunar-typescript / tyme4ts / cctwh | 需验证精确度 |

**务实路径**：将节假日数据导出为静态 JSON（`holidays_2024_2030.json`），内置于前端构建产物，每年重跑导出脚本更新。TT_Calendar 不需要实时节假日查询能力。

农历功能：评估 `lunar-typescript` 精度，若满足需求则替换；若不满足，农历相关功能可降级为「显示农历日期（参考）」而非精确计算。

### 4.3 密钥存储

桌面端：现有 `secrets.py` 用 DPAPI。
移动端：
- iOS：Keychain（`tauri-plugin-secure-storage`）
- Android：Android Keystore

Rust 命令层实现同名 trait 接口，前端调用时感知不到差异。

### 4.4 jisilu 订阅抓取

现有功能：FastAPI 后台定时从集思录抓取数据，存入 `subscriptions` 表。

移动端的处理策略（待决策）：
- **选项 A**：标记为「桌面专属功能」，移动端不支持，用户接受
- **选项 B**：将抓取逻辑改写为 TS，前端触发（移动端也能用，但隐私/安全风险）
- **选项 C**：保留桌面 Python 后端作为「可选数据同步 server」，移动端通过 Tauri 命令调用

### 4.5 现有 Python 后端

一次性 TS 重写的核心问题：**现有 Python 代码（~5.7k 行）是否全部丢弃，还是保留作为「远程同步 server」？**

- **丢弃路径**：纯本地 SQLite，无远程 server；同步通过 GitHub Gist / GitHub API 实现（已有 D 系列方案）
- **保留路径**：Python FastAPI 后端保留部署为可选 server，TT Calendar 移动端作为 client 连接它

保留 server 的优势：jisilu 抓取等桌面功能可以远程运行；用户可以在任何设备通过 HTTP 访问数据。
保留 server 的代价：需要维护 server 托管（即使自用也需要公网可达或内网穿透）。

---

## 5. 与 LifeOS 的差异

LifeOS 是「新建项目，零历史包袱」。TT_Calendar 有现有数据和用户习惯：

| 维度 | LifeOS | TT_Calendar |
|---|---|---|
| 现有数据 | 无 | SQLite ~1MB / 2750 条，用户已用 2+ 年 |
| 迁移路径 | 手动导入 | 需要一次性数据迁移脚本（Python → TS DB） |
| 用户习惯 | 无 | 矩阵视图 / 看板 / 量筒 / 日历倒数 / 图层 — 功能子集需在移动端呈现 |
| 同步需求 | 自建 GitHub sync | 已有 D 系列 sync 方案（冻结待重评估） |
| UI 资产 | 全新 | 桌面端三栏布局迁移到移动端底部 Tab + 抽屉 |

---

## 6. 与旧路线的关系

| 旧文档 | 状态 | 说明 |
|---|---|---|
| `docs/RESEARCH_MOBILE.md` | **冻结** | 原 D→E→B 路线研究，已归档 |
| `docs/PLAN_PWA.md` | **冻结** | 原 PWA 先导计划，已归档 |
| `docs/LIFEOS_STUDY.md` | **新建** | LifeOS 架构研究 + TT_Calendar 决策参考 |

---

## 7. 实施前的调研待办

以下问题需要先研究再出实施计划，不可在不了解的情况下直接开工：

- [ ] `tauri-plugin-sql` iOS / Android 实际表现（是否需要 rust-sidecar 还是直接 JS？）
- [ ] 节假日 JSON 静态资源的可用性（哪家库维护频率高？）
- [ ] 农历 TS 库精度对比（borax vs lunar-typescript vs tyme4ts）
- [ ] jisilu 抓取功能的用户优先级（是否值得保留？）
- [ ] 同步方案：继续 GitHub Gist 路线还是改用其他（WebDAV / Syncthing / 纯本地）？
- [ ] 现有 SQLite schema 的 Drizzle 等价迁移路径（是否需要重写 schema 还是直接映射？）

---

## 8. 立即可执行的下一步

**创建新仓库或重整现有仓库为 monorepo 结构（不含任何实现代码）**：

```
TT_Calendar-v2/
├── packages/
│   ├── contracts/   # 空包，只有 index.ts
│   ├── domain/     # 空包，只有 index.ts
│   └── db/          # 空包，只有 schema.ts（目前从现有 SQLite PRAGMA 生成）
├── apps/
│   ├── desktop/     # 空的 Tauri 项目
│   └── mobile/      # 空的 Tauri 2 iOS/Android 项目
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

这个架子建好即 stop——下一步是逐个调研 §7 的开放问题，全部有答案后再开始写代码。
