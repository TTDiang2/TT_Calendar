# TT Calendar 移动端（iOS / Android）可行性研究

> 阶段：研究探索（2026-08）。目标：把 TT Calendar 带到手机上，硬约束 **0 元预算、0 自租服务器**。
> 技术事实均经 2026-08 检索核验（来源附文中）。决策后进入架构设计阶段再出实施计划。
> 前置阅读：SYNC_PLAN.md（同步架构——本文所有路线的数据互通基石）、ARCHITECTURE.md（领域模型）。

## 0. 结论速览

| | A 直接搬（内嵌 Python） | B Tauri 2 + Rust 移植 | C 全量重写 | D PWA | E Capacitor + TS 数据层 |
|---|---|---|---|---|---|
| 前端复用 | 100% | 100% | 0% | 100% | 100% |
| 后端逻辑复用 | 100% | 0%（移植 Rust） | 0% | 0%（移植 TS） | 0%（移植 TS） |
| 需要新语言 | 无 | Rust | Dart/Kotlin | 无 | 无 |
| iOS 成本 | 需上架账号 | 需上架账号 | 需上架账号 | **0 元** | 上架需账号；不上架仅 Android |
| 上架分发 | ✓ | ✓ | ✓ | ✗（仅主屏安装） | ✓（Android 免费 APK） |
| 维护面 | **大**（双平台 Python 工具链） | 中 | 大（两套 UI） | 小 | 小 |
| 综合评价 | 可行但最重 | 备选 | 不推荐 | **先导** | **主线（推荐）** |

**推荐：E 为主线、D 为免费先导**。核心逻辑：D（PWA）和 E（Capacitor）共享同一套「TS 数据层」——先做 D 相当于免费验证了 E 的全部核心逻辑；桌面端 Python sidecar 完全不动，天然满足「手机电脑不同技术栈、只保证数据互通」。

**所有路线的共同地基 = 同步契约**（快照 JSON + 三方合并 + 墓碑，语言无关），这是本项目最有价值的设计决策——移动端无论用什么写，只要实现同一份合并语义，数据就能互通。

## 1. 现状架构审计：什么是资产，什么是负债

### 1.1 资产（跨路线复用）

| 资产 | 说明 |
|---|---|
| React 前端 | 全部 UI 逻辑（视图/编辑器/设置），任何 WebView 系路线（B/D/E）~100% 复用 |
| **同步契约** | 快照格式（每表一 JSON + tombstones + manifest.schema_version）+ 三方合并语义（LWW + 墓碑裁决）——纯数据结构和纯算法，**与语言无关** |
| `client.ts` API 面 | 前端只通过这 ~25 个函数与后端交互，边界清晰 → TS 数据层只需实现同一接口签名，前端零改动即可切换 |
| SQLite 模式 | 表结构 + 触发器（touch/tombstone/sync_uid）全是标准 SQL，任何平台 SQLite 通用 |
| 单用户单文件数据模型 | 无并发用户、无服务端状态——移动端本地化最友好的形态 |

### 1.2 负债（移动化阻碍点）

| 负债 | 影响路线 | 处置 |
|---|---|---|
| Python 后端 | 全部 | A 内嵌 / B 移植 Rust / D、E 移植 TS（见各节） |
| pydantic v2（pydantic-core 是 Rust 编译扩展，无移动端官方 wheel） | A | Android：Python 3.13+ 用 cibuildwheel 自建，或 CPython 3.14 官方 Android 二进制生态成熟后直接用；iOS：mobile-forge 自建。实证存在（CIRISAgent 项目在 Chaquopy 跑通 FastAPI+pydantic 2.23）但 gradle 配置复杂 |
| DPAPI（PAT 加密） | 全部 | 抽象成接口：Win=DPAPI / iOS=Keychain / Android=Keystore / PWA=WebCrypto 或接受 localStorage（自用威胁模型） |
| chinese_calendar（纯 Python 节假日库） | 全部（B/D/E 都无 Python） | **数据资产化**：写导出脚本生成 N 年节假日+调休 JSON，各端内嵌同一份数据文件（上游每年更新，重跑脚本即可） |
| 桌面三栏布局 | 全部 | 移动端信息架构重设计（§7.4）——纯前端工作，且桌面窄窗口先受益 |
| PyInstaller sidecar / launcher | B（Tauri 移动端不支持外挂二进制） | Tauri mobile 只有 Rust 插件机制，sidecar 模型进不去 |

### 1.3 后端职责拆解（移植工作量估算的基准）

后端 ≈ 四块职责，可移植性逐一评估：

| 职责 | 代码量级 | TS 移植难度 | 备注 |
|---|---|---|---|
| CRUD + 存取（routes + db） | 大但机械 | 低（SQL 平移，或换 IndexedDB/sqlite-wasm） | 接口签名照 client.ts |
| 视图聚合（aggregator：月/周/年视图、图层色、忙度、节假日） | 中，逻辑密集 | 中 | 唯一依赖 chinese_calendar，换 JSON 数据 |
| 同步引擎（sync 包：snapshot/merge/provider/engine） | 中，**纯逻辑** | 中 | merge.py 有 13 个单测 → 直接转成 TS 的 golden 测试 |
| 数据源导入（jisilu 抓取） | 小 | 低（fetch + DOMParser）或标记桌面专属 | 非核心 |

## 2. 路线 A：直接搬——内嵌 Python 后端

> 对应直觉「只有后端的 python 不太好搞定，但或许也有办法」。

### 2.1 技术事实（2026-08 核验）

- **Android（Chaquopy）**：Gradle 插件，嵌入 CPython 3.8-3.13。pydantic v2 长期是痛点（chaquopy#1017，2023 开至今）：pydantic-core 无官方 Android wheel。两条出路：① 升 Python 3.13/3.14 后用 **cibuildwheel 官方 Android 支持**自建 wheel（chaquopy PR #1413 已验证 sysconfig 路径可行；CPython 3.14 起**官方发布 Android 二进制**）；② 有实证项目（CIRISAgent）在 Chaquopy 里跑 FastAPI 0.115 + uvicorn + pydantic 2.23，代价是 160 行 gradle 魔法搬运 wheel。uvicorn 需禁用 uvloop/httptools（纯 Python 回退可用）。
- **iOS（beeware/Python-Apple-support）**：成熟（1331 星，2026-01 发 3.13-b13），CPython 3.13 起 PEP 730 官方 iOS 支持；App Store 的 Privacy Manifest 拒审问题 2025-06 已解决。二进制 wheel 用 mobile-forge 自建——pydantic-core（Rust）需自己交叉编译 iOS 版。
- **App Store 政策**：允许内嵌解释器（大量 Python壳 App 在架），禁止**运行时下载可执行代码**——我们把全部代码打进包，合规。

### 2.2 评价

- ✓ 后端逻辑 100% 复用（含同步引擎、chinese_calendar、jisilu），前端套 WebView 加载本地 React 构建即可
- ✗ 双平台两套 Python 工具链（Chaquopy gradle / mobile-forge make），每次升级依赖都可能踩编译坑
- ✗ 包体积 +50~80MB、冷启动 1~3s、内存占用高
- ✗ iOS 无 Mac 无法本地构建（所有原生路线都如此，但 A 的构建链最脆弱）
- 结论：**可行、作为兜底备案，不推荐主线**。与用户直觉一致——"丑陋"主要指维护体验。

## 3. 路线 B：Tauri 2 mobile——前端原样，后端移植 Rust

> 现有桌面就是 Tauri，此路线工具链连续性最好。

### 3.1 技术事实

- Tauri 2.0 **stable**（2024-10），官方支持 iOS/Android（`tauri ios init/build`、`tauri android init/build` CLI 就绪；Swift/Kotlin 插件桥接成熟）
- 关键限制：**移动端不支持 sidecar 外挂二进制** → Python 后端无法进入，后端逻辑必须移植成 Rust command（或 Rust 侧跑本地逻辑 + 前端 fetch 改调用 command）
- SQLite：tauri-plugin-sql（rusqlite 底座）；HTTP：reqwest。依赖的 Rust 生态齐全
- 现有 `frontend/src-tauri` 需重构为 lib + mobile target 结构（官方有迁移指南）

### 3.2 评价

- ✓ 前端 100% 复用；与桌面同一框架，未来桌面也能换掉 Python sidecar（可选演进）
- ✗ 后端全部逻辑（聚合 + 同步 + CRUD）用 **Rust 重写**——merge/aggregator 不难，但开发迭代速度比 TS 慢数倍，且本项目维护者是「用户 + AI」，TS 与前端同语言的心智成本优势巨大
- ✗ chinese_calendar 无 Rust 对应（需数据资产化——所有路线共同工作）
- 结论：**备选**。若未来追求极致性能/包体，或想统一桌面后端，再评估。

## 4. 路线 C：全量重写（Flutter / KMP / React Native）

- UI 全部重写（放弃 React 资产），逻辑可共享（KMP）或双写
- 对个人工具型应用，成本收益比完全不成立；两套 UI 永久双维护
- 结论：**否决**。记录在案防止反复。

## 5. 路线 D：PWA——GitHub Pages 免费托管 + 浏览器直连 GitHub

> 零成本、零上架、零原生工具链。是 E 路线的免费先导。

### 5.1 架构

```
手机浏览器/主屏 PWA
 ├─ React 前端（同一套代码，vite build 出静态站）
 ├─ TS 数据层（新写）：IndexedDB（或 sql.js）本地存储 + 离线可用
 ├─ 同步：fetch 直连 api.github.com（Git Data API，与桌面 provider 同协议）
 └─ 托管：GitHub Pages（静态，免费，数据仍在用户自己的 tt-calendar-data 仓）
```

### 5.2 技术事实（2026-08 核验）

- **GitHub REST API 官方支持任意来源 CORS**（`Access-Control-Allow-Origin: *`，Authorization 头在预检白名单）→ 浏览器 JS 持 PAT 直连，无中间层，合规可行
- **iOS 7 天存储驱逐只影响 Safari 标签页**；**主屏安装的 PWA 不受 7 天限制**（WebKit 官方声明：「Web applications added to the home screen… We do not expect the first-party in such a web application to have its website data deleted」）；`navigator.storage.persist()` 可进一步加固
- iOS 16.4+：已安装 PWA 支持 Web Push；standalone 模式（无浏览器栏）体验接近原生
- WebKit IndexedDB 历史缺陷多 → 最佳实践恰是我们的架构：**本地只作镜像，GitHub 仓库是权威副本**（丢本地随时全量拉回）

### 5.3 评价

- ✓ 0 元 0 服务器 0 审核；iOS/Android 通吃（Android Chrome、iOS Safari 均可装主屏）；离线可用（Service Worker）
- ✓ TS 数据层与 E 路线 100% 共享——先做 D 等于免费完成 E 的核心
- ✗ PAT 存 localStorage（无 DPAPI/Keychain）：自用威胁模型可接受（站点代码自己托管、无第三方脚本注入面），但要在设置页明示；XSS 是唯一攻击面
- ✗ 国内 GitHub Pages 偶发访问不稳（与 GitHub API 直连同源风险，用户已验证可直连）；不能进应用商店；iOS PWA 无法做系统分享目标等深度集成
- 结论：**先导路线，做完即可日用**。

## 6. 路线 E：Capacitor 原生壳 + TS 数据层（推荐主线）

> 对应直觉「手机 app 和电脑 app 用不同技术手段写，只要保证数据互通」。

### 6.1 架构

```
Capacitor 壳（iOS WebView / Android WebView）
 ├─ React 前端（同一套代码）
 ├─ TS 数据层（与 D 完全同源）
 │   ├─ @capacitor-community/sqlite：真 SQLite 文件（表结构+触发器与桌面同构）
 │   ├─ 同步引擎 TS 版（同一份 merge 语义 + golden 对拍）
 │   └─ GitHub provider（CapacitorHttp 或原生 fetch，无 CORS 限制）
 ├─ 密钥：capacitor-secure-storage-plugin（iOS Keychain / Android Keystore）——DPAPI 的对等物
 └─ 分发：Android 直接发 APK（免费）；iOS 需 Apple Developer（¥688/年）走 TestFlight/App Store
```

### 6.2 评价

- ✓ 前端 + TS 数据层全部复用；真原生能力（推送、分享、文件）按需接插件
- ✓ 可上架（若将来愿意付费）；Android APK 零成本分发
- ✗ 仍需维护 iOS/Android 构建环境（Mac + Xcode 是 iOS 硬门槛）；WebView 渲染性能低于原生（本项目数据量完全无压力）
- 结论：**主线**。在 D 验证数据层正确性之后启动，壳层工作量很小（主要是指纹/图标/签名配置）。

## 7. 横切关注点（无论选哪条路线都必须做）

### 7.1 同步协议固化（最高优先级，所有路线的地基）

把 SYNC_PLAN.md 里的合并语义升级为**正式规范 + 一致性测试向量**：

- 新增 `docs/SYNC_PROTOCOL.md`：快照文件格式、schema_version 演进规则、合并算法精确语义（LWW 平局规则、墓碑 vs 行胜的边界条件、id 重映射）、首次绑定两模式
- **Golden vectors**：用 Python 实现生成一组「输入三快照 → 期望合并输出」的 JSON 测试用例（现有 13 个 merge 单测直接机器转译），任何新语言实现（TS/Rust）对拍全绿才算兼容
- 这是防止「双实现行为漂移」的唯一可靠手段，成本一个 PR 级别

### 7.2 密钥存储抽象

`secrets.py` 已隔离成模块 → 各端实现同名接口：Win=DPAPI / iOS=Keychain / Android=Keystore / PWA=WebCrypto 包一层或明文 localStorage（明示用户）。

### 7.3 节假日数据资产化

导出脚本：chinese_calendar → `holidays_2024-2030.json`（含节假日名 + 调休补班日），随前端构建内嵌。上游年更 → 重跑脚本。桌面端可顺带换用同一份数据（可选，不强求）。

### 7.4 移动端 UI 信息架构（纯前端，桌面先受益）

- 桌面：三栏（侧栏/主区/详情）→ 手机：**底部 Tab**（日历 / 待办 / 倒数 / 设置）+ 详情改**底部抽屉（sheet）**
- 月视图保留网格（手机上格子改点按→抽屉详情）；年视图改滚动列表或缩略网格
- 响应式断点（<768px 切移动布局）——桌面窄窗口同时受益
- 拖拽排序等桌面交互在触屏上换长按菜单（WebView2/移动 WebView 的 HTML5 DnD 都不可靠）

### 7.5 同步触发策略

移动端无常驻后台 → 维持现有「启动拉取 + 手动按钮 + 前台定时」策略，天然兼容；将来可加 iOS PWA Web Push / 原生推送做「提醒拉取」。

### 7.6 类型共享

Python pydantic models 与 TS types 目前手工双写 → 写脚本从 SQLite `PRAGMA table_info` 生成 TS interface（或 pydantic → JSON Schema → TS），一劳永逸防漂移。

## 8. 分期路线图（推荐方案 D+E 的执行顺序）

| 期 | 内容 | 产出 | 依赖 |
|---|---|---|---|
| M0 | 同步协议固化：SYNC_PROTOCOL.md + golden vectors | 规范 + 双语言对拍测试集 | 无 |
| M1 | 移动端响应式 UI（底部 Tab / 抽屉 / 触屏交互） | 桌面窄窗可用的自适应前端 | 无 |
| M2 | TS 数据层：types 生成 + merge/busy/聚合移植 + IndexedDB 持久化 + GitHub provider | `frontend/src/core/` 包，单测对拍全绿 | M0 |
| M3 | PWA：Service Worker + manifest + 部署 GitHub Pages | 手机可安装可离线可同步 | M1+M2 |
| M4 | Capacitor 壳：sqlite/secure-storage 插件、图标签名、Android APK（iOS 视预算） | 可安装的安卓 App | M2 |
| M5 | （可选）Tauri mobile / 内嵌 Python 兜底 | 备选路线激活条件见 §2-3 | — |

桌面端（Python sidecar）全程不动。每期结束都有独立可用产出，随时可停。

## 9. 决策问题（question 待确认）

1. 是否认可「D 先导 + E 主线、桌面不动」的总路线？
2. iOS 是否值得 ¥688/年 上架？（若否，iOS 走 PWA 即可，E 只出 Android）
3. M0（同步协议固化）是否先行启动？
