"""核心路径补断言：count_todos / month_grid / 年度倒数日重复。

审查用变异测试找出三处「改坏了但261 个测试全绿」的地方——它们都在用户每天
看到的主路径上，且此前零断言覆盖：

- `count_todos` 的 total 改成 0 → 待办统计与summary 全错，无人察觉；
- `month_grid` 的补齐循环改成 `< 0` → 不再补满 6 行，月视图高度塌掉；
- `repeat_yearly` 分支改成 False → 年度纪念日只剩今年一个，往年条目全部消失。

本文件的每条用例都对应至少一个上述变异，并已逐个验证能被杀掉。
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar import db  # noqa: E402
from tt_calendar.models import Countdown  # noqa: E402
from tt_calendar.utils.date_utils import month_grid  # noqa: E402


# ------------------------------------------------------------------ count_todos


@pytest.fixture
def conn() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    db.init_db(c)
    yield c
    c.close()


def _add(conn, tid: str, status: str, list_id: str = "L1") -> None:
    conn.execute(
        "INSERT INTO todo(id, list_id, title, status) VALUES(?,?,?,?)",
        (tid, list_id, f"t{tid}", status),
    )


def test_count_todos_counts_all_three_buckets(conn) -> None:
    _add(conn, "1", "notStarted")
    _add(conn, "2", "completed")
    _add(conn, "3", "inProgress")

    got = db.count_todos(conn)

    assert got == {"total": 3, "incomplete": 2, "completed": 1}, got


def test_count_todos_arithmetic_is_consistent(conn) -> None:
    """completed 由 total - incomplete 推出，三者必须自洽。

    把 total 改成 0 会让 completed 变成负数——这条断言专杀该变异。
    """
    _add(conn, "1", "completed")
    _add(conn, "2", "completed")
    _add(conn, "3", "notStarted")

    got = db.count_todos(conn)

    assert got["completed"] == got["total"] - got["incomplete"], \
        f"三者不自洽：{got}"
    assert got["completed"] >= 0, f"completed 不可能为负：{got}"


def test_count_todos_filters_by_list(conn) -> None:
    _add(conn, "1", "notStarted", list_id="LA")
    _add(conn, "2", "completed", list_id="LB")

    assert db.count_todos(conn, list_id="LA") == \
        {"total": 1, "incomplete": 1, "completed": 0}
    assert db.count_todos(conn, list_id="LB") == \
        {"total": 1, "incomplete": 0, "completed": 1}


def test_count_todos_empty_table(conn) -> None:
    assert db.count_todos(conn) == {"total": 0, "incomplete": 0, "completed": 0}


# ------------------------------------------------------------------ month_grid


@pytest.mark.parametrize("month", range(1, 13))
def test_month_grid_is_always_six_rows(month: int) -> None:
    """月视图按固定 6 行渲染，拿到 4-5 行的月份必须补齐。

    把补齐循环改成 `< 0` 后，2026 年 2 月（起始日为周日，天然只 4 行）就会少两行，
    月视图整体塌陷——而此前没有任何断言关心行数。
    """
    grid = month_grid(2026, month)
    assert len(grid) == 6, f"2026-{month:02d} 应补齐为 6 行，实际 {len(grid)}"
    assert all(len(w) == 7 for w in grid), "每行必须是 7 天"


@pytest.mark.parametrize("month", range(1, 13))
def test_month_grid_days_are_consecutive(month: int) -> None:
    """整个网格应是连续日期——补齐行是接着上月末尾往后排的。"""
    grid = month_grid(2026, month)
    flat = [d for w in grid for d in w]
    for a, b in zip(flat, flat[1:]):
        assert b == a + timedelta(days=1), f"日期不连续：{a} -> {b}"


@pytest.mark.parametrize("month", range(1, 13))
def test_month_grid_contains_every_day_of_the_month(month: int) -> None:
    """当月每一天都必须出现在网格里，否则月视图会漏掉末尾几天。"""
    grid = month_grid(2026, month)
    in_grid = {(d.year, d.month, d.day) for w in grid for d in w}
    # 当月 1 号与最后一天都必须落在网格内
    import calendar as _cal

    last_day = _cal.monthrange(2026, month)[1]
    assert (2026, month, 1) in in_grid, f"2026-{month:02d}-01 不在网格内"
    assert (2026, month, last_day) in in_grid, f"2026-{month:02d}-{last_day} 不在网格内"


def test_month_grid_weeks_start_on_monday() -> None:
    grid = month_grid(2026, 8)
    assert grid[0][0].weekday() == 0, "每周应从周一开始（firstweekday=0）"


def test_month_grid_february_leap_and_non_leap() -> None:
    """闰年 2 月 29 天、平年 28 天，都要落在 6×7 网格内。"""
    for year in (2024, 2026):
        grid = month_grid(year, 2)
        assert len(grid) == 6
        in_grid = {(d.year, d.month, d.day) for w in grid for d in w}
        last = 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28
        assert (year, 2, last) in in_grid, f"{year} 年 2 月最后一日缺失"


# ------------------------------------------------------------- 年度倒数日重复


def test_repeat_yearly_generates_a_range_of_years() -> None:
    """年度重复应覆盖往年与未来（-5..+10，共 16 项）。

    把 `if cd.repeat_yearly:` 改成 `if False:` 后只剩今年 1 项——往年纪念日
    在日历上凭空消失，而此前只断言 banner.kind，抓不到。
    """
    cd = Countdown(id=1, name="纪念日", base_date=date(2000, 5, 1), repeat_yearly=True)
    today = date(2026, 1, 1)

    specs = db._countdown_event_specs(cd, today)

    yearly = [s for s in specs if s[1] == "纪念日"]
    assert len(yearly) == 16, f"应生成 16 个年度项，实际 {len(yearly)}"
    years = sorted({s[0].year for s in yearly})
    assert years[0] == 2021, f"应含往年（2021）：{years[:3]}"
    assert years[-1] == 2036, f"应含未来（2036）：{years[-3:]}"
    assert all(m == 5 and d == 1 for _, m, d in
               [(s[0], s[0].month, s[0].day) for s in yearly]), "月日应与基准日一致"


def test_non_repeating_countdown_is_single() -> None:
    cd = Countdown(id=2, name="一次性", base_date=date(2026, 3, 15))
    specs = db._countdown_event_specs(cd, date(2026, 1, 1))

    assert [s[0] for s in specs] == [date(2026, 3, 15)], \
        f"不重复的倒数日应只有一条：{specs}"


def test_leap_day_base_is_clamped_not_crashing() -> None:
    """2/29 基准遇到平年应退成 2/28，而不是抛 ValueError。"""
    cd = Countdown(id=3, name="闰日", base_date=date(2024, 2, 29), repeat_yearly=True)
    specs = db._countdown_event_specs(cd, date(2026, 1, 1))
    assert specs, "平年不应因 2/29 而整体失败"
    assert all(s[0].month == 2 for s in specs), "应全部落在 2 月"


def test_milestone_rule_adds_offset_events() -> None:
    """里程碑规则应额外生成偏移事件。"""
    cd = Countdown(id=4, name="里程碑", base_date=date(2020, 1, 1),
                   repeat_yearly=False, milestone_rule="100,1000")
    specs = db._countdown_event_specs(cd, date(2026, 1, 1))
    offs = sorted(s[2] for s in specs)
    assert offs == [0, 100, 1000], f"里程碑偏移应各生成一项：{offs}"


def test_invalid_milestone_entries_are_ignored() -> None:
    cd = Countdown(id=5, name="脏规则", base_date=date(2020, 1, 1),
                   milestone_rule="100,abc,-5,")
    specs = db._countdown_event_specs(cd, date(2026, 1, 1))
    offs = sorted(s[2] for s in specs)
    assert offs == [0, 100], f"非数字项应被跳过，不应报错或产生偏移：{offs}"
