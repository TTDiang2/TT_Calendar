"""sync 层与 DB 的集成回归（原 test_sync_db.py 的脚本断言转正）。

原脚本把断言写在模块级：pytest 收集时靠 import 副作用执行，既不计入用例数，
失败也只会报成 collection error，看不出是哪一条坏了。转成正式用例后每条独立
可定位，且失败会真正拦住 CI。

覆盖的都是踩过坑的地方：touch 触发器与 merge 路径的分工、墓碑生成与排除规则、
导出不得泄漏本地 id 与 sync.* 机密、以及导入的外键顺序与 TEXT 主键保留
（第二台设备 pull_overwrite 曾因违反外键 + 误删主键 id 而整片 500）。
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar import db  # noqa: E402
from tt_calendar.sync import snapshot as S  # noqa: E402
from tt_calendar.sync.schema import SYNC_TABLES, ensure_sync_schema  # noqa: E402


def fresh_conn(*, foreign_keys: bool = False) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row
    if foreign_keys:
        conn.execute("PRAGMA foreign_keys=ON;")
    db.init_db(conn)
    ensure_sync_schema(conn)
    return conn


@pytest.fixture
def conn() -> sqlite3.Connection:
    c = fresh_conn()
    yield c
    c.close()


@pytest.fixture
def todo(conn: sqlite3.Connection) -> None:
    """一条最小 todo，供触发表与墓碑相关用例复用。"""
    conn.execute("INSERT INTO todo(id, list_id, title) VALUES('t1','L1','hello')")


# ---------------------------------------------------------------- 触发表


def test_insert_fills_updated_at(conn: sqlite3.Connection) -> None:
    # 不能用 RETURNING：它返回的是 AFTER INSERT 触发器补值之前的行
    conn.execute("INSERT INTO todo(id, list_id, title) VALUES('t1','L1','hello')")
    row = conn.execute("SELECT updated_at FROM todo WHERE id='t1'").fetchone()
    assert row["updated_at"], "INSERT 应自动补 updated_at，否则同步会漏推新行"


def test_touch_trigger_refreshes_updated_at(conn: sqlite3.Connection, todo: None) -> None:
    conn.execute("UPDATE todo SET updated_at='2020-01-01 00:00:00' WHERE id='t1'")
    conn.execute("UPDATE todo SET title='world' WHERE id='t1'")
    row = conn.execute("SELECT title, updated_at FROM todo WHERE id='t1'").fetchone()
    assert row["title"] == "world"
    assert row["updated_at"] != "2020-01-01 00:00:00", "不带时间戳的 UPDATE 应被触发器刷新"


def test_explicit_updated_at_preserved(conn: sqlite3.Connection, todo: None) -> None:
    """merge 导入路径靠显式时间戳表示「远端已是最新」，被刷新就会造成反复回拉。"""
    conn.execute(
        "UPDATE todo SET title='from-remote', updated_at='2020-01-01 00:00:00' WHERE id='t1'"
    )
    row = conn.execute("SELECT updated_at FROM todo WHERE id='t1'").fetchone()
    assert row["updated_at"] == "2020-01-01 00:00:00", "显式时间戳不应被触发器刷新"


def test_events_insert_fills_sync_uid(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO events(layer_id, source, date, title) "
        "VALUES('custom_x','manual','2026-08-15','ev1')"
    )
    row = conn.execute("SELECT sync_uid, updated_at FROM events LIMIT 1").fetchone()
    assert row["sync_uid"], "events 应自动补 sync_uid"
    assert row["updated_at"], "events 应自动补 updated_at"


# ---------------------------------------------------------------- 墓碑


def test_delete_writes_tombstone(conn: sqlite3.Connection, todo: None) -> None:
    conn.execute("DELETE FROM todo WHERE id='t1'")
    tombs = conn.execute(
        "SELECT * FROM sync_tombstones WHERE table_name='todo'"
    ).fetchall()
    assert len(tombs) == 1, f"删除应产生恰好一条墓碑，实际 {len(tombs)}"
    assert tombs[0]["row_key"] == "t1"


def test_sync_meta_keys_excluded_from_tombstones(conn: sqlite3.Connection) -> None:
    """sync.* 存的是 PAT 等机密，删除时既不该产生墓碑，也不该同步出去。"""
    conn.execute("INSERT INTO meta(key,value) VALUES('sync.github_token','x')")
    conn.execute("DELETE FROM meta WHERE key='sync.github_token'")
    n = conn.execute(
        "SELECT COUNT(*) c FROM sync_tombstones WHERE table_name='meta'"
    ).fetchone()["c"]
    assert n == 0, "sync.* 键删除不应产生墓碑"


# ---------------------------------------------------------------- 导出/导入


def test_export_excludes_sync_meta_and_local_ids(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT INTO meta(key,value) VALUES('todo_busy_config','{}')")
    conn.execute("INSERT INTO meta(key,value) VALUES('sync.config_json','secret')")
    conn.execute(
        "INSERT INTO events(layer_id, source, date, title) "
        "VALUES('custom_x','manual','2026-08-15','ev1')"
    )

    snap = S.export_data(conn)

    meta_keys = [r["key"] for r in snap["meta"]]
    assert "todo_busy_config" in meta_keys
    assert "sync.config_json" not in meta_keys, "sync.* 机密不得进入导出快照"
    assert all("id" not in r for r in snap["events"]), \
        "events 导出不应含本地 id（本地主键不具备跨设备一致性）"


def test_export_import_export_roundtrip_identical() -> None:
    src = fresh_conn()
    src.execute("INSERT INTO todo(id, list_id, title) VALUES('t1','L1','hello')")
    src.execute("INSERT INTO meta(key,value) VALUES('todo_busy_config','{}')")
    src.execute(
        "INSERT INTO events(layer_id, source, date, title) "
        "VALUES('custom_x','manual','2026-08-15','ev1')"
    )
    snap = S.export_data(src)

    dst = fresh_conn()
    S.import_plan(dst, snap, {}, {})
    assert S.export_data(dst) == snap, "导出→导入→导出 往返不一致"
    src.close()
    dst.close()


def test_reimport_is_idempotent_with_zero_tombstones() -> None:
    """重复导入同一份快照必须完全幂等，否则每次同步都会往远端推墓碑。"""
    src = fresh_conn()
    src.execute("INSERT INTO todo(id, list_id, title) VALUES('t1','L1','hello')")
    snap = S.export_data(src)

    dst = fresh_conn()
    S.import_plan(dst, snap, {}, {})
    once = S.export_data(dst)
    S.import_plan(dst, snap, {}, {})
    S.import_plan(dst, snap, {}, {})

    n_tomb = dst.execute("SELECT COUNT(*) c FROM sync_tombstones").fetchone()["c"]
    assert S.export_data(dst) == once, "重复导入改变了数据"
    assert n_tomb == 0, f"重复导入产生了 {n_tomb} 条墓碑"
    src.close()
    dst.close()


def test_import_respects_fk_order_and_preserves_text_pk() -> None:
    """todo.list_id 指向 todo_list.id。导入顺序违反外键会让整次 pull_overwrite
    500；TEXT 主键的 id 若被当成本地自增键丢弃，第二台设备的数据会串位。"""
    conn = fresh_conn(foreign_keys=True)
    payload = {
        "todo_list": [{"id": "L1", "display_name": "默认", "sort_order": 0,
                       "created_at": "2026-01-01 00:00:00",
                       "updated_at": "2026-01-01 00:00:00"}],
        "todo": [{"id": "t1", "list_id": "L1", "title": "hello", "status": "notStarted",
                  "importance": "normal", "complexity": "medium",
                  "created_at": "2026-01-01 00:00:00",
                  "updated_at": "2026-01-01 00:00:00"}],
    }
    for table in SYNC_TABLES:
        payload.setdefault(table, [])

    S.import_plan(conn, payload, {}, {})

    row = conn.execute("SELECT list_id FROM todo WHERE id='t1'").fetchone()
    assert row is not None, "todo 的 TEXT 主键 id 丢失"
    assert row["list_id"] == "L1", "外键未正确关联"
    conn.close()


def test_ensure_sync_schema_is_idempotent() -> None:
    """启动路径每次都会调它，重复执行不得报错或改坏已有数据。"""
    conn = fresh_conn()
    conn.execute("INSERT INTO todo(id, list_id, title) VALUES('t1','L1','hello')")
    ensure_sync_schema(conn)
    ensure_sync_schema(conn)
    assert conn.execute("SELECT COUNT(*) c FROM todo").fetchone()["c"] == 1
    conn.close()
