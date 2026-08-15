"""同步层 schema：行身份（sync_uid）、时间戳、墓碑、触发器。

由 deps.connect_db 启动时调用 ensure_sync_schema（幂等）。
触发器设计要点：
- AFTER UPDATE touch 触发器带 WHEN NEW.updated_at = OLD.updated_at 条件：
  应用层 UPDATE（不动时间戳）→ 自动刷新；同步 import（显式写远端时间戳）→ 不动作，
  避免"被动接受远端行"被误标为本地主动修改。
- 本连接未开启 recursive_triggers（SQLite 默认 OFF），触发器内层 UPDATE 不会级联触发。
- INSERT OR REPLACE 会走 DELETE+INSERT（误触发墓碑），同步 import 一律用
  ON CONFLICT DO UPDATE；应用层的 REPLACE 产生的瞬时墓碑无害（行重插后 updated_at
  更新，行胜墓碑）。
"""

import sqlite3

AUTO_INT_TABLES = ("events", "schedule_items", "countdown", "marks")

# 同步的 10 张用户表：表名 -> (主键列, 行身份列, 是否自增整型主键)
SYNC_TABLES: dict[str, tuple[str, str, bool]] = {
    "todo":           ("id", "id", False),
    "todo_list":      ("id", "id", False),
    "layer_config":   ("layer_id", "layer_id", False),
    "meta":           ("key", "key", False),
    "schedule":       ("date", "date", False),
    "coloring":       ("date", "date", False),
    "events":         ("id", "sync_uid", True),
    "schedule_items": ("id", "sync_uid", True),
    "countdown":      ("id", "sync_uid", True),
    "marks":          ("id", "sync_uid", True),
}

# meta 表中同步凭据等本机私有键，永不导出、永不产生墓碑
LOCAL_ONLY_META_PREFIX = "sync."

_UUID_EXPR = (
    "lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-'||"
    "lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||"
    "lower(hex(randomblob(6)))"
)


def _triggers(table: str, pk: str, key: str, auto: bool) -> list[str]:
    out = []

    if auto:
        out.append(f"""
CREATE TRIGGER IF NOT EXISTS {table}_sync_fill AFTER INSERT ON {table}
FOR EACH ROW WHEN NEW.sync_uid IS NULL OR NEW.updated_at IS NULL
BEGIN
    UPDATE {table}
       SET sync_uid = COALESCE(NEW.sync_uid, {_UUID_EXPR}),
           updated_at = COALESCE(NEW.updated_at, datetime('now','localtime'))
     WHERE rowid = NEW.rowid;
END;""")
    else:
        out.append(f"""
CREATE TRIGGER IF NOT EXISTS {table}_sync_fill AFTER INSERT ON {table}
FOR EACH ROW WHEN NEW.updated_at IS NULL
BEGIN
    UPDATE {table}
       SET updated_at = COALESCE(NEW.updated_at, datetime('now','localtime'))
     WHERE rowid = NEW.rowid;
END;""")

    out.append(f"""
CREATE TRIGGER IF NOT EXISTS {table}_sync_touch AFTER UPDATE ON {table}
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE {table} SET updated_at = datetime('now','localtime')
   WHERE rowid = NEW.rowid;
END;""")

    # 自增表存量行可能尚未补 sync_uid，用 id 前缀兜底保证墓碑唯一
    key_expr = f"COALESCE(OLD.{key}, 'id:'||OLD.{pk})"
    guard = ""
    if table == "meta":
        guard = " WHEN OLD.key NOT LIKE 'sync.%'"
    elif table == "events":
        # countdown/jisilu 等 source 是派生缓存（启动时删旧插新），只同步手工事件
        guard = " WHEN OLD.source = 'manual'"
    out.append(f"""
CREATE TRIGGER IF NOT EXISTS {table}_sync_tomb AFTER DELETE ON {table}
FOR EACH ROW{guard} BEGIN
    INSERT OR REPLACE INTO sync_tombstones(table_name, row_key, deleted_at)
    VALUES('{table}', {key_expr}, datetime('now','localtime'));
END;""")
    return out


def ensure_sync_schema(conn: sqlite3.Connection) -> None:
    """幂等建：墓碑表 + 缺列 + 缺值回填 + 全部触发器。

    触发器一律 DROP 后重建，保证与代码当前定义一致（无版本管理负担）。
    """
    with conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sync_tombstones(
                table_name TEXT NOT NULL,
                row_key    TEXT NOT NULL,
                deleted_at TEXT NOT NULL,
                PRIMARY KEY(table_name, row_key)
            )""")
        for (name,) in cur.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger' AND "
                "(name LIKE '%\\_sync\\_fill' ESCAPE '\\' "
                "OR name LIKE '%\\_sync\\_touch' ESCAPE '\\' "
                "OR name LIKE '%\\_sync\\_tomb' ESCAPE '\\')").fetchall():
            cur.execute(f"DROP TRIGGER IF EXISTS {name}")
        for table, (pk, key, auto) in SYNC_TABLES.items():
            cols = {r[1] for r in cur.execute(f"PRAGMA table_info({table})").fetchall()}
            if auto and "sync_uid" not in cols:
                cur.execute(f"ALTER TABLE {table} ADD COLUMN sync_uid TEXT")
                # 存量行立即补 uuid，避免删除时墓碑 row_key 落空
                cur.execute(
                    f"UPDATE {table} SET sync_uid = {_UUID_EXPR} WHERE sync_uid IS NULL")
                # upsert 依赖唯一索引（ON CONFLICT(sync_uid) DO UPDATE）
                cur.execute(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_sync_uid ON {table}(sync_uid)")
            if "updated_at" not in cols:
                cur.execute(f"ALTER TABLE {table} ADD COLUMN updated_at TEXT")
                fallback = (
                    "COALESCE(created_at, datetime('now','localtime'))"
                    if "created_at" in cols else "datetime('now','localtime')"
                )
                cur.execute(
                    f"UPDATE {table} SET updated_at = {fallback} WHERE updated_at IS NULL")
            for sql in _triggers(table, pk, key, auto):
                cur.execute(sql)
