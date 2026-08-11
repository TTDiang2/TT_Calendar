"""日期工具：月份网格、范围计算、农历占位等。"""

from __future__ import annotations

import calendar as _calendar
from datetime import date as date_t, timedelta
from typing import Iterable


def month_grid(year: int, month: int) -> list[list[date_t]]:
    """返回 6x7 的月份网格（周一为一周起点）。

    包含前后月补齐，永远返回 6 行（保持网格稳定）。
    """

    cal = _calendar.Calendar(firstweekday=0)  # 0 = Monday
    weeks: list[list[date_t]] = list(cal.monthdatescalendar(year, month))

    # 补齐到 6 行（某些月只有 4-5 行）
    while len(weeks) < 6:
        last = weeks[-1][-1]
        new_week: list[date_t] = []
        for i in range(7):
            new_week.append(last + timedelta(days=i + 1))
        weeks.append(new_week)
    return weeks[:6]


def month_range(year: int, month: int) -> tuple[date_t, date_t]:
    """返回该月第一日和最后一日。"""

    first = date_t(year, month, 1)
    if month == 12:
        last = date_t(year, 12, 31)
    else:
        last = date_t(year, month + 1, 1) - timedelta(days=1)
    return first, last


def window_range(year: int, month: int, padding_days: int = 31) -> tuple[date_t, date_t]:
    """带前后缓冲的窗口（用于渐变、节假日预加载）。"""

    first, last = month_range(year, month)
    return first - timedelta(days=padding_days), last + timedelta(days=padding_days)


def shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    """月份加减，返回新的 (year, month)。"""

    total = year * 12 + (month - 1) + delta
    return total // 12, total % 12 + 1


def is_weekend(d: date_t) -> bool:
    """周六周日（基于 isoformat，避免依赖 locale）。"""

    return d.weekday() >= 5


def is_today(d: date_t) -> bool:
    return d == date_t.today()


def daterange(start: date_t, end: date_t) -> Iterable[date_t]:
    """[start, end] 闭区间。"""

    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


def parse_date(s: str) -> date_t:
    """健壮的日期解析：支持 'YYYY-MM-DD' 和 'YYYY-MM-DD HH:MM:SS'。"""

    s = (s or "").strip()
    if not s:
        raise ValueError("empty date string")
    # 截掉时间部分
    date_part = s.split(" ", 1)[0]
    y, m, d = date_part.split("-", 2)
    return date_t(int(y), int(m), int(d))


def try_parse_date(s: str) -> date_t | None:
    """解析失败返回 None。"""

    try:
        return parse_date(s)
    except Exception:
        return None
