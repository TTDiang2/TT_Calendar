"""无 GUI 驱动 CalendarApp 核心交互方法，暴露事件回调链里被吞掉的异常。"""
import asyncio
import sys
from datetime import date as date_t
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import flet as ft

# 关键：所有 flet 控件 update() 变 no-op，允许无 GUI 构造与驱动
ft.Control.update = lambda self, *a, **k: None

from tt_calendar.app import CalendarApp


class FakePage:
    """最小 page 替身：只记录调用，不渲染。"""

    def __init__(self):
        self.dialog = None
        self._keyboard = None
        self.snackbars = []
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
        if self._dialog_stack:
            return self._dialog_stack.pop()
        return None


async def main():
    # 屏蔽启动静默拉取：类级替换为返回协程的空操作（构造内 create_task 需要运行循环）
    CalendarApp._refresh_jisilu_silently = lambda self: asyncio.sleep(0)
    page = FakePage()
    app = CalendarApp(page)
    app._refresh_jisilu_silently = lambda: None

    print("== 初始 ==", app.current_year, app.current_month)

    print("== prev_month ==")
    app.prev_month()
    print("after prev:", app.current_year, app.current_month)

    print("== next_month x2 ==")
    app.next_month()
    app.next_month()
    print("after next x2:", app.current_year, app.current_month)

    print("== go_today ==")
    app.go_today()
    print("today:", app.current_year, app.current_month, "sel:", app.selected_date)

    print("== change_view('week') ==")
    app.change_view("week")
    print("view:", app.current_view, "| title:", app.topbar._title.value)
    print("anchor:", app._anchor)

    print("== navigate week +1 -1 ==")
    app._navigate(1)
    print("after +1 week:", app._anchor, "| title:", app.topbar._title.value)
    app._navigate(-1)
    print("after -1 week:", app._anchor, "| title:", app.topbar._title.value)

    print("== change_view('day') ==")
    app.change_view("day")
    print("view:", app.current_view, "| title:", app.topbar._title.value)

    print("== navigate day +1 ==")
    app._navigate(1)
    print("after +1 day:", app._anchor, "| title:", app.topbar._title.value)

    print("== back to month + year-view rejection ==")
    app.change_view("month")
    app.change_view("year")
    print("after year try, view:", app.current_view)

    print("== snackbar (year view rejected) ==")
    app._show_snackbar("test msg")
    print("snackbar shown via show_dialog, stack top:", type(page._dialog_stack[-1]).__name__ if page._dialog_stack else None)

    print("== right-click context menu ==")
    app.handle_day_right_click(date_t.today())
    print("dialog stack depth after right-click:", len(page._dialog_stack))

    print("== add event dialog ==")
    app.handle_add_event(date_t.today())
    print("dialog stack depth after add-event:", len(page._dialog_stack))

    print("== toggle important off ==")
    from tt_calendar import config as cfg
    app.handle_toggle_layer(cfg.LayerID.IMPORTANT, False)
    important = next(l for l in app.layer_configs if l.layer_id == cfg.LayerID.IMPORTANT)
    print("important.enabled =", important.enabled)

    print("== toggle coloring on ==")
    app.handle_toggle_layer(cfg.LayerID.COLORING, True)
    coloring = next(l for l in app.layer_configs if l.layer_id == cfg.LayerID.COLORING)
    print("coloring.enabled =", coloring.enabled)

    print("== toggle important back on ==")
    app.handle_toggle_layer(cfg.LayerID.IMPORTANT, True)
    important = next(l for l in app.layer_configs if l.layer_id == cfg.LayerID.IMPORTANT)
    print("important.enabled =", important.enabled)

    print("== keyboard Arrow Right ==")
    from flet import KeyboardEvent
    kb = page._keyboard
    print("keyboard handler bound:", kb is not None)

    print("== refresh_countdown ==")
    app.refresh_countdown()
    print("countdown:", app.sidebar._countdown_text)

    print("ALL DRIVE TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(main())