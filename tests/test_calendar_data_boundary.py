"""chinese_calendar 数据越界必须留痕。

该库的数据止于 2026，越界时 `get_holiday_detail` 抛 NotImplementedError。原先
这个异常被 `except Exception` 吞掉，结果是节假日图层从 2027 年起整体空白——
用户只会以为「今年没节假日」，不会知道是依赖数据过期。这是典型的静默劣化：
距今约 3 个月后所有用户都会遇到，却没有任何症状指向根因。
"""

from __future__ import annotations

import logging
import sys
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import aggregator as A  # noqa: E402


@pytest.fixture(autouse=True)
def clear_dedup():
    """去重集合是模块级的，每个用例都要从干净状态开始。"""
    A._calendar_warned_years.clear()
    yield
    A._calendar_warned_years.clear()


def _last_supported_year() -> int:
    """从库里探出最后有数据的年份，而不是把 2026 硬编码进断言。

    必须**往上**探：从一个确定有数据的年份起步，逐年加，第一个抛错的就是越界年。
    早先的写法是从 2026 往下退，等于把「2026 就是最后一年」写死了——依赖升到
    支持 2027 之后，三个用例会在 CI 上集体失败（本地还是旧版，反而看不出来）。
    """
    y = 2005  # chinese_calendar 的下界远早于此，这里取一个肯定有数据的起点
    while y < 2200:  # 兜底，别让测试死循环
        try:
            A.cc.get_holiday_detail(date(y, 6, 1))
        except Exception:  # NotImplementedError / AssertionError 都算「没这年数据」
            return y - 1
        y += 1
    return y


def test_out_of_range_year_is_logged(caplog) -> None:
    last = _last_supported_year()
    with caplog.at_level(logging.WARNING, logger="backend.aggregator"):
        assert A._holiday_of(date(last + 1, 1, 5)) is None

    msgs = [r.getMessage() for r in caplog.records]
    assert any(str(last + 1) in m and "节假日" in m for m in msgs), \
        f"越界年份应留下告警：{msgs}"


def test_warning_is_deduplicated_per_year(caplog) -> None:
    """本函数逐日调用（月视图 42 天、年视图 504 天），不去重会刷爆日志。"""
    year = _last_supported_year() + 1
    with caplog.at_level(logging.WARNING, logger="backend.aggregator"):
        for day in range(1, 29):
            A._holiday_of(date(year, 1, day))

    hits = [r for r in caplog.records if str(year) in r.getMessage()]
    assert len(hits) == 1, f"同一年应只告警一次，实际 {len(hits)} 次"


def test_different_years_warn_separately(caplog) -> None:
    last = _last_supported_year()
    with caplog.at_level(logging.WARNING, logger="backend.aggregator"):
        A._holiday_of(date(last + 1, 6, 1))
        A._holiday_of(date(last + 2, 6, 1))

    years = {r.getMessage() for r in caplog.records}
    assert len(years) == 2, f"两个不同年份应各告警一次：{years}"


def test_supported_year_does_not_warn(caplog) -> None:
    """数据范围内的年份不得产生告警——否则真告警会被噪声淹没。"""
    with caplog.at_level(logging.WARNING, logger="backend.aggregator"):
        A._holiday_of(date(2026, 1, 1))
        A._holiday_of(date(2026, 10, 1))

    assert not caplog.records, f"数据范围内不应告警：{[r.getMessage() for r in caplog.records]}"
