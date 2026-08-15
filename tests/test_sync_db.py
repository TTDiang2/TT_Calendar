"""sync 层 db 集成验证（内存库，不碰真实数据）。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tt_calendar import db
from tt_calendar.sync.schema import ensure_sync_schema, SYNC_TABLES
from tt_calendar.sync import snapshot as S

conn = db.connect_memory() if hasattr(db, "connect_memory") else None
import sqlite3
conn = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES)
conn.row_factory = sqlite3.Row
db.init_db(conn)
ensure_sync_schema(conn)
ensure_sync_schema(conn)  # 幂等

# 1. todo INSERT → updated_at 自动补
conn.execute("INSERT INTO todo(id, list_id, title) VALUES('t1','L1','hello')")
r = conn.execute("SELECT updated_at FROM todo WHERE id='t1'").fetchone()
assert r["updated_at"], "INSERT 应自动补 updated_at"
print("1. insert fills updated_at: OK")

# 2. UPDATE 不带时间戳 → touch 刷新
conn.execute("UPDATE todo SET updated_at='2020-01-01 00:00:00' WHERE id='t1'")
conn.execute("UPDATE todo SET title='world' WHERE id='t1'")
r2 = conn.execute("SELECT title, updated_at FROM todo WHERE id='t1'").fetchone()
assert r2["title"] == "world" and r2["updated_at"] != "2020-01-01 00:00:00", "touch 触发器应刷新"
print("2. touch trigger refreshes: OK")

# 3. UPDATE 显式带 updated_at（merge import 路径）→ 不刷新
same = r2["updated_at"]
conn.execute("UPDATE todo SET title='from-remote' , updated_at=? WHERE id='t1'", ("2020-01-01 00:00:00",))
r3 = conn.execute("SELECT updated_at FROM todo WHERE id='t1'").fetchone()
assert r3["updated_at"] == "2020-01-01 00:00:00", f"显式时间戳不应被刷新，得到 {r3['updated_at']}"
print("3. explicit updated_at preserved (merge path): OK")

# 4. events INSERT → sync_uid 自动补
conn.execute("INSERT INTO events(layer_id, source, date, title) VALUES('custom_x','manual','2026-08-15','ev1')")
r4 = conn.execute("SELECT sync_uid, updated_at FROM events LIMIT 1").fetchone()
assert r4["sync_uid"] and r4["updated_at"], "events 应补 sync_uid + updated_at"
print(f"4. events sync_uid auto: {r4['sync_uid'][:8]}... OK")

# 5. DELETE todo → 墓碑
conn.execute("DELETE FROM todo WHERE id='t1'")
tomb = conn.execute("SELECT * FROM sync_tombstones WHERE table_name='todo'").fetchall()
assert len(tomb) == 1 and tomb[0]["row_key"] == "t1", f"墓碑记录错误: {[dict(x) for x in tomb]}"
print("5. delete writes tombstone: OK")

# 6. meta sync.% 键删除 → 不产生墓碑
conn.execute("INSERT INTO meta(key,value) VALUES('sync.github_token','x')")
conn.execute("DELETE FROM meta WHERE key='sync.github_token'")
n = conn.execute("SELECT COUNT(*) c FROM sync_tombstones WHERE table_name='meta'").fetchone()["c"]
assert n == 0, "sync.% 键删除不应产生墓碑"
print("6. sync.* meta keys excluded from tombstones: OK")

# 7. snapshot export 排除 sync.% meta；import 往返
conn.execute("INSERT INTO meta(key,value) VALUES('todo_busy_config','{}')")
conn.execute("INSERT INTO meta(key,value) VALUES('sync.config_json','secret')")
snap = S.export_data(conn)
meta_keys = [r["key"] for r in snap["meta"]]
assert "todo_busy_config" in meta_keys and "sync.config_json" not in meta_keys
assert all("id" not in r for r in snap["events"]), "events 导出不应含本地 id"
print("7. export excludes sync.* + local ids: OK")

conn2 = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES)
conn2.row_factory = sqlite3.Row
db.init_db(conn2)
ensure_sync_schema(conn2)
S.import_plan(conn2, snap, {}, {})
snap2 = S.export_data(conn2)
assert snap == snap2, "往返不一致"
print("8. export→import→export roundtrip identical: OK")

# 9. 导入的行保留远端 updated_at（不被触发器污染）
row = conn2.execute("SELECT updated_at FROM todo WHERE id='t1'").fetchone()
print("9. (t1 was deleted before export, skip)")

# 10. import 的 upsert 幂等（重复导入不产生墓碑、行数不变）
S.import_plan(conn2, snap, {}, {})
S.import_plan(conn2, snap, {}, {})
n_tomb = conn2.execute("SELECT COUNT(*) c FROM sync_tombstones").fetchone()["c"]
snap3 = S.export_data(conn2)
assert snap2 == snap3 and n_tomb == 0, "重复导入应幂等且零墓碑"
print("10. re-import idempotent, zero tombstones: OK")

# 11. 外键依赖导入顺序：todo.list_id → todo_list.id，且 TEXT 主键表必须保留 id
#     （第二台 pull_overwrite 曾因 import 顺序违反外键 + 误删主键 id 而 500）
conn3 = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES)
conn3.row_factory = sqlite3.Row
conn3.execute("PRAGMA foreign_keys=ON;")
db.init_db(conn3)
ensure_sync_schema(conn3)
fk_upsert = {
    "todo_list": [{"id": "L1", "display_name": "默认", "sort_order": 0,
                   "created_at": "2026-01-01 00:00:00", "updated_at": "2026-01-01 00:00:00"}],
    "todo": [{"id": "t1", "list_id": "L1", "title": "hello", "status": "notStarted",
              "importance": "normal", "complexity": "medium",
              "created_at": "2026-01-01 00:00:00", "updated_at": "2026-01-01 00:00:00"}],
}
for t in SYNC_TABLES:
    fk_upsert.setdefault(t, [])
S.import_plan(conn3, fk_upsert, {}, {})
row = conn3.execute("SELECT list_id FROM todo WHERE id='t1'").fetchone()
assert row and row["list_id"] == "L1", "todo 主键 id 丢失或外键未关联"
print("11. FK order + TEXT pk id preserved: OK")

print("\nALL DB INTEGRATION CHECKS PASSED")