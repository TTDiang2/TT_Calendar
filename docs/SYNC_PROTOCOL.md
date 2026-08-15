# TT Calendar 同步协议规范

> 本文是同步协议的**唯一权威定义**。任何语言实现（Python 桌面端 / TS 数据层 / 未来 Rust）
> 必须通过 `tests/golden/merge_vectors.json` 对拍全绿才视为兼容。
> 实现：`tt_calendar/sync/`（Python 参考）；文档：SYNC_PLAN.md（架构）、SYNC_SETUP.md（用户指引）。

## 1. 术语

| 术语 | 定义 |
|---|---|
| 快照（snapshot） | 某一时刻全部用户数据的内存形态：`{table: rows[]}` |
| 行身份（row key） | 行的全局唯一标识：TEXT 主键表 = 主键值；自增表 = `sync_uid` |
| base 快照 | 上次同步成功完成时的快照，存本地（`data/sync_base/`），三方合并的锚点 |
| 墓碑（tombstone） | `(table, row_key) -> deleted_at`，删除的可见性记录 |
| LWW | Last-Write-Wins，按 `updated_at` 字符串比较取新 |

## 2. 数据仓布局

```
manifest.json                     元数据
data/<table>.json                 {"rows": [...]}，每表一个文件
data/tombstones.json              {"table|key": "deleted_at"}
```

### 2.1 表集合与行身份（schema_version = 1）

| 表 | 主键 | 行身份 | 导入顺序位 | 说明 |
|---|---|---|---|---|
| todo_list | id (TEXT) | id | 1 | **必须先于 todo**（外键 todo.list_id → todo_list.id） |
| todo | id (TEXT) | id | 2 | |
| layer_config | layer_id (TEXT) | layer_id | 3 | |
| meta | key (TEXT) | key | 4 | **排除 `sync.` 前缀键**（本机私有：PAT 加密串、同步状态） |
| schedule | date (TEXT) | date | 5 | |
| coloring | date (TEXT) | date | 6 | |
| events | id (INTEGER 自增) | sync_uid | 7 | **仅 `source='manual'` 行参与同步**（countdown/jisilu 源是派生缓存） |
| schedule_items | id (INTEGER 自增) | sync_uid | 8 | |
| countdown | id (INTEGER 自增) | sync_uid | 9 | |
| marks | id (INTEGER 自增) | sync_uid | 10 | |

约束：
- **导入顺序 = 上表顺序**（被引用表在前；当前唯一外键依赖是 todo→todo_list）
- 自增表导出时**剥离本地 id**（导入端重新分配自增值）；TEXT 主键表保留主键
- `day_busy` 表不参与同步（派生数据，导入端重算）
- 时间戳：本地时间字符串（`YYYY-MM-DD HH:MM:SS` / ISO），**同时区假设**；比较一律按字符串字典序

### 2.2 规范序列化（canonical serialization）

「远端是否变化」的判定依赖两端产出**字节一致**的文件：

- 行数组排序：按行内容 `json.dumps(row, sort_keys=True, ensure_ascii=False)` 的字符串排序
- 文件内容：`json.dumps({"rows": [...]}, ensure_ascii=False)`，键序为插入序（rows 单键）
- tombstones：按 `"{table}|{key}"` 字符串排序的 dict，序列化无缩进
- manifest 不参与变化判定（含设备名/时间戳）

## 3. 合并算法（精确语义）

### 3.1 行合并（每表每行，三方比较）

输入 base/remote/local 三行（可为 absent）。判定顺序（**短路，依次判**）：

```
1. remote == local                → 取该行（两边一致；都 absent 则行不存在）
2. base == remote（仅本地改过）    → 取 local
3. base == local（仅远端改过）     → 取 remote
4. 双边都改过                     → LWW 裁决：
                                    updated_at 大者胜；**平局（含双双 absent 时间戳）→ local 胜**
                                    absent 视为 ""（最小），即存在的行胜过 absent
```

注意 absent 的语义：`base == remote == absent` 且 local 有值 → 走规则 2（新增推送）；`base == local == absent` 且 remote 有值 → 规则 3（拉取）。

### 3.2 墓碑合并

```
merged_tombstones = {k: max(local_tombs[k], remote_tombs[k]) by deleted_at}
```

### 3.3 删除裁决（墓碑 vs 幸存行）

对 merged_tombstones 中每个 `(table, key)`，若该行在合并结果中**存在**：

```
deleted_at > row.updated_at   → 删除胜：行从结果中移除，墓碑保留
否则（<=）                     → 行胜（复活）：墓碑移除
```

比较同为字符串字典序。**相等 → 行胜**（复活），避免同秒删除/修改抖动导致复活失败。

### 3.4 差集计算（写库用）

```
基准 = diff_local（常规同步 = local；pull_overwrite = 真实 local 但合并参与者为空）
upsert  = merged 中与基准不同的行
deletes = 基准中有、merged 中无的 row_key
```

### 3.5 报告计数

`pulled / pushed / conflicts / deleted / revived`——deleted 计差集删除数，revived 计复活数。

### 3.6 表集合完整性

参与合并的表集合 = `remote ∪ local ∪ base ∪ diff_local` 的表名并集。
**任何一方独有的表也必须进入合并**（pull_overwrite 下本地独有表 → 全表行落入 deletes），否则覆盖语义不完整（实测踩坑）。

## 4. 首次绑定（本地无 base）

远端快照为空（空仓库/分支）→ 直接全量上传初始化。远端有数据 → 用户二选一：

| 模式 | 语义 | 实现 |
|---|---|---|
| `pull_overwrite` | 远端覆盖本地 | `merge(None, remote, {}, {}, remote_tombs, {}, diff_local=local)`——远端全取，本地独有行/表全删 |
| `merge_push` | 全量并集 + LWW | `merge({}, remote, local, {}, remote_tombs, local_tombs)`——双边全为新（base 空），行合并走规则 2/3/4 |

## 5. 同步流程（一次 sync）

```
1. export 本地 → local_now；读 base 快照
2. fetch 远端（GitHub：ref → recursive tree → blobs）
3. 三方合并 → merged + 报告
4. import_plan 写库（单事务；upsert 显式保留远端 updated_at，
   触发器因 new≠old 不动作——这是触发器设计的一部分，勿改）
5. recompute 派生数据（day_busy）
6. 若 merged ≠ remote：push（blobs → tree(base_tree=远端) → commit → PATCH ref, force=false）
7. merged 存为新 base；墓碑按 90 天窗口清理
```

失败语义：4-5 成功而 6 失败 → 本地已合并、下次重试（幂等）；push 遇 fast-forward 422 → 重新 fetch+merge+push 一次，再失败报告用户。

## 6. Provider 错误分类（GitHub 实现的四层陷阱，其他实现按等价语义处理）

| 状态 | 真实含义 | 处理 |
|---|---|---|
| 401 | PAT 无效/过期 | 提示重新生成 |
| 404 GET /repos | PAT 未授权该仓库（fine-grained 特性：与仓库不存在不可区分） | 辅助查询 /user/repos 列出可见仓库并指路 |
| 403 + `not accessible` | Contents 权限只读 | 指引改 Read and write |
| 403 + `x-ratelimit-remaining: 0` / 429 | 限流 | 延迟重试 |
| 409 GET ref | 空仓库（无任何 commit） | 视为「远端无同步状态」→ 初始化路径 |
| 409 POST blobs（空仓库时） | 同上：Git Data API 在零 commit 仓库不可用 | 先 Contents API PUT 占位文件制造首 commit（bootstrap），再走正常 push |
| 422 PATCH ref | 并发写（fast-forward 失败） | 重试一轮 |

连接测试（test）必须包含**写探针**（POST 孤儿 blob）：只读 PAT 下「读全通、写全 403」，不探写会给出误导性的「连通正常」。

## 7. schema_version 演进

- manifest.schema_version 不匹配本地支持的版本 → **拒绝同步**并提示升级客户端（防旧客户端破坏新格式）
- 快照格式向后兼容演进时递增；破坏性演进（如时间戳迁移 UTC）→ 先全端升级空窗协议（详细流程届时补充）
- 未来 iOS/Android（PWA/Capacitor/Tauri）实现的 TS/Rust 版本必须实现同一 schema_version 集

## 8. 兼容性认证

新实现 = 同一语言的 golden vectors（`tests/golden/merge_vectors.json`）**全绿** + Walking Skeleton（真实 GitHub 仓双向 round-trip，见 PLAN_PWA.md §4）通过。vectors 由 Python 参考实现生成（`tests/gen_golden.py`，幂等可重跑），覆盖：

- 行合并全部分支（含 absent 组合、平局、双边新增同 key 不同内容）
- 墓碑并集 / 删除胜 / 复活 / 相等边界
- 首次绑定两模式（含本地独有表）
- 规范序列化稳定性（同数据两次导出字节一致）
