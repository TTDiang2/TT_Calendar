# TT Calendar 多端同步方案研究

> 阶段：研究探索（2026-08）。目标：免费、无自租服务器、多台 Windows 设备间同步全部数据（Todo、涂色、纪念日、忙度配置等）。
> 下一阶段：架构设计（见 SYNC_PLAN.md，待方案定稿后编写）。

## 0. 结论速览

| 方案 | 免费额度 | 国内可用性 | 冲突处理 | 历史回滚 | 实现量 | 推荐 |
|---|---|---|---|---|---|---|
| A. Git 同步（GitHub/Gitee 私有仓库） | 私有仓库免费无限制 | GitHub 不稳 / Gitee 快 | ✅ 行级三方合并 | ✅ 天然 git 历史 | 中 | ⭐ **推荐** |
| B. 坚果云 WebDAV | 1GB 上/3GB 下每月，600 请求/30min | ✅ 快且稳 | ✅ 同一套客户端合并引擎 | ⚠️ 网页版有文件历史 | 小 | 备选 |
| C. Cloudflare Workers + D1 | 5GB 存储，读写额度极大 | ❌ workers.dev 国内不稳 | ✅ 中心化无冲突 | ❌ 需自建 | 大 | 不推荐 |
| D. 直接同步 SQLite 文件 | — | — | ❌ 二进制无法合并 | ❌ | — | **否决** |
| E. CRDT（cr-sqlite） | — | — | ✅ 数学上无冲突 | ❌ | 很大 | 未来演进 |

**推荐路径：A 为主体（先 Gitee 或 GitHub 二选一起步），同步引擎按「provider 可插拔」设计，B（坚果云）作为后续可选 provider 复用同一套合并引擎。**

## 1. 数据资产盘点（2026-08 实测）

全库 798KB、11 表、2750 行。同步引擎只需要关心「用户数据」，派生数据不同步。

### 1.1 用户数据表（需要同步，9 张）

| 表 | 行数 | 主键类型 | updated_at | 说明 |
|---|---|---|---|---|
| todo | 1247 | TEXT(uuid) | ❌ **UPDATE 不写时间戳** | 待办（含 tags/planned_date） |
| todo_list | 6 | TEXT(uuid) | ❌ 只有 created_at | 待办列表 |
| events | 222 | INTEGER 自增 | ✅ | 点点/事件 |
| schedule | 158 | TEXT(date) | ✅ | 旧版上午/下午/晚上（date 即业务键） |
| coloring | 429 | TEXT(date) | ✅ | 充实度染色（date 即业务键） |
| marks | 32 | INTEGER 自增 | ✅ | 涂色打卡（有 UNIQUE(layer_id,date)） |
| schedule_items | 224 | INTEGER 自增 | ✅ | 日程条目 |
| countdown | 4 | INTEGER 自增 | ✅ | 纪念日 |
| layer_config | 28 | TEXT(layer_id) | ❌ **无任何时间戳** | 图层配置（含忙度配置所在？否，见 1.2） |
| meta | 2 | TEXT(key) | ❌ | 键值对（含忙度权重配置） |

### 1.2 派生数据（不同步，本地重算）

- **day_busy**（398 行）：由 todo 全量重算（`POST /api/settings/todo-busy/recompute` 已存在），同步后自动触发重算即可。

### 1.3 同步设计的三个硬约束

1. **时间戳缺口**：`todo` UPDATE 不更新时间戳；`layer_config`/`meta`/`todo_list` 无时间戳 → 行级 LWW（Last-Write-Wins）无法直接用。**修法：SQLite AFTER UPDATE 触发器统一补 `updated_at`，应用层零改动。**
2. **自增 id 跨设备冲突**：events/marks/schedule_items/countdown 的 INTEGER 自增 id 在两台设备上会撞号 → 同步合并时不能拿 id 当全局身份。
   - marks 有 `UNIQUE(layer_id, date)` 业务键 ✓
   - schedule 有 date 主键 ✓、coloring 有 date 主键 ✓
   - **events / schedule_items / countdown 没有业务键** → 两个选项：
     - a) 合并时做 id 重映射（远端 id 撞本地 id 时，远端行换个新 id 插入）——不动表结构，merge 逻辑稍复杂
     - b) 一次性迁移成 TEXT uuid 主键——表结构动大，但一劳永逸
   - 推荐 a)（数据量小、冲突窗口低，重映射逻辑集中在一处）
3. **删除不可见**：A 设备删一条，B 设备还有旧快照 → 简单并集会「复活」已删行 → 需要 **tombstone（墓碑）**：单独 `sync_tombstones` 表记录 `(table, row_key, deleted_at)`，同步时删除时间晚于对方行 updated_at 则删除胜出。

## 2. 候选方案详析

### 方案 A：Git 同步（GitHub / Gitee 私有仓库）⭐ 推荐

**原理**：把领域数据导出为文本 JSON（每表一个文件或单文件快照），提交到私有仓库。sidecar 内置同步引擎直接走 HTTP API，**不需要本地安装 git**。

**免费额度（实测核验）**：
- GitHub：私有仓库免费无限个；Contents API 单文件 ≤100MB（我们 <1MB）；认证后 5000 请求/小时；多文件单 commit 用 Git Data API（blobs→tree→commit→ref 四步）
- Gitee：免费版 1000 仓库（不限公私有）、单仓库 500MB、单文件 50MB、总容量 5GB——对 <1MB 快照绰绰有余
- 国内可达性：Gitee 直连快；GitHub API 直连时好时坏（用户可配代理）

**优点**：
- 真·免费无配额焦虑
- **git 历史 = 天然版本回滚**（误删数据可从任意历史 commit 恢复，这对日历/待办数据价值极大）
- JSON 文本 diff 人类可读，GitHub 网页直接看「今天比昨天多了哪几条待办」
- 纯 HTTP API，PyInstaller 打包无新增二进制依赖
- provider 抽象后 GitHub/Gitee 一套代码

**缺点**：
- 需要 fine-grained PAT（token 权限要配好：只授权单个私有仓库的 Contents 读写）
- GitHub 国内不稳（Gitee 无此问题）

**适合场景**：两台以上设备、每日多次同步、想要历史回滚。

### 方案 B：坚果云 WebDAV

**原理**：WebDAV 就是 HTTP PUT/GET 一个 JSON 快照文件。

**免费额度（官方帮助中心 2026 核验）**：每月上传 1GB / 下载 3GB；WebDAV 频率 600 次请求/30 分钟；单文件 ≤500MB。我们按 1MB 快照 × 每天 20 次同步 = 600MB/月，在额度内但不宽裕。

**优点**：
- 实现最简单（PUT/GET/DELETE 三个 HTTP 调用）
- 国内速度快、服务稳定
- 不需要 git 概念，用户心智负担低（「我的数据在网盘里」）

**缺点**：
- 无服务端版本概念（合并只能靠客户端本地 base 快照做三方合并——技术上完全可行，见 §3.2）
- 需要注册坚果云 + 创建应用密码
- 流量配额存在（虽够用）
- 数据躺在第三方网盘，纯明文（私有仓库同样问题，半斤八两）

### 方案 C：Cloudflare Workers + D1（免费服务器代表）

**原理**：写一个 Worker 暴露 REST API，数据存 D1（SQLite 兼容）。客户端读写全走远端或本地缓存+同步。

**免费额度**：D1 免费 5GB 存储、每天 500 万行读/10 万行写。

**为什么不推荐**：
- workers.dev 域名国内直连不稳定，绑自定义域名又要域名钱/备案
- 要写并维护服务端代码（认证、防滥用、API 设计）——和「不想租服务器」的精神相悖
- 数据在第三方数据库，导出/迁移成本高
- 实现量最大（相当于做一个后端服务）

### 方案 D：直接同步 SQLite 文件（否决）

经典错误方案，明确否决：
- 二进制无法 diff/merge，冲突时只能整库覆盖 → 丢一端全部新增
- SQLite WAL 模式下被网盘客户端「部分复制」会**直接损坏数据库**
- 坚果云官方也有大量「同步 SQLite 损坏」案例
- 无版本粒度：错改一条数据无法单独回滚

### 方案 E：CRDT / cr-sqlite（未来演进）

cr-sqlite 给 SQLite 表加 CRDT 能力，多端合并数学上无冲突。但：需要 cgo 扩展（PyInstaller 打包复杂度骤增）、生态早期、对「单用户 2-3 设备、日同步几十次」的场景是杀鸡用牛刀。**记录备查，不用于本期。**

## 3. 推荐方案的技术草案（架构阶段预埋）

### 3.1 同步引擎架构（provider 无关）

```
┌─────────────── sidecar (Python) ────────────────┐
│  SyncEngine                                     │
│  ├─ export:  db → 领域 JSON 快照                 │
│  ├─ merge:   远端快照 vs 本地base vs 本地now      │
│  │           （行级 LWW + tombstone + id 重映射）  │
│  ├─ import:  合并结果 → db + 重算 day_busy        │
│  └─ SyncProvider 接口（可插拔）                   │
│       ├─ GitHubProvider（Contents/Git Data API） │
│       ├─ GiteeProvider（v5 contents API）        │
│       └─ WebDAVProvider（坚果云，PUT/GET）        │
└─────────────────────────────────────────────────┘
```

### 3.2 三方合并的关键：本地 base 快照

无论 provider 是否有版本概念（git 有、WebDAV 没有），客户端本地保存「上次同步完成时的快照」作为 base。合并时：

```
for 每张表 for 每行:
  仅本地改过（base≠local, remote==base）→ 取本地
  仅远端改过（base≠remote, local==base）→ 取远端
  两边都改过：
    行不同 → 按 updated_at 新者胜（LWW）
    删除 vs 修改 → 时间晚者胜（tombstone deleted_at vs updated_at）
  两边都没改 → 不动
```

这样 WebDAV 和 Git 用同一套合并逻辑，provider 只负责「存取快照文件」。

### 3.3 同步协议（一次完整 sync）

1. export 本地当前状态 → local_now 快照
2. 从 provider 拉远端快照 → remote
3. 读本地 base 快照（首次同步无 base → 直接以本地上传/或拉远端覆盖，走「初次绑定」流程）
4. 三方合并 → merged
5. merged 写回本地 db + 触发 day_busy 重算
6. merged 上传 provider + 存为新 base
7. 返回同步报告（拉取 N 条 / 推送 M 条 / 冲突 K 条）

**失败安全**：合并在前端到后端整个流程中只操作内存快照，写库在一个事务里；上传失败不影响本地已合并状态，下次重试。

### 3.4 UI 草案（设置页新增「同步」区块）

- Provider 选择（一期：Gitee 或 GitHub）
- 凭据：仓库全名（如 `TTDiang2/tt-calendar-data`）+ PAT（密码框，存本地 meta 表，不上传）
- 「立即同步」按钮 + 上次同步时间/结果 + 自动同步开关（启动时拉/定时 5 分钟）
- 首次绑定流程：远端空 → 上传本地；远端有 → 提示「拉取覆盖本地 / 合并」
- 冲突日志（哪几行按 LWW 裁决了）

## 4. 待用户决策的问题（见 question）

1. 选哪个 provider 起步（Gitee / GitHub / 坚果云）
2. 多端设备形态（几台 Windows？未来要 Mac 吗——影响测试矩阵）
3. 同步触发偏好（手动 / 启动+定时 / 数据变更后 debounce）
