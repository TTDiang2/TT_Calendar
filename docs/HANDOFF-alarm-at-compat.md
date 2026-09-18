# 【交接】Neo 端新增 todo.alarm_at 列 —— 老端同步兼容改造

> 写给：负责 TT_Calendar（Python 老端）的 agent。
> 来源：TT_Calendar_Neo 端 2026-09-18 任务书 1.3-5「待办闹钟」，Neo 侧已上线（commit `10d3006`，实现见其 `packages/db/src/migrate.ts` / `packages/contracts/src/todo.ts`）。
> 结论先行：**改造量 = 给 todo 表补一个可空列 + （强烈建议）导入侧过滤未知列**，不动任何业务代码，不加任何闹钟功能。

---

## 1. 背景

两端通过 GitHub 私有数据仓互通 11 张表（老端 `tt_calendar/sync/*`，Neo 端 `packages/db/src/*`，协议一致：整表快照 + 行级三方合并 + 墓碑，Neo 另兼容读写老版每表一文件布局并 dualWrite）。

Neo 端给 todo 表新增了一列：

```sql
alarm_at TEXT   -- 可空；闹钟时刻，格式 'YYYY-MM-DDTHH:mm'（本地时间），NULL = 未设
```

老端**不需要**做任何闹钟功能，只需保证这一列在同步链路上被「透明搬运」。

## 2. 为什么必须改、不改会怎样（紧急度）

- Neo 端本地库在**下一次启动时**会自动 `ALTER TABLE todo ADD COLUMN alarm_at TEXT`（幂等，参考其 `migrate.ts` 的 ENSURE_COLUMNS）。
- 此后**任何一端 Neo（桌面/手机）做一次同步**，共享数据仓里的 todo 快照行（含 dualWrite 写出的老版每表一文件）就会带上 `alarm_at` 键——**即使值全是 null**。
- 老端下一次点同步时，`tt_calendar/sync/snapshot.py` 的 `import_plan()`（66-72 行附近）按行键动态拼列：

  ```python
  cols = [c for c in row.keys() if not (auto and c == "id")]
  ... f"INSERT INTO {table} ({', '.join(cols)}) ..."
  ```

  遇到本地不存在的 `alarm_at` 列 → `sqlite3.OperationalError: table todo has no column named alarm_at` → **老端同步直接崩**。
- 时间线要求：**老端补丁要在「Neo 端下一次同步」之前上线**。Neo 端一同步，仓里就有了带 alarm_at 的行；在那之前老端暂时别点「同步」（本地读写不受影响）。

## 3. 改造清单（推荐方案：加列透传）

### 3.1 必做 A —— 建表基线加列（新库路径）

`tt_calendar/db.py` 的 `CREATE TABLE IF NOT EXISTS todo (...)`（约 102 行）加一列：

```sql
    alarm_at       TEXT,
```

位置随意（建议放在 `planned_date` 之后）；不加索引、不加默认值、不加约束。

### 3.2 必做 B —— 存量库幂等补列（老库路径）

`tt_calendar/sync/schema.py` 的 `ensure_sync_schema()`（93 行起）里，已经有对每张同步表 `PRAGMA table_info` + 幂等 `ALTER` 的现成模式（sync_uid / updated_at 就是这么补的）。在同一循环里照抄即可：

```python
# Neo 端新增列的透传位：老端无闹钟功能，此列仅随同步收发，不参与任何业务逻辑
EXTRA_PASSTHROUGH_COLUMNS = {"todo": ["alarm_at"]}
...
for table, (pk, key, auto) in SYNC_TABLES.items():
    cols = {r[1] for r in cur.execute(f"PRAGMA table_info({table})").fetchall()}
    ...
    for extra in EXTRA_PASSTHROUGH_COLUMNS.get(table, []):
        if extra not in cols:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {extra} TEXT")
```

### 3.3 为什么这样就够了（不需要其它改动）

- **导出**：`snapshot.py export_data()` 用 `SELECT *`，列存在就会自动进快照——老库补列后，老端推的行自动带 `alarm_at`（原值或 null）。
- **导入**：`import_plan()` 动态列 UPSERT，远端行带 `alarm_at` 时正好写进这个新列，不再崩。
- **应用层 UPDATE**：老端自己的待办更新语句是显式列清单（不含 alarm_at），UPDATE 不会清掉未列出的列 → 老端改待办标题/状态后，行里存的闹钟值原样保留，随下次导出推回 Neo，**闹钟不丢**。
- **合并/触发器**：`merge.py` 是整行 dict 比对 + updated_at LWW，`schema.py` 触发器按表名生成，全部列无关，零改动。
- **老端业务**：该列永远保持 NULL 或透传值，不读不写不展示。

### 3.4 强烈建议的加固 —— 导入侧忽略未知列（防重演）

这次的地雷本质是「远端加了新列，老端导入即崩」。建议顺手把 `import_plan()` 的列收集改成按本地表结构过滤：

```python
local_cols = {r[1] for r in cur.execute(f"PRAGMA table_info({table})").fetchall()}
cols = [c for c in row.keys()
        if not (auto and c == "id") and c in local_cols]
```

效果：远端再有本端不认识的列，从「同步崩溃」降级为「静默忽略」。两行改动，一劳永逸。

## 4. 验收标准（逐条可测）

1. 老库（无 alarm_at 列的存量库）启动 → `ensure_sync_schema` 补列成功，无报错；新库建表即含该列。
2. 用 Neo 端（已带 alarm_at 的数据仓）做一次老端同步 → 同步成功，todo 行的 alarm_at 值正确落到本地列。
3. 老端修改一条「Neo 端设了闹钟」的待办（如改标题）→ 同步推送 → Neo 端拉取后该待办的 alarm_at **仍是原值**（不因老端编辑而清空）。
4. 老端自己新建/编辑/删除待办 → 一切如常，alarm_at 保持 NULL 或原值，UI 无任何变化。
5. 远端快照里出现一个老端不认识的假想列（可手改仓库文件造测试）→ 同步不崩，该列被忽略（对应 3.4 加固）。

## 5. 禁改清单

- 不要给 alarm_at 加任何业务逻辑、UI、提醒（老端明确不做闹钟功能）。
- 不要动 `merge.py`、`schema.py` 的触发器定义、SYNC_TABLES 的表清单与行身份定义。
- 不要改快照格式/布局（老版每表一文件 + Neo 新格式并存的现状保持）。
- 不要「顺手」重构 import/export——只做 3.1 / 3.2 / 3.4。

## 6. 参考

- Neo 侧实现：TT_Calendar_Neo 仓库 commit `10d3006`（`packages/db/src/migrate.ts` 的 ENSURE_COLUMNS 幂等 ALTER 模式、`packages/db/src/sync-service.ts` 的收发映射）；返工 `d724a42`。
- 数据仓现状：两端最后一次成功同步 2026-09-02；老端 meta 里有 `sync.config_json` 在线同步配置（repo: TTDiang2/tt-calendar-data）。
