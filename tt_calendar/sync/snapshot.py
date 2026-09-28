"""db ↔ 快照（纯 dict，可 JSON 序列化）。

快照形态：
    data:  {table: [row, ...]}        行 dict 含全部列（自增表去掉本地 id）
    tombstones: {(table, key): deleted_at}
导出/导入都不触碰 day_busy（派生数据，engine 在导入后重算）。
"""

import sqlite3
from datetime import datetime
from .schema import SYNC_TABLES, LOCAL_ONLY_META_PREFIX

Upsert = dict[str, list[dict]]      # {table: rows}
Deletes = dict[str, list[str]]      # {table: [row_key]}
Tombstones = dict[tuple[str, str], str]


# events 表只同步手工事件；countdown/jisilu 源是派生缓存，各设备自行重建
_TABLE_WHERE = {"events": "WHERE source = 'manual'"}

# 自然唯一键与同步行身份不一致的表：导入时需先按自然键归一。
# marks 的行身份是本地生成的 sync_uid，但表上有 UNIQUE(layer_id, date)——
# 两端各自给同一 (层, 日期) 打卡会产出两个不同 sync_uid 的行，远端那行直接
# INSERT 会撞自然唯一索引报 IntegrityError，整笔同步回滚（表现为"关闭前同步
# 失败"每次必现）。import_plan 对这些表先按自然键归一，规则见 _local_wins。
NATURAL_KEYS: dict[str, tuple[str, ...]] = {"marks": ("layer_id", "date")}


def _now() -> str:
    """本地时间戳，口径与触发器/触发器写入的 updated_at 一致（供墓碑用）。"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _ts_ord(value: object) -> float | None:
    """时间戳 → 可比较的 UTC 秒序；无法解析返回 None（视为最旧）。

    两端时间戳格式不同（老端 'YYYY-MM-DD HH:MM:SS' 本地时间，Neo 端
    ISO 带 +08:00 偏移），必须解析成时刻再比，不能直接比字符串。
    """
    if value in (None, ""):
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.astimezone()  # 裸时间戳按本机时区解释（老端写入口径）
    return dt.timestamp()


def _local_wins(local_updated_at: object, local_key: object,
                remote_row: dict, key: str) -> bool:
    """自然键撞车时的 LWW 裁决，两端结果必须一致。

    updated_at 新者胜；完全相等时按行身份字典序大者胜——若按"本地优先"
    裁决，两端会各自保留自己那行、永久分歧。
    """
    lo = _ts_ord(local_updated_at)
    ro = _ts_ord(remote_row.get("updated_at"))
    if lo is None:
        return False
    if ro is None:
        return True
    if lo != ro:
        return lo > ro
    return str(local_key or "") >= str(remote_row.get(key) or "")


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

    NATURAL_KEYS 里的表额外做自然键归一（见模块常量注释）：两端各自给同一
    逻辑行生成了不同行身份时，按 LWW 让胜者占用该自然键，并给输家补墓碑，
    避免撞 UNIQUE 索引把整笔同步打回。
    """
    with conn:
        cur = conn.cursor()
        for table, (pk, key, auto) in SYNC_TABLES.items():
            conflict = key if auto else pk
            local_cols = {r[1] for r in cur.execute(f"PRAGMA table_info({table})").fetchall()}
            nat = NATURAL_KEYS.get(table)
            for row in upsert.get(table, []):
                k = row.get(key)
                if not k:
                    continue
                # 自增表 export 时已 pop 掉本地 id（导入时让本地重新自增分配）；
                # TEXT 主键表（todo/todo_list 等）的 id 就是主键，必须保留。
                # 再按本地表结构过滤：远端 Neo 端如未来再加新列，老端从「同步崩溃」降级为「静默忽略」。
                cols = [c for c in row.keys() if not (auto and c == "id") and c in local_cols]
                if not cols:
                    continue
                if nat and all(c in row for c in nat):
                    twin = cur.execute(
                        f"SELECT id, {key} AS _k, updated_at FROM {table} WHERE "
                        + " AND ".join(f"{c}=?" for c in nat),
                        [row[c] for c in nat],
                    ).fetchone()
                    if twin is not None and twin["_k"] != k:
                        if _local_wins(twin["updated_at"], twin["_k"], row, key):
                            # 本端更新：跳过远端行，并给输家留墓碑，另一端据此收敛
                            tombstones[(table, k)] = _now()
                        else:
                            # 远端更新：本地行原地改认远端身份（UPDATE 而非
                            # DELETE+INSERT，不产生墓碑），旧身份同样留墓碑
                            assign = ", ".join(f"{c} = ?" for c in cols)
                            cur.execute(
                                f"UPDATE {table} SET {assign} WHERE id = ?",
                                [row[c] for c in cols] + [twin["id"]],
                            )
                            tombstones[(table, twin["_k"])] = _now()
                        continue
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
