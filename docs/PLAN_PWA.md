# 路线 D（PWA）实施计划

> 依据：RESEARCH_MOBILE.md（已定：短期 D、中期 E、长期 B；桌面 Python 端不动）。
> 本文档是实施蓝本：架构决策、最小测试单位、分期 D0-D4（每期有独立验收标准与测试单位）。
> 配套：SYNC_PLAN.md（同步架构）、SYNC_SETUP.md（用户指引）。

## 0. 总体判断（先回答三个关键问题）

**能不能只在电脑上开发测试 D 方案？** 能。PWA 就是网页：
- 开发循环：`npm run dev:pwa` → 电脑浏览器直接用（数据层全在浏览器里）
- 电脑 Chrome/Edge 可「安装应用」获得完整 PWA 体验（独立窗口/离线/图标）
- 手机专属行为（触屏手势、safe-area、iOS standalone 怪癖）先用 DevTools 设备模拟覆盖，真机验证放到最后（免费路径见 §6）

**D 的产出会不会在 E/B 阶段报废？** 不会，这是本计划最重要的设计原则：
- **TS 数据层（`frontend/src/core/`）是跨路线不变量**——D 里它跑在浏览器（IndexedDB 持久化），E 里原样跑在 Capacitor WebView（换 SQLite 插件持久化），B（Tauri）里同样跑在 WebView
- 因此连长期 B 的「Rust 移植」都从必需降级为可选优化——壳换掉、核心不换
- 桌面 Python 端零改动，两种形态通过 GitHub 仓库互通（同步契约）

**怎么保证开发测试不碰真实数据？** 同步引擎本来就按「仓库+分支」配置。开发/测试统一用真实数据仓的 **`test` 分支**（桌面正式环境用 main，天然隔离，不需要额外建仓）。

## 1. 目标与非目标

**目标**：
1. 一个可安装、可离线、可双向同步的 PWA（手机 + 电脑浏览器皆可用）
2. TS 数据层完整实现同步契约（与 Python 实现行为一致，golden vectors 对拍）
3. 移动端可用的自适应 UI（桌面窄窗口同时受益）

**非目标（本期不做）**：
- 原生能力（推送/分享/生物识别）→ E 阶段
- App Store / 应用市场上架 → E/B 阶段
- jisilu 数据源导入（桌面专属功能，PWA 可后续按需加）
- 桌面 Python 端任何改动（只读它的同步格式，不改它的代码）

## 2. 总体架构

```
┌────────────────────── PWA（浏览器内，无任何自建服务端） ──────────────────────┐
│  React 前端（现有组件 + 响应式改造）                                          │
│  ├─ 数据访问层切换：client.ts（API 模式，桌面） ──┬─ 同一组件树                │
│  │                                              └─ core 模式（PWA）        │
│  frontend/src/core/  ← TS 数据层（新写，跨 D/E/B 不变量）                      │
│  ├─ types.ts        从 SQLite schema 生成的类型（脚本生成，防漂移）             │
│  ├─ store.ts        内存镜像 + 持久化端口（D=IndexedDB / E=SQLite 插件）        │
│  ├─ merge.ts        三方合并（merge.py 移植，golden vectors 对拍）             │
│  ├─ provider.ts     GitHub Git Data API（providers.py 移植，含四大陷阱）        │
│  ├─ engine.ts       同步编排（锁/base 快照/报告）                              │
│  ├─ aggregate.ts    视图聚合（aggregator.py 移植：图层色/忙度/月周年视图）      │
│  ├─ holidays.json   节假日资产（chinese_calendar 导出）                        │
│  └─ secrets.ts      PAT 存储（D=localStorage 明示风险；E 阶段换 Keychain）      │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │ HTTPS fetch（GitHub API 官方 CORS 支持）
                    GitHub：代码仓 Pages 托管 PWA（免费）
                            数据仓 tt-calendar-data（快照，权威副本）
```

## 3. 关键设计决策

### D-1 双模式前端：构建期切换，不是运行时探测

`client.ts` 的 25 个函数签名就是数据层接口。新建 `frontend/src/data-mode.ts`：

```ts
// 组件只 import { api } from '../data-mode'
// api 模式（现状）：直连 Python 后端 —— 桌面构建使用
// core 模式（新增）：core 数据层 —— PWA 构建使用（VITE_DATA_MODE=core）
```

- vite 两个构建入口：桌面 tauri build 不变；PWA 用 `vite build --mode pwa`（`.env.pwa` 里 `VITE_DATA_MODE=core`）
- 组件零改动（它们已经只依赖 client.ts 的函数签名，core 模式实现同签名）
- 不做运行时探测（探测会引入两套代码路径都进包、首屏闪烁等问题）

### D-2 存储模型：内存镜像 + IndexedDB 整表持久化

数据量小（全库 <1MB / 2750 行），采用最简模型：

- 启动：从 IndexedDB 读 13 条记录（每表一条，内容就是快照行数组）→ 内存
- 读：全部走内存（同步、零延迟；Python 端聚合本来也是内存计算）
- 写：改内存 → 写回该表的 IDB 记录（write-through，事务失败 toast 提示）
- 同步后：merge 结果整体写回对应表记录
- **本地只是镜像**：设置页提供「重置本地并重新拉取」（删 IDB → 全量 pull），WebView 的 IndexedDB 任何怪癖都只是体验问题不是数据问题（权威副本在 GitHub）

不做 per-row 索引/查询引擎（Dexie 索引等）——现有访问模式都是全量加载后 JS 过滤，无需引入。

### D-3 持久化端口（为 E 阶段预留）

```ts
interface Persistence {
  loadTable(name: string): Promise<Row[] | null>
  saveTable(name: string, rows: Row[]): Promise<void>
  loadMeta(key: string): Promise<string | null>   // base 快照、同步状态、PAT
  saveMeta(key: string, val: string): Promise<void>
}
// D: IdbPersistence（IndexedDB）
// E: CapacitorSqlPersistence（同一接口，换实现文件即可）
```

merge/provider/engine 只依赖此接口与行数据，不含任何浏览器 API——这是「E 阶段换 SQLite 不改核心」的保证。

### D-4 同步移植的验收基准：golden vectors（与 M0 合并执行）

- Python 侧新增 `tests/gen_golden.py`：跑一组精心构造的合并场景（现 13 个单测场景 + 边界：同秒平局、墓碑复活、id 重映射、首次绑定两模式），输出 `tests/golden/merge_vectors.json`（输入三快照+墓碑 → 期望输出）
- TS 侧 `core/__tests__/merge.golden.test.ts` 逐条对拍；**全绿 = 两个实现行为一致**的唯一权威标准
- provider.ts 移植必须覆盖四大陷阱的等价单测（空仓 409、blob 409 bootstrap、403 权限/限流区分、404 未授权），用 msw 模拟（Python 侧 MockTransport 测试逐条翻译）

### D-5 规范序列化（remote_changed 判定稳定）

Python `encode_files` 按 `json.dumps(sort_keys=True)` 排序行。TS 需要等价的 `canonicalStringify`（递归排序对象键）保证同一数据两边产出同序——「远端是否变化」的判定才不会假阳性。golden vectors 附 3 条序列化稳定性用例。

### D-6 PAT 存储与威胁模型（D 阶段明文，UI 明示）

- localStorage 存 PAT（fine-grained、仅授权数据仓 Contents）——自用威胁模型：站点代码自己构建托管、无第三方脚本、无 XSS 注入面
- 设置页文案明示「PWA 模式下 PAT 以明文存储于本浏览器，请勿在公用设备使用」
- E 阶段自动升级：secrets.ts 端口换 Keychain/Keystore 实现

### D-7 节假日资产

`tools/export_holidays.py`：chinese_calendar → `core/assets/holidays_2024_2030.json`（节日名+调休补班）。aggregate.ts 只读 JSON。上游年更 → 重跑脚本提交。桌面端不换（保持 chinese_calendar），两边数据同源同义。

### D-8 托管与部署

- GitHub Pages 挂在 **TT_Calendar 代码仓**（public）的 `gh-pages` 分支，GitHub Actions 自动部署（`npm run build --mode pwa` → 上传 dist）
- 域名 `https://tdiang2.github.io/TT_Calendar/`（免费、HTTPS、国内可访问性≈GitHub API 本身）
- Service Worker 只预缓存应用壳（vite-plugin-pwa/Workbox）；数据永不进 SW 缓存（每次从 IDB/内存出）

## 4. 最小测试单位（Walking Skeleton，用户点名项）

**定义：D1 期结束必须存在的一个端到端可执行证明**——不写 UI，先证明最难的部分（TS 同步引擎与 Python 客户端通过真实 GitHub 仓库互操作）：

```
tests/walkthrough.mts（pnpm tsx 运行）：
 1. 用 core/provider.ts fetch 数据仓 test 分支（由桌面 Python 端事先推好基线）
 2. 断言快照结构与 Python 导出一致（表齐全、行数一致、todo.json 抽样字段一致）
 3. 本地改 1 条 todo + 新增 1 条 → merge → push（新 commit）
 4. 桌面 Python 端跑 sync_now 拉取 → 断言收到 2 条变更（pulled=2）
 5. 反向：Python 改 → TS 拉 → 断言 merged
```

**通过标准 = 双向 round-trip 在真实 GitHub 上成功**。此骨架通过后，后续所有期只是往已验证的地基上加 UI。同时它就是以后 E 阶段的验收脚本（Capacitor 换持久化后重跑）。

## 5. 分期计划（每期独立可验收、可停）

### D0 协议固化（地基，纯文档+测试资产）
- 改动：`docs/SYNC_PROTOCOL.md`（快照格式/schema_version 演进/合并精确语义/首次绑定）；`tests/gen_golden.py` + `tests/golden/merge_vectors.json`（≥20 向量）；`tools/gen_types.py`（PRAGMA → core/types.ts，一次性生成）
- 验收：pytest 重生成 vectors 与提交版 diff 为空；vitest 壳工程建好消费 vectors（merge.ts 尚未写，标 xfail）
- 测试单位：`gen_golden.py` 幂等 + vectors 覆盖所有合并语义分支

### D1 TS core 数据层（无 UI）
- 改动：`core/{types,store,merge,provider,engine,secrets,canonical}.ts` + 全套单测（vectors 对拍 + msw 四陷阱 + 并发锁/base 快照读写）
- 验收：**§4 Walking Skeleton 通过**（真实 GitHub test 分支双向 round-trip）
- 测试单位：walkingthrough.mts 一键脚本

### D2 前端接入（PWA 能用，桌面布局）
- 改动：data-mode 切换层；aggregate.ts + holidays.json；todo/日历/倒数视图读 core；CRUD 写 core（todo/marks/coloring/events/schedule_items/图层/设置）
- 验收：`npm run dev:pwa`（core 模式）在电脑浏览器呈现完整月视图+待办（数据来自一次真实 pull）；改数据后 push，桌面 Python 端能拉到
- 测试单位：Playwright 冒烟（桌面视口：启动→同步→看到 8 月格子与待办→勾选一条→再同步→状态报告 pulled/pushed 正确）

### D3 响应式 UI（手机可用）
- 改动：`<768px` 断点：底部 Tab（日历/待办/倒数/设置）、详情改底部 sheet、触屏交互（长按替代右键/拖拽换长按菜单或按钮）、safe-area
- 验收：390×844 视口四个 tab 全部可操作；桌面窄窗口（<768）同样受益
- 测试单位：Playwright 设备模拟（iPhone/Pixel profile）跑 D2 的冒烟脚本

### D4 PWA 壳与发布
- 改动：vite-plugin-pwa（manifest/图标/precache）、iOS meta、`navigator.storage.persist()`、设置页（仓库/分支/PAT/状态/立即同步/重置本地）、GitHub Actions 部署 gh-pages
- 验收：Lighthouse PWA 可安装 ✓；电脑 Edge/Chrome 安装后离线可用 ✓；**手机浏览器打开 Pages URL → 安装到主屏 → 配置 → 与桌面真实数据（main 分支）双向同步成功**（最终验收，需一次真机操作）
- 测试单位：真机 checklist（用户执行，5 分钟）

## 6. 测试策略总览（含真机/工具成本）

| 层 | 手段 | 环境 | 成本 |
|---|---|---|---|
| 合并语义 | golden vectors（pytest 生成 ↔ vitest 对拍） | 电脑 | 0 |
| Provider | msw 模拟（四陷阱等价单测） | 电脑 | 0 |
| 数据层/聚合 | vitest 单测（Python 测试翻译） | 电脑 | 0 |
| UI 冒烟/响应式 | Playwright（桌面+设备模拟 profile） | 电脑 | 0 |
| 互操作 | Walking Skeleton（真实 GitHub test 分支） | 电脑 | 0 |
| 真机-Android | Chrome `chrome://inspect` USB 调试（免费用安卓真机） | 安卓机+数据线 | 0 |
| 真机-iOS | 无 Mac 无 Web Inspector → 自用 dogfood + 可选内嵌 vconsole 取日志 | iPhone | 0（Mac ¥X 后续再说） |
| 持续集成 | GitHub Actions：pytest + vitest + build | 云端 | 0（公开仓免费） |

桌面测不到、必须真机的项（D4 验收 checklist 覆盖）：iOS safe-area、standalone 启动画面、iOS 安装横幅、触屏滚动物理回弹、键盘弹出布局。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| TS/Python 合并行为漂移 | golden vectors 进 CI，双实现共享同一份向量，任何一边改动跑两边 |
| WebKit IndexedDB 数据丢失/损坏 | 本地只是镜像 + 「重置本地重新拉取」按钮 + 启动校验 manifest.schema_version |
| PAT 泄露面 | fine-grained 最小授权（仅数据仓 Contents）+ UI 明示 + E 阶段 Keychain 升级路径 |
| Pages/GitHub API 国内不稳 | 与现有桌面同步同源风险（用户已可直连）；部署产物纯静态可随时迁 Gitee Pages/Netlify |
| todo.json 增长（现 602KB） | 手机网络单次同步 <1s 可接受；若超 5MB 再分片（快照格式预留 per-table 分文件） |
| 大改前端破坏桌面版 | core 模式与 api 模式构建隔离（`--mode pwa`），桌面 tauri build 路径零 diff；CI 双构建都过 tsc |
| scope 蔓延 | 每期验收后停，用户确认再进下一期 |

## 8. 与 E/B 阶段的衔接（投资保护）

- D1 产出的 core/* 全部按「无浏览器 API 依赖」（除 Persistence 实现）编写 → E 阶段：加 CapacitorSqlPersistence + Keychain secrets 实现 + 壳工程，核心零改动
- B 阶段（Tauri mobile）：core 同样跑在 Tauri WebView → Rust 移植从「必需」降级为「可选性能优化」
- Walking Skeleton 脚本在 E/B 阶段直接复用为回归测试

## 9. 立即下一步

D0（协议固化 + golden vectors + 类型生成）——一个 PR 量级，产出即所有后续阶段的地基。
