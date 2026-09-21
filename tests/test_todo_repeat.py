"""待办「重复」属性测试：节奏计算 + 完成转化生成下一期。

设计决策（用户确认 2026-09-21）：
- 补卡：跳过错过的天数，落完成日之后的第一个合法日期（周重复保星期几）
- 工作日：中文日历口径（chinese_calendar，含调休/法定节假日），缺年份回退周一~周五
- 每次完成转化只生成一个下一期；已完成后再 PUT 不触发
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar import db  # noqa: E402
from tt_calendar.models import Todo  # noqa: E402
from backend.routes import _next_repeat_date, _spawn_next_repeat  # noqa: E402


# ---------------------------------------------------------------------------
# 节奏计算 _next_repeat_date
# ---------------------------------------------------------------------------


def test_daily_next_day() -> None:
    assert _next_repeat_date("daily", date(2026, 9, 25), date(2026, 9, 25)) == date(2026, 9, 26)


def test_daily_skips_missed_days() -> None:
    """9/18（周五）的每日待办拖到 9/21（周一）才点 → 下一期 9/22，不产生过期待办。"""
    assert _next_repeat_date("daily", date(2026, 9, 18), date(2026, 9, 21)) == date(2026, 9, 22)


def test_weekly_keeps_weekday_and_skips_missed_weeks() -> None:
    """周一待办：同周点掉 → 下周一；隔三周才点 → 仍是最近的下周一。"""
    assert _next_repeat_date("weekly", date(2026, 9, 14), date(2026, 9, 16)) == date(2026, 9, 21)
    assert _next_repeat_date("weekly", date(2026, 9, 7), date(2026, 9, 21)) == date(2026, 9, 28)
    # 完成日恰好是下一期当天 → 再推一周（当期已由本条待办代表）
    assert _next_repeat_date("weekly", date(2026, 9, 14), date(2026, 9, 21)) == date(2026, 9, 28)


def test_weekdays_skips_weekend() -> None:
    """周五待办 → 下一期跳过周末落在周一（9 月中旬无法定节假日，chinese_calendar 安全区）。"""
    assert _next_repeat_date("weekdays", date(2026, 9, 11), date(2026, 9, 11)) == date(2026, 9, 14)


def test_weekdays_completed_on_friday_moves_past_weekend() -> None:
    """周五的待办周五当天点掉 → 下一期是下周一（不是周六）。"""
    assert _next_repeat_date("weekdays", date(2026, 9, 25), date(2026, 9, 25)) == date(2026, 9, 28)


def test_weekdays_fallback_when_calendar_data_missing(monkeypatch) -> None:
    """chinese_calendar 缺数据（_is_workday 回退周一~周五）→ 节奏照常，不得死循环。"""
    import backend.routes as R

    monkeypatch.setattr(R, "_is_workday", lambda d: d.weekday() < 5)
    assert _next_repeat_date("weekdays", date(2026, 9, 11), date(2026, 9, 11)) == date(2026, 9, 14)


# ---------------------------------------------------------------------------
# 生成下一期 _spawn_next_repeat（内存库集成）
# ---------------------------------------------------------------------------


def _mem_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    conn.execute("INSERT INTO todo_list(id, display_name) VALUES('L1', '默认')")
    conn.commit()
    return conn


def _make_todo(**kw) -> Todo:
    base = dict(
        id="t1", list_id="L1", title="晨会",
        status="completed", importance="normal", complexity="medium",
        planned_date=date(2026, 9, 25),
        completed_at=datetime(2026, 9, 25, 10, 0, 0),
        repeat="daily",
    )
    base.update(kw)
    return Todo(**base)


def test_spawn_daily_creates_next_occurrence() -> None:
    conn = _mem_db()
    done = _make_todo()
    clone = _spawn_next_repeat(conn, done)
    assert clone is not None
    assert clone.id != done.id
    assert clone.planned_date == date(2026, 9, 26)
    assert clone.repeat == "daily"
    assert clone.status == "notStarted"
    assert clone.completed_at is None
    assert clone.title == done.title and clone.list_id == done.list_id
    row = conn.execute("SELECT status, planned_date FROM todo WHERE id=?", (clone.id,)).fetchone()
    assert row["status"] == "notStarted"
    # 表里只有克隆这一行（done 未入库，upsert 不影响其他行）
    n = conn.execute("SELECT COUNT(*) c FROM todo").fetchone()["c"]
    assert n == 1


def test_spawn_weekly_carries_repeat_and_shifts_due() -> None:
    conn = _mem_db()
    done = _make_todo(
        repeat="weekly", planned_date=date(2026, 9, 14),
        due_date=date(2026, 9, 16), start_date=date(2026, 9, 14),
        completed_at=datetime(2026, 9, 14, 18, 0, 0),
    )
    clone = _spawn_next_repeat(conn, done)
    assert clone is not None
    assert clone.planned_date == date(2026, 9, 21)
    # due/start 按相同位移平移（+7 天）
    assert clone.due_date == date(2026, 9, 23)
    assert clone.start_date == date(2026, 9, 21)


def test_no_repeat_returns_none() -> None:
    conn = _mem_db()
    assert _spawn_next_repeat(conn, _make_todo(repeat=None)) is None
    assert _spawn_next_repeat(conn, _make_todo(repeat="none")) is None
    # 有 repeat 但没有 planned_date → 无法定节奏，不生成
    assert _spawn_next_repeat(conn, _make_todo(planned_date=None)) is None
    n = conn.execute("SELECT COUNT(*) c FROM todo").fetchone()["c"]
    assert n == 0
