"""move_day_content 的改期语义回归（原脚本的模块级断言转正）。

改期是用户会反复用、且出错即丢数据的操作：它必须只搬手动事件，绝不能把外部
数据源（集思录、节假日等可重新抓取/重算的数据）一起搬走——那些数据在源日被
移走等于凭空丢失。原脚本把断言写在模块级，靠 pytest 收集时的 import 副作用
执行，失败只会报成 collection error。
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar import db  # noqa: E402

SRC = date(2026, 8, 10)
DST = date(2026, 8, 12)


@pytest.fixture
def conn() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    db.init_db(c)
    yield c
    c.close()


@pytest.fixture
def seeded(conn: sqlite3.Connection) -> sqlite3.Connection:
    """源日含手动事件 + 外部数据 + 日程；目标日已有部分日程。"""
    for title in ("手动事件A", "手动事件B"):
        db.upsert_event(conn, db.Event(
            layer_id="important", source="manual", date=SRC, title=title))
    db.upsert_event(conn, db.Event(
        layer_id="jisilu_CNV", source="jisilu", date=SRC, title="集思录事件", source_ref="j1"))
    db.upsert_event(conn, db.Event(
        layer_id="holiday", source="chinese_calendar", date=SRC, title="节假日"))
    db.upsert_schedule(conn, db.ScheduleEntry(date=SRC, am="开会", pm="健身", ev=None))
    db.upsert_schedule(conn, db.ScheduleEntry(date=DST, am=None, pm="已有pm", ev="已有ev"))
    return conn


def _titles(conn: sqlite3.Connection, d: date) -> set[str]:
    return {e.title for e in db.fetch_events_for_dates(conn, [d])[d]}


def test_move_carries_only_manual_events(seeded: sqlite3.Connection) -> None:
    moved_events, moved_schedule = db.move_day_content(seeded, SRC, DST)
    assert moved_events == 2, f"应只搬 2 个手动事件，实际 {moved_events}"
    assert moved_schedule is True


def test_move_leaves_external_data_on_source_day(seeded: sqlite3.Connection) -> None:
    """外部数据留在源日：它们可重新抓取，被搬走反而在源日造成凭空丢失。"""
    db.move_day_content(seeded, SRC, DST)
    assert _titles(seeded, SRC) == {"集思录事件", "节假日"}, \
        f"外部数据不应被移动：{_titles(seeded, SRC)}"


def test_move_clears_schedule_from_source_day(seeded: sqlite3.Connection) -> None:
    db.move_day_content(seeded, SRC, DST)
    assert seeded.execute(
        "SELECT * FROM schedule WHERE date=?", (SRC.isoformat(),)
    ).fetchone() is None


def test_moved_events_land_on_destination_day(seeded: sqlite3.Connection) -> None:
    db.move_day_content(seeded, SRC, DST)
    assert _titles(seeded, DST) == {"手动事件A", "手动事件B"}


def test_schedule_merges_with_destination_winning(seeded: sqlite3.Connection) -> None:
    """三格日程合并：目标日已有的格子保留，源日只补目标日空缺的格子。"""
    db.move_day_content(seeded, SRC, DST)
    row = seeded.execute(
        "SELECT * FROM schedule WHERE date=?", (DST.isoformat(),)
    ).fetchone()
    assert row is not None
    assert row["am"] == "开会", "目标日空缺的 am 应由源日补上"
    assert row["pm"] == "已有pm", "目标日已有的 pm 不应被源日覆盖"
    assert row["ev"] == "已有ev", "目标日已有的 ev 不应被源日覆盖"


def test_move_to_same_day_is_noop(seeded: sqlite3.Connection) -> None:
    moved_events, moved_schedule = db.move_day_content(seeded, DST, DST)
    assert moved_events == 0
    assert moved_schedule is False


def test_move_from_empty_day_is_noop(conn: sqlite3.Connection) -> None:
    moved_events, moved_schedule = db.move_day_content(
        conn, date(2026, 8, 1), date(2026, 8, 2))
    assert moved_events == 0
    assert moved_schedule is False
