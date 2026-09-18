"""Neo 端 todo.alarm_at 兼容改造验证（见 docs/HANDOFF-alarm-at-compat.md）。

覆盖验收 1/2/3/5：
1. 老库（无 alarm_at 列的存量库）启动 → ensure_sync_schema 补列成功，无报错；新库建表即含该列。
2. 远端同步（带 alarm_at 的 todo 行）→ 写入本地列，值正确。
3. 老端改「Neo 端设了闹钟」的待办（标题）→ alarm_at 仍是原值（不因老端编辑而清空）。
5. 远端快照里出现老端不认识的假想列 → 同步不崩，该列被忽略（3.4 加固）。
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar import db  # noqa: E402
from tt_calendar.sync.schema import ensure_sync_schema  # noqa: E402
from tt_calendar.sync import snapshot as S  # noqa: E402


def _mem_db(schema: str = "fresh") -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row
    if schema == "fresh":
        db.init_db(conn)
    elif schema == "legacy":
        # 模拟 2026-09-18 之前的老库：init_db 建好 10 张同步表后，
        # 重写 todo 表为「不含 alarm_at」的旧 schema（保留已有行）。
        db.init_db(conn)
        conn.executescript("""
        ALTER TABLE todo RENAME TO todo_legacy;
        CREATE TABLE todo (
            id             TEXT PRIMARY KEY,
            list_id        TEXT NOT NULL REFERENCES todo_list(id) ON DELETE CASCADE,
            title          TEXT NOT NULL,
            body           TEXT,
            status         TEXT DEFAULT 'notStarted',
            importance     TEXT DEFAULT 'normal',
            due_date       TEXT,
            planned_date   TEXT,
            start_date     TEXT,
            complexity     TEXT DEFAULT 'medium',
            tags           TEXT,
            created_at     TEXT DEFAULT (datetime('now','localtime')),
            completed_at   TEXT,
            sort_order     INTEGER DEFAULT 0
        );
        INSERT INTO todo
            (id, list_id, title, body, status, importance, due_date, planned_date,
             start_date, complexity, tags, created_at, completed_at, sort_order)
        SELECT id, list_id, title, body, status, importance, due_date, planned_date,
               start_date, complexity, tags, created_at, completed_at, sort_order
          FROM todo_legacy;
        DROP TABLE todo_legacy;
        """)
    ensure_sync_schema(conn)
    return conn


# 1. 补列 / 幂等 -------------------------------------------------------------


def test_new_db_has_alarm_at_column() -> None:
    """新库路径：db.init_db 即含 alarm_at。"""
    conn = _mem_db("fresh")
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(todo)").fetchall()}
    assert "alarm_at" in cols


def test_legacy_db_gets_alarm_at_added() -> None:
    """老库路径：ensure_sync_schema 幂等补列，不报错。"""
    conn = _mem_db("legacy")
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(todo)").fetchall()}
    assert "alarm_at" in cols


def test_ensure_sync_schema_is_idempotent() -> None:
    """ensure_sync_schema 多次运行结果一致，不抛错。"""
    conn = _mem_db("legacy")
    ensure_sync_schema(conn)
    ensure_sync_schema(conn)
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(todo)").fetchall()}
    assert "alarm_at" in cols


# 2. 透传导入 ---------------------------------------------------------------


def test_import_writes_alarm_at_through() -> None:
    """远端 todo 行带 alarm_at → 写入本地列，值原样保留。"""
    conn = _mem_db("fresh")
    conn.execute(
        "INSERT INTO todo_list(id, display_name) VALUES('L1','默认')"
    )
    conn.commit()
    S.import_plan(conn, {
        "todo_list": [{
            "id": "L1", "display_name": "默认", "sort_order": 0,
            "created_at": "2026-01-01 00:00:00",
            "updated_at": "2026-01-01 00:00:00",
        }],
        "todo": [{
            "id": "t1", "list_id": "L1", "title": "buy milk",
            "status": "notStarted", "importance": "normal", "complexity": "medium",
            "alarm_at": "2026-09-20T08:30",
            "created_at": "2026-01-01 00:00:00",
            "updated_at": "2026-01-01 00:00:00",
        }],
    }, {}, {})
    row = conn.execute("SELECT alarm_at FROM todo WHERE id='t1'").fetchone()
    assert row["alarm_at"] == "2026-09-20T08:30"


def test_export_includes_alarm_at_column() -> None:
    """导出快照 SELECT * 自动包含 alarm_at（行有值或 null 都进快照）。"""
    conn = _mem_db("fresh")
    conn.execute(
        "INSERT INTO todo_list(id, display_name) VALUES('L1','默认')"
    )
    conn.execute(
        "INSERT INTO todo(id, list_id, title, alarm_at) "
        "VALUES('t1','L1','hello','2026-09-20T08:30')"
    )
    conn.commit()
    snap = S.export_data(conn)
    rows = snap["todo"]
    assert len(rows) == 1
    assert "alarm_at" in rows[0]
    assert rows[0]["alarm_at"] == "2026-09-20T08:30"


# 3. 应用层 upsert 不污染 alarm_at -----------------------------------------


def test_upsert_todo_preserves_remote_alarm_at() -> None:
    """upsert_todo 不在 INSERT 列清单中（也不在 ON CONFLICT UPDATE SET 列表里），
    老端改一条 Neo 端设过闹钟的待办 → alarm_at 原值保留。
    """
    from tt_calendar.models import Todo

    conn = _mem_db("fresh")
    conn.execute(
        "INSERT INTO todo_list(id, display_name) VALUES('L1','默认')"
    )
    conn.commit()
    # 远端先推一条带闹钟的待办
    S.import_plan(conn, {
        "todo_list": [{
            "id": "L1", "display_name": "默认",
            "created_at": "2026-01-01 00:00:00",
            "updated_at": "2026-01-01 00:00:00",
        }],
        "todo": [{
            "id": "t1", "list_id": "L1", "title": "old title",
            "alarm_at": "2026-09-20T08:30",
            "created_at": "2026-01-01 00:00:00",
            "updated_at": "2026-01-01 00:00:00",
        }],
    }, {}, {})
    # 老端本地编辑这条待办（改标题）—— 走 upsert_todo，不含 alarm_at
    edited = Todo(
        id="t1", list_id="L1", title="new title",
        status="notStarted", importance="normal", complexity="medium",
    )
    db.upsert_todo(conn, edited)
    conn.commit()
    row = conn.execute(
        "SELECT title, alarm_at FROM todo WHERE id='t1'"
    ).fetchone()
    assert row["title"] == "new title"
    assert row["alarm_at"] == "2026-09-20T08:30", (
        "alarm_at 应随老端编辑而保留，不得被清空"
    )


# 5. 未知列静默忽略（3.4 加固） ---------------------------------------------


def test_import_drops_unknown_columns_silently() -> None:
    """远端 Neo 端如未来再加未知列，老端 import_plan 从「崩溃」降级为「忽略」，
    已知列照常写入。"""
    conn = _mem_db("fresh")
    conn.execute(
        "INSERT INTO todo_list(id, display_name) VALUES('L1','默认')"
    )
    conn.commit()
    # 模拟 Neo 端未来推送的两个未知列 + alarm_at + 一个未知 "nuclear_launch_code"
    S.import_plan(conn, {
        "todo_list": [{
            "id": "L1", "display_name": "默认",
            "created_at": "2026-01-01 00:00:00",
            "updated_at": "2026-01-01 00:00:00",
        }],
        "todo": [{
            "id": "t2", "list_id": "L1", "title": "spy row",
            "alarm_at": "2026-09-21T09:00",
            "future_unknown_col": "should be silently dropped",
            "nuclear_launch_code": "should also be dropped",
            "created_at": "2026-01-01 00:00:00",
            "updated_at": "2026-01-01 00:00:00",
        }],
    }, {}, {})
    row = conn.execute("SELECT title, alarm_at FROM todo WHERE id='t2'").fetchone()
    assert row["title"] == "spy row"
    assert row["alarm_at"] == "2026-09-21T09:00"
