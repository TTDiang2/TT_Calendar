"""refresh_calendar 各步骤耗时剖析（headless，用真实 DB）。

目的：区分 Python 端处理开销 vs Flet 通信开销，精准定位优化点。
"""
import asyncio
import sys
import time
from datetime import date as date_t
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import flet as ft

ft.Control.update = lambda self, *a, **k: None

from tt_calendar.app import CalendarApp


class FakePage:
    def __init__(self):
        self._keyboard = None
        self._dialog_stack = []

    @property
    def on_keyboard_event(self):
        return self._keyboard

    @on_keyboard_event.setter
    def on_keyboard_event(self, fn):
        self._keyboard = fn

    def add(self, *controls):
        pass

    def show_dialog(self, ctl):
        self._dialog_stack.append(ctl)

    def pop_dialog(self):
        return self._dialog_stack.pop() if self._dialog_stack else None


async def main():
    CalendarApp._refresh_jisilu_silently = lambda self: asyncio.sleep(0)
    app = CalendarApp(FakePage())

    from tt_calendar import db
    from tt_calendar.layers import build_default_layers
    from tt_calendar.layers.base import LayerContext
    from tt_calendar.utils.date_utils import month_range, window_range
    from tt_calendar.utils.gradient import build_gradient
    import tt_calendar.config as cfg

    conn = app.conn
    y, m = app.current_year, app.current_month
    start, end = window_range(y, m, 31)

    def time_it(label, fn, n=10):
        fn()
        ts = []
        for _ in range(n):
            t0 = time.perf_counter()
            fn()
            ts.append((time.perf_counter() - t0) * 1000)
        ts.sort()
        med = ts[len(ts) // 2]
        print(f"  {label:32s} med={med:7.2f}ms  min={min(ts):7.2f}ms  max={max(ts):7.2f}ms")

    print(f"== refresh_calendar breakdown (year={y} month={m}) ==")

    time_it("fetch_events_between", lambda: db.fetch_events_between(conn, start, end))
    time_it("fetch_schedule_between", lambda: db.fetch_schedule_between(conn, start, end))
    time_it("fetch_coloring_between", lambda: db.fetch_coloring_between(conn, start, end))

    events = db.fetch_events_between(conn, start, end)
    important = [e.date for e in events if e.layer_id == cfg.LayerID.IMPORTANT]
    ms, me = month_range(y, m)
    time_it("build_gradient", lambda: build_gradient(important, ms, me, "#FF4D4D"))

    sched = db.fetch_schedule_between(conn, start, end)
    coloring = db.fetch_coloring_between(conn, start, end)
    grad = build_gradient(important, ms, me, "#FF4D4D")

    def build_ctx():
        ev_cache = {}
        for e in events:
            ev_cache.setdefault(e.date, []).append(e)
        return LayerContext(
            events_by_date=ev_cache,
            schedule_by_date=sched,
            coloring_by_date=coloring,
            important_gradient=grad,
            today=date_t.today(),
            enabled_layer_ids={l.layer_id for l in app.layer_configs if l.enabled},
        )

    ctx = build_ctx()
    time_it("build ctx (group events)", build_ctx)

    layers = app.layers
    time_it(
        "render 计算 (42格 contribute)",
        lambda: app.calendar_view.render(y, m, ctx, anchor=date_t(y, m, 1)),
    )

    enabled = [l for l in layers if l.config.enabled]
    d = date_t(y, m, 15)

    def one_cell():
        for l in enabled:
            l.contribute(d, ctx)

    time_it("单格 contribute (all layers)", one_cell, n=50)

    print("\n== 端到端：完整 refresh_calendar ==")
    time_it("refresh_calendar (含DB+render)", lambda: app.refresh_calendar(), n=10)

    print("\n== 对照：图层开关（缓存路径）==")
    time_it(
        "toggle (缓存 ctx, 无 DB)",
        lambda: app.handle_toggle_layer(cfg.LayerID.IMPORTANT, True),
        n=10,
    )


if __name__ == "__main__":
    asyncio.run(main())
