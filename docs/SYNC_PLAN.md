# TT Calendar 多端同步 — 架构设计与实施计划

> 决策定稿（2026-08，用户确认）：**GitHub 私有仓库**承载、本期仅 Windows 多机、**启动时自动同步一次 + 设置页手动按钮**。
> 前置研究见 SYNC_RESEARCH.md（方案对比、额度核验）。同步引擎 provider 可插拔，为未来 Gitee/坚果云/iOS·Android 留接口。

## 1. 总体架构

```
┌──────────────────────────── 本地 ────────────────────────────┐
│  前端 (React)                    sidecar (Python)             │
│  ├ 设置页「数据同步」区块         │  tt_calendar/sync/          │
│  │  仓库/PAT/分支/自动开关        │   ├ engine.py   编排        │
│  │  测试连接 / 立即同步 / 报告     │   ├ snapshot.py db↔JSON    │
│  └ App 启动 → POST /sync/now    │   ├ merge.py    三方合并    │
│                                 │   ├ providers.py GitHub API │
│                                 │   └ tombstones.py          │
│                                 │  backend/routes.py          │
│                                 │   └ /api/sync/* 路由        │
│  data/calendar.db (SQLite)      │                            │
│  data/sync_base/*.json ←base快照 │                            │
└─────────────────────────────────┴────────────────────────────┘
                                  │ HTTPS（Git Data API，无需本地 git）
                          GitHub 私有仓库 tt-calendar-data
                          data/{todo,marks,...}.json + manifest.json
```

一次 sync = pull → 三方合并 → 写库 → recompute day_busy → push → 更新 base。

## 2. 数据契约（同步的根基）

> **实施期修订（2026-08-15）**：events 表只同步 `source='manual'` 的手工事件。
> countdown 源（纪念日生成的 events）和 jisilu 源（抓取缓存）都是"启动时删旧插新"的派生数据，
> 同步它们只会产生海量无意义墓碑和 uid 抖动——各设备自行重建即可。墓碑触发器对 events
> 加了 `WHEN OLD.source = 'manual'` 守卫。另：所有触发器启动时 DROP 后重建（免版本管理）。

### 2.1 仓库文件布局

```
manifest.json          {"schema_version":1, "exported_at":..., "device":...}
data/todo.json         # 每表一个文件，内容为 {"rows":[...]} 数组
data/todo_list.json
data/events.json
data/schedule.json
data/coloring.json
data/marks.json
data/schedule_items.json
data/countdown.json
data/layer_config.json
data/meta.json         # 排除 key LIKE 'sync.%'（同步凭据永不上传）
data/tombstones.json
```

day_busy 不上传（派生数据，同步后本地 recompute）。

### 2.2 行身份：新增 sync_uid 列（解决自增 id 跨设备撞号）

events / schedule_items / countdown / marks 四张 INTEGER 自增表加列：

```sql
ALTER TABLE events ADD COLUMN sync_uid TEXT;
-- AFTER INSERT 触发器自动补 uuid（存量行由迁移脚本一次性补）
CREATE TRIGGER events_sync_uid AFTER INSERT ON events
FOR EACH ROW WHEN NEW.sync_uid IS NULL
BEGIN
  UPDATE events SET sync_uid = lower(hex(randomblob(8)))||'-'||lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(12)))
  WHERE rowid = NEW.rowid;
END;
```

- TEXT 主键表（todo/todo_list/layer_config/meta/schedule/coloring）直接用主键做行身份，不加列。
- 本地自增 id 保留（前端/API 零感知），sync_uid 只在同步层使用。
- marks 已有 UNIQUE(layer_id, date)，sync_uid 冗余但统一模型更简单。

### 2.3 updated_at 自动维护（触发器，应用层零改动）

`todo` UPDATE 不刷时间戳、`layer_config`/`meta`/`todo_list` 无时间戳 → 统一加触发器。**精华在 WHEN 条件**：

```sql
-- 应用层 UPDATE（不动 updated_at）→ new=old → 触发器刷新 ✓
-- 同步 import 写入（显式 SET updated_at=远端原值）→ new≠old → 不动作 ✓
-- 不会把"被动接受远端行"误标成"本地主动修改"
CREATE TRIGGER todo_touch AFTER UPDATE ON todo
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE todo SET updated_at = datetime('now','localtime') WHERE id = NEW.id;
END;
```

（SQLite 默认 recursive_triggers=OFF，内层 UPDATE 不会再触发自身；给上述 4 张无时间戳表补 `updated_at TEXT` 列 + 同款触发器。）

### 2.4 删除可见性：tombstone 表 + AFTER DELETE 触发器

```sql
CREATE TABLE sync_tombstones(
  table_name TEXT NOT NULL,
  row_key    TEXT NOT NULL,   -- TEXT主键表的PK值 / 自增表的 sync_uid
  deleted_at TEXT NOT NULL,
  PRIMARY KEY(table_name, row_key)
);
CREATE TRIGGER todo_tombstone AFTER DELETE ON todo
FOR EACH ROW BEGIN
  INSERT OR REPLACE INTO sync_tombstones VALUES('todo', OLD.id, datetime('now','localtime'));
END;
```

10 张用户数据表全部建。墓碑保留 90 天（每次成功同步后清理过期项）。

### 2.5 时区假设

现有时间戳均为本地时间字符串（无时区）。**假设所有同步设备同时区（UTC+8）**，merge 按字符串比较。manifest 记录 tz 供未来校验。跨时区支持留待移动端阶段（届时迁移 UTC）。

## 3. 三方合并协议（merge.py）

输入：base（上次同步快照）、remote（远端）、local（本地当前导出）。输出：merged + 报告。

```
逐表逐行（row_key 身份）：
  remote==base 且 local==base        → 不动（两边都没改）
  仅 local 改（remote==base）        → 取 local（下次 push 上去）
  仅 remote 改（local==base）        → 取 remote（写库，保留远端 updated_at）
  两边都改：
    内容相同                          → 无害，取任一
    内容不同                          → updated_at 字符串大者胜（LWW）
                                      → 记入冲突报告（表/键/裁决方向）
删除裁决（对该行 tombstone 参与比较）：
  tombstone.deleted_at > 行.updated_at → 删除胜（行不进 merged，墓碑保留）
  否则                                  → 行胜（复活，墓碑删除）
```

首次绑定（本地无 base）：
- 远端也空 → 全量上传（初始化仓库）
- 远端有 → UI 二选一：`pull_overwrite`（远端覆盖本地）/ `merge_push`（本地与远端全量并集合并后上传，删除不裁决）

失败安全：merge 全程内存操作；写库单事务；push 失败不影响本地已合并状态（下次 sync 重试，幂等）。

## 4. GitHub Provider（providers.py）

Fine-grained PAT（仅授权该私有仓库 Contents: RW）。纯 HTTP，无 git 二进制依赖：

- **fetch**：GET `/repos/{r}/git/ref/heads/main` → commit sha → `GET /git/trees/{sha}?recursive=1` → 逐 blob `GET /git/blobs/{sha}`（base64 解码）→ Snapshot。tree sha 与本地缓存一致则远端无变化，跳过下载。
- **push**：仅变更文件逐个 `POST /git/blobs` → `POST /git/trees`（base_tree=远端当前 tree，替换变更路径）→ `POST /git/commits`（parent=远端 HEAD）→ `PATCH /git/refs/heads/main`。一次 sync = 一个 commit（网页可读的同步史）。
- **test**：GET `/repos/{r}` 验证 200 + 权限。
- 并发写（两台设备同时 push）：PATCH ref 带 `force=false`，409（fast-forward 失败）→ 自动重新 fetch+merge+push 一次，再失败则报告冲突。

## 5. API（backend/routes.py）

| 方法/路径 | 作用 |
|---|---|
| GET /api/sync/status | {configured, provider, last_sync_at, last_report} |
| GET /api/sync/config | {repo, branch, auto_sync_on_start}（**不返回 token**） |
| PUT /api/sync/config | 保存配置（token 可选更新，存 meta 表 `sync.*` 键） |
| POST /api/sync/test | 连接测试 |
| POST /api/sync/now | 完整 sync；首次绑定返回 {needs_decision:true} |
| POST /api/sync/resolve | {mode:'pull_overwrite'\|'merge_push'} 解决首次绑定 |

同步报告：{pulled, pushed, conflicts, deleted, revived, duration, commit_url?}。

## 6. 前端（UI 语言）

**设置页新增「数据同步」区块**（SettingsDialog，放在忙度配置之后）：
- 状态行：● 已同步 12:30 / ○ 未配置 / ⚠ 上次失败（点击展开报告）
- 表单：仓库全名（placeholder `TTDiang2/tt-calendar-data`）、分支（默认 main）、PAT（password 框，保存后显示「已存储」而非回显）
- 按钮：「测试连接」/「立即同步」（同步中 spinner，完成后 toast 显示报告摘要）
- 开关：启动时自动同步（默认开）
- 首次绑定弹层：远端已有数据 → 「用远端覆盖本地」/「合并两边并上传」
- 文案明示：数据明文存于你的私有仓库；PAT 仅存本机。

**App.tsx**：启动后延迟 3s，若 auto_sync_on_start 且已配置 → 静默 POST /sync/now（失败不打扰，状态点记录）。

## 7. 安全模型

- PAT：fine-grained、单仓库、Contents RW 最小权限；存本地 meta 表（key=`sync.github_token`，导出排除 `sync.%`）
- 数据：明文 JSON 在用户自己的私有仓库（与代码仓库同安全级）；文档建议仓库私有
- 本机 SQLite 本就明文，威胁模型一致，不加本地加密（记录权衡）

## 8. 测试计划

- **merge 单测**（pytest，纯内存 dict 模拟三快照）：单向拉、单向推、同行双改 LWW、删除 vs 修改、复活、首次绑定两模式，≥10 用例
- **Provider 集成测试**：真实 GitHub 私有仓库（用户提供测试 repo）跑 fetch/push/409 重试
- **端到端**：复制 db 模拟设备 B（改几条→同步→A 拉取→两边一致）；触发器验证（应用 UPDATE 刷时间戳 / merge 写入不刷）
- **exe 链路**：sidecar 含 sync 模块（PyInstaller spec 确认 hiddenimports）→ 完整发布流程

## 9. 实施分期

| 里程碑 | 内容 | 交付物 |
|---|---|---|
| M1（本期） | 触发器/uuid/tombstone 迁移 + snapshot/merge/engine + GitHubProvider + /api/sync/* + 设置页 UI + 启动自动同步 + merge 单测 + exe 发布 | 可用的双向同步 |
| M2（下期） | 同步报告详情页、冲突日志持久化、90 天墓碑清理任务、409 自动重试打磨、Gitee provider | 稳定性+第二渠道 |
| M3（未来） | 坚果云 WebDAV provider、UTC 时间迁移、iOS/Android（另立架构，仅复用快照格式） | 多形态 |

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| GitHub 国内偶发不通 | 用户网络已验证可直连；失败静默重试，手动按钮可随时重试；M2 加 Gitee |
| 超大 JSON（未来 todo 上万条） | 单文件 <几 MB，远低于 100MB；届时可按 list 分片 |
| 双机同时写 409 | 自动 fetch-merge-push 一次；再冲突报给用户 |
| merge 写库误刷 updated_at | 触发器 WHEN 条件设计（§2.3）从根上避免 |
| schema 变更后旧客户端同步 | manifest.schema_version 不匹配 → 拒绝同步并提示升级 |
