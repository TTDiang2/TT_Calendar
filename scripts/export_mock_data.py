"""从真实 DB 导出月视图聚合 JSON，供 React 前端原型使用。

同时验证后端 aggregator 的数据结构可行性。导出 2026 年 7/8/9 三个月，
前端原型可据此测试翻月。

输出：frontend/src/mock/mockData.json
结构对应 docs/MIGRATION_PLAN.md §6.1。
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from pathlib import Path

import chinese_calendar as cc

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tt_calendar import db
from tt_calendar.utils.date_utils import month_grid, window_range, month_range
from tt_calendar.utils.gradient import build_gradient
from tt_calendar.config import LayerID


def build_month(conn, year: int, month: int) -> dict:
    start, end = window_range(year, month, 31)
    events = db.fetch_events_between(conn, start, end)
    schedule = db.fetch_schedule_between(conn, start, end)
    coloring = db.fetch_coloring_between(conn, start, end)

    events_by_date: dict = defaultdict(lambda: defaultdict(list))
    for ev in events:
        events_by_date[ev.date][ev.layer_id].append(ev)

    important_dates = [e.date for e in events if e.layer_id == LayerID.IMPORTANT]
    m_start, m_end = month_range(year, month)
    gradient = build_gradient(important_dates, m_start, m_end, "#FF4D4D")

    today = date.today()
    days = []
    for week in month_grid(year, month):
        for d in week:
            ev_by_layer = {}
            for lid, evs in events_by_date.get(d, {}).items():
                ev_by_layer[lid] = [e.model_dump(mode="json") for e in evs]

            sched = schedule.get(d)
            holiday = None
            try:
                on_h, name = cc.get_holiday_detail(d)
                if on_h and name:
                    holiday = {"name": name, "is_workday_made_up": False}
                if cc.is_workday(d) and d.weekday() >= 5:
                    if holiday:
                        holiday["is_workday_made_up"] = True
                    else:
                        holiday = {"name": None, "is_workday_made_up": True}
            except Exception:
                pass

            days.append({
                "date": d.isoformat(),
                "is_today": d == today,
                "is_weekend": d.weekday() >= 5,
                "is_other_month": d.year != year or d.month != month,
                "events_by_layer": ev_by_layer,
                "schedule": sched.model_dump(mode="json") if sched else None,
                "coloring_level": coloring.get(d),
                "holiday": holiday,
                "gradient_bg": gradient.get(f"{d.year}-{d.month:02d}-{d.day:02d}"),
            })
    return {"year": year, "month": month, "days": days}


def build_countdown(conn) -> str:
    from datetime import timedelta
    today = date.today()
    upcoming = db.fetch_events_between(conn, today, today + timedelta(days=365), layer_ids=[LayerID.IMPORTANT])
    if upcoming:
        base = [e for e in upcoming if e.extra.get("offset", 0) == 0] or upcoming
        nearest = min(base, key=lambda e: abs((e.date - today).days))
        days_left = (nearest.date - today).days
        if days_left == 0:
            return f"🎉 今天是「{nearest.title}」"
        return f"距离「{nearest.title}」还有 {days_left} 天"
    return "暂无重要日期"


def main():
    conn = db.connect()
    layers = db.fetch_layer_configs(conn)
    layers_out = [l.model_dump(mode="json") for l in layers]

    months = {}
    for y, m in [(2026, 7), (2026, 8), (2026, 9)]:
        months[f"{y}-{m}"] = build_month(conn, y, m)

    out = {
        "layers": layers_out,
        "months": months,
        "countdown": build_countdown(conn),
    }

    out_dir = Path(__file__).resolve().parent.parent / "frontend" / "src" / "mock"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "mockData.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"exported -> {out_path}")
    print(f"  layers: {len(layers_out)}")
    for k, v in months.items():
        total_ev = sum(sum(len(evs) for evs in d["events_by_layer"].values()) for d in v["days"])
        print(f"  {k}: {len(v['days'])} days, {total_ev} events")
    print(f"  countdown: {out['countdown']}")
    conn.close()


if __name__ == "__main__":
    main()
