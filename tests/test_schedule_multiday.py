"""多日日程（schedule_items.end_date）数据层与聚合层验证。

覆盖：
- 单日日程行为不变（end_date 为 NULL）
- 跨天日程区间相交查询：跨月、视图窗口裁剪
- 倒挂 / 等于起始日的 end_date 被归一化为 NULL
- 聚合展开：每一天都可见，且 span_index / span_total 正确
- 旧库升级：缺 end_date 列时自动补列
"""
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tt_calendar import db
from tt_calendar.models import ScheduleItem


def new_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    return conn


def test_single_day_unchanged() -> None:
    conn = new_conn()
    saved = db.upsert_schedule_item(conn, ScheduleItem(date=date(2026, 9, 3), title="单日会议", start_time="10:00"))
    assert saved.end_date is None
    assert saved.is_multi_day is False

    got = db.fetch_schedule_items_between(conn, date(2026, 9, 1), date(2026, 9, 30))
    assert len(got) == 1 and got[0].end_date is None
    conn.close()


def test_inverted_range_normalized() -> None:
    """end_date 早于或等于 date 时存 NULL —— 否则普通日程会被误判成跨天。"""

    conn = new_conn()
    same = db.upsert_schedule_item(conn, ScheduleItem(date=date(2026, 9, 3), end_date=date(2026, 9, 3), title="同日"))
    back = db.upsert_schedule_item(conn, ScheduleItem(date=date(2026, 9, 3), end_date=date(2026, 9, 1), title="倒挂"))
    assert same.end_date is None, "end_date == date 应归一化为 NULL"
    assert back.end_date is None, "倒挂区间应归一化为 NULL"
    conn.close()


def test_update_edits_in_place() -> None:
    """带 id 的 upsert 必须原地更新，不能插新行。

    曾经的实现是「INSERT 不带 id 列 + ON CONFLICT(id) DO UPDATE」——INSERT 不指定 id
    时永远拿到新自增 id，冲突永不触发，每次“更新”都插一行（HTTP 集成测试暴露：
    把多日缩成单日后，旧行仍然挂在库里，月视图照样画跨天条）。
    """

    conn = new_conn()
    saved = db.upsert_schedule_item(
        conn, ScheduleItem(date=date(2026, 9, 10), end_date=date(2026, 9, 12), title="三日会")
    )
    assert saved.id is not None

    # 原地更新：缩成单日 + 改标题
    saved.end_date = None
    saved.title = "改成单日"
    again = db.upsert_schedule_item(conn, saved)
    assert again.id == saved.id, "更新必须保持原 id"

    rows = db.fetch_schedule_items_between(conn, date(2026, 9, 1), date(2026, 9, 30))
    assert len(rows) == 1, f"更新后库里应只有 1 行，实际 {len(rows)} 行"
    assert rows[0].title == "改成单日" and rows[0].end_date is None
    conn.close()


def test_span_intersects_view_window() -> None:
    """跨月日程：8/28 起 9/5 止，只查 9 月也要能看到（区间相交而非 date 落在区间内）。"""

    conn = new_conn()
    db.upsert_schedule_item(conn, ScheduleItem(date=date(2026, 8, 28), end_date=date(2026, 9, 5), title="跨月出差"))

    sept = db.fetch_schedule_items_between(conn, date(2026, 9, 1), date(2026, 9, 30))
    assert [i.title for i in sept] == ["跨月出差"], "跨月日程在 9 月视图里必须可见"

    aug = db.fetch_schedule_items_between(conn, date(2026, 8, 1), date(2026, 8, 31))
    assert [i.title for i in aug] == ["跨月出差"], "跨月日程在 8 月视图里同样可见"

    # 区间外不应命中
    october = db.fetch_schedule_items_between(conn, date(2026, 10, 1), date(2026, 10, 31))
    assert october == []
    conn.close()


def test_expand_spans_clips_to_window() -> None:
    conn = new_conn()
    items = [
        ScheduleItem(id=1, date=date(2026, 9, 3), end_date=date(2026, 9, 5), title="三天会"),
        ScheduleItem(id=2, date=date(2026, 9, 4), title="单日"),
    ]
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
    from aggregator import _expand_schedule_spans  # type: ignore

    by_date = _expand_schedule_spans(items, date(2026, 9, 1), date(2026, 9, 30))
    assert sorted(by_date.keys()) == [date(2026, 9, 3), date(2026, 9, 4), date(2026, 9, 5)]
    assert len(by_date[date(2026, 9, 3)]) == 1
    assert len(by_date[date(2026, 9, 4)]) == 2  # 跨天 + 单日同天共存

    # 窗口裁剪：只查 9/4 时，跨天日程在那一天可见，其余天不生成
    narrow = _expand_schedule_spans(items, date(2026, 9, 4), date(2026, 9, 4))
    assert sorted(narrow.keys()) == [date(2026, 9, 4)]
    assert len(narrow[date(2026, 9, 4)]) == 2
    conn.close()


def test_build_day_span_metadata() -> None:
    """首日 span_index=1，末日 = span_total；单日条目不带 span 字段。"""

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
    from aggregator import _build_day, _expand_schedule_spans  # type: ignore

    items = [ScheduleItem(id=1, date=date(2026, 9, 3), end_date=date(2026, 9, 5), title="三天会", category="work")]
    by_date = _expand_schedule_spans(items, date(2026, 9, 1), date(2026, 9, 30))

    def build(d: date) -> dict:
        return _build_day(
            d, {}, {}, by_date, {}, {}, {}, date(2026, 9, 3), 2026, 9,
        )

    first = build(date(2026, 9, 3))["schedule_items"][0]
    mid = build(date(2026, 9, 4))["schedule_items"][0]
    last = build(date(2026, 9, 5))["schedule_items"][0]

    assert (first["span_index"], first["span_total"]) == (1, 3)
    assert (mid["span_index"], mid["span_total"]) == (2, 3)
    assert (last["span_index"], last["span_total"]) == (3, 3)
    assert first["is_multi_day"] is True and first["span_start"] == "2026-09-03"

    # 单日条目不应带 span 字段（前端据此判断画标题还是延续条）
    single = _build_day(
        date(2026, 9, 4),
        {}, {},
        _expand_schedule_spans([ScheduleItem(id=2, date=date(2026, 9, 4), title="单日")], date(2026, 9, 1), date(2026, 9, 30)),
        {}, {}, {}, date(2026, 9, 3), 2026, 9,
    )["schedule_items"][0]
    assert "is_multi_day" not in single


def test_legacy_db_gets_end_date_column() -> None:
    """模拟旧库：建表时没有 end_date，init_db 的迁移应补上且不丢数据。"""

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    conn.execute("ALTER TABLE schedule_items DROP COLUMN end_date")  # 造假旧库
    conn.commit()

    db.init_db(conn)  # 再次 init 触发 _ensure_schedule_item_columns
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(schedule_items)").fetchall()}
    assert "end_date" in cols, "旧库升级后必须有 end_date 列"

    saved = db.upsert_schedule_item(conn, ScheduleItem(date=date(2026, 9, 3), end_date=date(2026, 9, 5), title="升级后跨天"))
    assert saved.is_multi_day is True
    assert [i.title for i in db.fetch_schedule_items_between(conn, date(2026, 9, 4), date(2026, 9, 4))] == ["升级后跨天"]
    conn.close()


if __name__ == "__main__":
    test_single_day_unchanged()
    test_inverted_range_normalized()
    test_span_intersects_view_window()
    test_expand_spans_clips_to_window()
    test_build_day_span_metadata()
    test_legacy_db_gets_end_date_column()
    print("ALL SCHEDULE MULTIDAY TESTS PASSED")
