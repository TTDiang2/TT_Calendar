# LifeOS 架构研究 — TT_Calendar 移动端决策参考

> 日期：2026-08-17
> 背景：用户在 E:\LifeOS\lifeos 发现一个全栈 TypeScript monorepo 个人生产力系统，研究其架构后决定 TT_Calendar 移动端走向。
> 前置阅读：docs/RESEARCH_MOBILE.md（旧的 D→E→B 路线，已冻结）、docs/PLAN_PWA.md（PWA 先导计划，已冻结）

---

## 1. LifeOS 架构概览

### 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 19 + Vite | SPA，No SSR |
| 后端 | Fastify + better-sqlite3 | **内嵌 SQLite，进程内**，无独立服务器 |
| 类型 | Zod | 前后端共享 schema，API 文档自动生成 |
| ORM | Drizzle ORM | 迁移版本化管理 |
| _monorepo_ | pnpm workspace | packages/ 共享层，apps/ 应用层 |

### 目录结构

```
lifeos/
├── packages/
│   ├── contracts/     # Zod schemas per entity (task/goal/repeat/review/rules/...)
│   │   └── src/*.ts   — 每个实体一个文件，全部可独立单测
│   ├── domain/        # 纯业务逻辑（评分/依赖/重复规则/关键路径）
│   │   └── *.test.ts   — 只依赖 contracts，零 IO，任意环境跑
│   ├── db/            # Drizzle ORM + better-sqlite3 + 迁移 CLI
│   │   ├── src/store/  # 按实体分 store（tasks.ts / goals.ts / reviews.ts / ...）
│   │   └── src/cli/     # migrate.ts / seed.ts
│   └── ai/             # （AI 相关，与 TT_Calendar 无关）
├── apps/
│   ├── api/           # Fastify 薄壳（路由 → service → store）
│   │   └── src/routes/ # cards / tasks / goals / reviews / calendar / ...
│   └── web/            # React + Vite
└── scripts/
    ├── inspect/        # data:inspect（数据状态诊断）
    └── reset/          # data:reset --confirm（安全重置）
```

### 核心设计原则

**1. 分层 monorepo，依赖单向**

```
contracts (zod schemas)
    ↓
domain (纯逻辑，零 IO)
    ↓
db (better-sqlite3，依赖 contracts 的 schema)
    ↓
api (薄壳，只组合 service+store，事务编排)
    ↓
web (React，只调用 api)
```

domain 不依赖任何 IO 原语（无 fetch，无 DB，无 file system），可以：
- 在 node / browser / deno / bun 所有环境直接跑
- 单测不需要 mock
- 将来迁移到任何新平台，domain 逻辑零改动

**2. 内嵌 SQLite（better-sqlite3）= 本地优先的终极形态**

- API 服务就是进程内的一个「可选薄壳」——它不是必须的
- 移动端可以完全不要 HTTP 层，直接 `import { store } from '@lifeos/db'` 并调用
- Fastify 的路由层只是把同样的 store 暴露为 HTTP API 给 web 页面用
- 部署就是复制 SQLite 文件（`~/Library/Application Support/LifeOS/lifeos.db`），无需 migrate up

**3. Zod 单一来源，消灭类型漂移**

contracts 的 zod schema 同时定义了：
- API 请求/响应的验证
- 数据库写入前的校验
- 前端 component props 的类型（直接从 schema infer）
- OpenAPI 文档（@fastify/swagger 自动生成）

```typescript
// contracts/src/task.ts
export const Task = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  status: z.enum(['notStarted', 'inProgress', 'completed']),
  dueDate: z.string().optional(),
  // ...
})
export type Task = z.infer<typeof Task>

// apps/api/src/routes/tasks.ts
// Fastify schema 直接用 zod — 验证 + 文档一次搞定
schema: {
  response: { 200: Task.array() }
}

// apps/web/src/components/TaskList.tsx
// 前端类型从 schema infer，零手工维护
const tasks: Task[] = await api.getTasks()
```

**4. pnpm verify = 提交前的强制门禁**

```json
{
  "scripts": {
    "verify": "pnpm lint && pnpm typecheck && pnpm test && pnpm build"
  }
}
```
任何 pr / merge 必须过这个 gate，保证 lint + ts + test + build 全部通过。

**5. 数据运维脚本**

```bash
pnpm data:inspect                        # 全量状态诊断
pnpm data:inspect:task -- --id <id>    # 单条任务时间线
pnpm data:reset:all -- --confirm         # 安全重置（--confirm 才执行）
```

---

## 2. LifeOS 的关键工程实践（TT_Calendar 可直接搬）

| 实践 | TT_Calendar 当前状态 | 搬入方式 |
|---|---|---|
| **contracts/domain/db 分层 monorepo** | 目前 backend/ 和 frontend/src/ 平铺，共享只在 API 层面 | 新建 `packages/contracts/`（zod schemas）、`packages/domain/`（纯逻辑）、`packages/db/`（drizzle+sqlite） |
| **内嵌 SQLite（better-sqlite3）** | Python FastAPI + uvicorn 独立进程，PyInstaller 打包 | 未来 TS 重写后端时可用同样模式；当前不适用 Python 进程内嵌 |
| **zod 契约单一来源** | Python pydantic v2 后端，TS types 手工双写 | 新 packages/contracts 从 SQLite schema 生成 zod schema，前后端共享 |
| **drizzle 迁移版本化** | 手工 SQL 脚本或 PyDantic model → DB | 新 packages/db 用 drizzle-kit generate，版本化、可回滚 |
| **pnpm verify 一键门禁** | 目前只有 `npm run build`，无 lint/typecheck/test 门禁 | 迁移到 pnpm 后加 verify script |
| **debug/health 端点** | 目前无 | 加 `GET /debug/health` 返回版本+数据统计+最后同步时间 |
| **数据 inspect/reset 运维脚本** | 无（只有手动 SQL 查询） | `scripts/data:inspect.ts` 读 SQLite 打印统计；`scripts/data:reset.ts --confirm` 安全重置 |
| **Golden vectors 对拍测试** | TT_Calendar 无（但 D0 的 merge golden vectors 思路已存在于 SYNC_PLAN） | 已有 `tests/golden/merge_vectors.json`，TS 实现复现时直接对拍 |
| **纯 domain 层单测（零 mock）** | 目前 backend 单元测试有 DB fixture | 新 domain 包的单测不需要任何 IO |

---

## 3. TT_Calendar 移动端新决策（2026-08-17）

### 旧路线（已冻结）

RESEARCH_MOBILE.md 原推荐：D(PWA 先导) → E(Capacitor 主页) → B(Tauri mobile Rust)，桌面 Python 不动。

PLAN_PWA.md 原计划：PWA 先导路线，分 D0-D4。

### 新决策

**移动端路线 = 一次性全栈 TypeScript 重写（LifeOS 模式）+ Tauri 2 iOS/Android**

| 决策项 | 选择 |
|---|---|
| 移动端技术路线 | **一次性全栈 TS 重写 monorepo**（路线 C 全新设计，替代旧的 D→E→B 渐进路线） |
| 移动端壳 | **Tauri 2 iOS/Android**（前端 React 代码直接复用，移动端 webview 加载） |
| 所有 LifeOS 工程实践 | **全部要**，但只写进文档，现在不实施 |

### 为什么否决旧路线

- D→E→B 渐进路线优点是风险低（每期可停），缺点是双系统并行维护周期太长（TS core 做完之后桌面 Python 端还剩 5.7k 行需要持续维护）
- 一次性重写虽然 big-bang，但：
  - 新 codebase 单一，维护成本低
  - LifeOS 提供了经过验证的架构模板
  - TT_Calendar 的业务逻辑（CRUD + 日期计算 + 聚合）移植难度中等，非 AI/复杂并发系统
  - 用户明确表示倾向一次性重写

### 为什么选 Tauri 2 mobile 而非 Expo RN

- 前端 React 代码（TT_Calendar 的待办视图/日历视图/设置等）几乎可以原样复用
- 只需要换掉 Tauri desktop 的 sidecar Python 后端 → Tauri mobile 的 Rust 命令层
- Tauri CLI 已经支持 `tauri ios init/build` 和 `tauri android init/build`
- 长期看 Tauri 2 是真正的跨平台（桌面+移动），而非 RN 还需要维护两套 WebView 配置

---

## 4. 新路线实施方向（待细化的 MOBILE_ROUTE_V2.md）

### 架构方向

```
TT_Calendar-Monorepo（新建）
├── packages/
│   ├── contracts/    # Zod schemas（从 SQLite schema 生成）
│   ├── domain/       # 纯逻辑：评分/重复规则/依赖/视图聚合
│   ├── db/           # Drizzle ORM + better-sqlite3（移动端）或 tauri-plugin-sql（移动端）
│   └── ui/           # 共享 React 组件（桌面+移动同构）
├── apps/
│   ├── desktop/       # Tauri desktop（现有 React + Rust 命令层，替换 Python sidecar）
│   ├── mobile/        # Tauri 2 iOS/Android（复用 apps/desktop 的前端）
│   └── web/           # （可选：web 模式，与 mobile 共用 ui 包）
└── scripts/           # 数据 inspect/reset/迁移工具
```

### 关键技术决策（待定）

1. **SQLite 持久化**：Tauri mobile 不支持 sidecar，但 tauri-plugin-sql 提供 rusqlite 绑定；或者 better-sqlite3 同构包（需要 WASM？）
2. **农历/节假日**：TT_Calendar 依赖 chinese_calendar（Python）和 borax（农历）；TS 侧需要 tyme4ts / lunar-typescript 等替代品
3. **jisilu 订阅抓取**：桌面专属功能；移动端实现或标记为桌面专属
4. **密钥存储**：桌面 Windows DPAPI → 移动端 iOS Keychain / Android Keystore（tauri-plugin-secure-storage）
5. **现有 Python 后端**：是否保留作为「远程同步 server」？还是纯本地 SQLite？

### 与旧路线的衔接

- RESEARCH_MOBILE.md 和 PLAN_PWA.md **保留不删**（历史参考，冻结状态）
- 新路线完整方案见 `docs/MOBILE_ROUTE_V2.md`（待编写）

---

## 5. 下一步行动

1. **创建** `docs/MOBILE_ROUTE_V2.md`（新移动端路线完整文档）
2. **清理** `test_drive_app.py` 和 `test_perf.py`（引用已删除的 `tt_calendar.app`，属于冻结 D 系列遗留文件）
3. **Git commit**：LifeOS 研究文档（待执行）
4. **冻结后重新评估**：chinese_calendar / borax 的 TS 等价库调研
