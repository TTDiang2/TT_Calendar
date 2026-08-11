"""临时验证 move_day_content 的改期语义。"""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import date

from tt_calendar import db


def new_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    return conn


conn = new_conn()

# 手动事件（应被移动）
db.upsert_event(conn, db.Event(layer_id="important", source="manual", date=date(2026, 8, 10), title="手动事件A"))
db.upsert_event(conn, db.Event(layer_id="important", source="manual", date=date(2026, 8, 10), title="手动事件B"))
# 外部数据（不应被移动）
db.upsert_event(conn, db.Event(layer_id="jisilu_CNV", source="jisilu", date=date(2026, 8, 10), title="集思录事件", source_ref="j1"))
db.upsert_event(conn, db.Event(layer_id="holiday", source="chinese_calendar", date=date(2026, 8, 10), title="节假日"))
# 源日日程
db.upsert_schedule(conn, db.ScheduleEntry(date=date(2026, 8, 10), am="开会", pm="健身", ev=None))
# 目标日已有部分日程
db.upsert_schedule(conn, db.ScheduleEntry(date=date(2026, 8, 12), am=None, pm="已有pm", ev="已有ev"))

# 执行改期 8/10 -> 8/12
moved_events, moved_schedule = db.move_day_content(conn, date(2026, 8, 10), date(2026, 8, 12))
print(f"moved_events={moved_events}, moved_schedule={moved_schedule}")
assert moved_events == 2, f"期望移动 2 个手动事件，实际 {moved_events}"
assert moved_schedule is True

# 源日应无手动事件和日程，但保留外部数据
kept = db.fetch_events_for_dates(conn, [date(2026, 8, 10)])
titles = {e.title for e in kept[date(2026, 8, 10)]}
print("src 日剩余:", titles)
assert titles == {"集思录事件", "节假日"}, f"外部数据不应被移动: {titles}"
assert conn.execute("SELECT * FROM schedule WHERE date=?", ("2026-08-10",)).fetchone() is None

# 目标日：两个手动事件 + 合并后的日程（dst 优先，src 补空缺）
dst_events = db.fetch_events_for_dates(conn, [date(2026, 8, 12)])
assert len(dst_events[date(2026, 8, 12)]) == 2, dst_events
dst_row = conn.execute("SELECT * FROM schedule WHERE date=?", ("2026-08-12",)).fetchone()
print("dst 日程:", dst_row["am"], "|", dst_row["pm"], "|", dst_row["ev"])
assert dst_row["am"] == "开会" and dst_row["pm"] == "已有pm" and dst_row["ev"] == "已有ev"

# 拖回同一日应无操作
moved_events, moved_schedule = db.move_day_content(conn, date(2026, 8, 12), date(2026, 8, 12))
assert moved_events == 0 and moved_schedule is False

# 无内容的日期改期
moved_events, moved_schedule = db.move_day_content(conn, date(2026, 8, 1), date(2026, 8, 2))
assert moved_events == 0 and moved_schedule is False

print("ALL MOVE TESTS PASSED")
conn.close()