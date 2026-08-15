"""db ↔ 快照（纯 dict，可 JSON 序列化）。

快照形态：
    data:  {table: [row, ...]}        行 dict 含全部列（自增表去掉本地 id）
    tombstones: {(table, key): deleted_at}
导出/导入都不触碰 day_busy（派生数据，engine 在导入后重算）。
"""

import sqlite3
from .schema import SYNC_TABLES, LOCAL_ONLY_META_PREFIX

Upsert = dict[str, list[dict]]      # {table: rows}
Deletes = dict[str, list[str]]      # {table: [row_key]}
Tombstones = dict[tuple[str, str], str]


# events 表只同步手工事件；countdown/jisilu 源是派生缓存，各设备自行重建
_TABLE_WHERE = {"events": "WHERE source = 'manual'"}


def export_data(conn: sqlite3.Connection) -> Upsert:
    out: Upsert = {}
    for table, (_pk, _key, auto) in SYNC_TABLES.items():
        where = _TABLE_WHERE.get(table, "")
        rows = []
        for r in conn.execute(f"SELECT * FROM {table} {where}"):
            d = dict(r)
            if auto:
                d.pop("id", None)
            if table == "meta" and d.get("key", "").startswith(LOCAL_ONLY_META_PREFIX):
                continue
            rows.append(d)
        out[table] = rows
    return out


def export_tombstones(conn: sqlite3.Connection) -> Tombstones:
    out: Tombstones = {}
    for table, key, deleted_at in conn.execute(
            "SELECT table_name, row_key, deleted_at FROM sync_tombstones"):
        out[(table, key)] = deleted_at
    return out


def import_plan(conn: sqlite3.Connection, upsert: Upsert,
                deletes: Deletes, tombstones: Tombstones) -> None:
    """把合并结果写回 db（单事务）。

    - upsert：新行 INSERT（不带本地 id，自增分配）；已有行 UPDATE（显式保留
      远端 updated_at，touch 触发器因 new!=old 不动作）
    - deletes：按行身份删行（墓碑触发器照常记录，无碍）
    - tombstones：合并后的墓碑全量 upsert（远端清理过的靠 90 天窗口自然收敛）
    """
    with conn:
        cur = conn.cursor()
        for table, (pk, key, auto) in SYNC_TABLES.items():
            conflict = key if auto else pk
            for row in upsert.get(table, []):
                k = row.get(key)
                if not k:
                    continue
                # 自增表 export 时已 pop 掉本地 id（导入时让本地重新自增分配）；
                # TEXT 主键表（todo/todo_list 等）的 id 就是主键，必须保留。
                cols = [c for c in row.keys() if not (auto and c == "id")]
                placeholders = ", ".join("?" * len(cols))
                sets = ", ".join(f"{c} = excluded.{c}" for c in cols)
                cur.execute(
                    f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
                    f"ON CONFLICT({conflict}) DO UPDATE SET {sets}",
                    [row[c] for c in cols])
            for k in deletes.get(table, []):
                cur.execute(f"DELETE FROM {table} WHERE {key} = ?", (k,))
        for (table, k), deleted_at in tombstones.items():
            cur.execute(
                "INSERT OR REPLACE INTO sync_tombstones(table_name, row_key, deleted_at) "
                "VALUES(?, ?, ?)", (table, k, deleted_at))


def prune_tombstones(conn: sqlite3.Connection, keep_days: int = 90) -> int:
    """清掉两边都已同步过且超过保留期的墓碑（合并上传成功后由 engine 调用）。"""
    with conn:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM sync_tombstones WHERE deleted_at < "
            "datetime('now', 'localtime', ?)", (f'-{keep_days} days',))
        return cur.rowcount
