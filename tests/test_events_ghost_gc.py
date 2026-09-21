"""幽灵事件清理测试：delete_events_missing_refs 只删该删的。

背景：外部订阅源改排期后，旧占位 occurrence（API 已不再返回）会永远滞留本地，
渲染成"待公布"幽灵卡片（2026-09 LPR 9/21 占位行实例）。完整抓取后调用本函数清理。
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar import db  # noqa: E402
from tt_calendar.models import Event  # noqa: E402


def _ev(ref: str, d: str, source: str = "investing") -> Event:
    return Event(
        layer_id="investing_37", source=source, date=date.fromisoformat(d),
        title=f"ev-{ref}", source_ref=ref,
    )


def _mem_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    return conn


def test_gc_deletes_only_missing_refs_in_window() -> None:
    conn = _mem_db()
    # 窗口内：A 被 API 继续返回，B 是幽灵；窗口外：C 幽灵但不在本次窗口；
    # manual 事件永不触碰
    db.upsert_event(conn, _ev("37:1", "2026-09-20"))
    db.upsert_event(conn, _ev("37:2", "2026-09-21"))
    db.upsert_event(conn, _ev("37:3", "2026-09-25"))
    db.upsert_event(conn, _ev("manual-x", "2026-09-20", source="manual"))
    conn.commit()

    removed = db.delete_events_missing_refs(
        conn, "investing", date(2026, 9, 19), date(2026, 9, 22), {"37:1"}
    )
    conn.commit()
    assert removed == 1
    refs = {r["source_ref"] for r in conn.execute(
        "SELECT source_ref FROM events WHERE source='investing'")}
    assert refs == {"37:1", "37:3"}, f"窗口外应保留: {refs}"
    manual = conn.execute("SELECT COUNT(*) c FROM events WHERE source='manual'").fetchone()["c"]
    assert manual == 1


def test_gc_noop_when_nothing_missing() -> None:
    conn = _mem_db()
    db.upsert_event(conn, _ev("37:1", "2026-09-20"))
    conn.commit()
    removed = db.delete_events_missing_refs(
        conn, "investing", date(2026, 9, 19), date(2026, 9, 22), {"37:1"}
    )
    assert removed == 0
    n = conn.execute("SELECT COUNT(*) c FROM events").fetchone()["c"]
    assert n == 1


def test_gc_null_source_ref_rows_never_deleted() -> None:
    """source_ref 为空的行（手工迁移等）不在清理范围。"""
    conn = _mem_db()
    db.upsert_event(conn, Event(
        layer_id="custom_x", source="investing", date=date(2026, 9, 20),
        title="no-ref", source_ref=None,
    ))
    conn.commit()
    removed = db.delete_events_missing_refs(
        conn, "investing", date(2026, 9, 19), date(2026, 9, 22), {"37:1"}
    )
    assert removed == 0
    n = conn.execute("SELECT COUNT(*) c FROM events").fetchone()["c"]
    assert n == 1
