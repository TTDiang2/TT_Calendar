"""农历黄金向量对拍。

农历历经闰月与 29/30 日交替，是最容易「看起来对但差一天」的地方，而本模块此前
零测试覆盖。这里沿用 merge 向量那套已跑通的「生成器 + 对拍 + 一致性守卫」：

- tests/gen_lunar_golden.py 固化参考实现输出
- 本文件逐条对拍
- test_vectors_match_generator 断言生成器输出 == 已落库向量，防止两者一起漂移

borax 数据自 1900-01-31 起（该日即农历正月初一）；更早的日期
LunarDate.from_solar_date 会抛 InvalidLunarDateError，本模块未做兜底——
现实场景不会遇到 1900 年的事件，故按现状记录而非改行为。
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar.utils.lunar_utils import lunar_display, next_lunar_occurrence  # noqa: E402

VECTORS_PATH = ROOT / "tests" / "golden" / "lunar_vectors.json"
VECTORS = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))["vectors"]


def test_vectors_are_usable() -> None:
    """守卫向量本身：input 缺失的向量驱动不了任何东西。"""
    assert len(VECTORS) >= 40, f"向量数异常：{len(VECTORS)}"
    empty = [v["name"] for v in VECTORS if not v.get("input")]
    assert not empty, f"这些向量缺少 input：{empty}"


@pytest.mark.parametrize("v", VECTORS, ids=[v["name"] for v in VECTORS])
def test_golden_vector(v: dict) -> None:
    if v["kind"] == "display":
        got = lunar_display(date.fromisoformat(v["input"]["date"]))
    else:
        got = next_lunar_occurrence(
            date.fromisoformat(v["input"]["base"]),
            date.fromisoformat(v["input"]["today"]),
        ).isoformat()
    assert got == v["expect"], f"{v['name']}（{v['why']}）"


def test_vectors_match_generator() -> None:
    """向量文件必须与生成器输出一致，否则它会悄悄过期而没人知道。"""
    sys.path.insert(0, str(ROOT / "tests"))
    import gen_lunar_golden  # noqa: PLC0415

    assert gen_lunar_golden.run() == VECTORS, \
        "lunar_vectors.json 与 gen_lunar_golden.py 输出不一致，请重新生成"


# ------------------------------------------------------------------ 语义钉死


def test_first_day_shows_month_name_only() -> None:
    """初一显示月名而非「正月初一」——这是农历的排版惯例。"""
    assert lunar_display(date(2024, 2, 10)) == "正月"   # 正月初一
    assert lunar_display(date(2024, 2, 11)) == "正月初二"


def test_leap_month_gets_prefix() -> None:
    """闰月带「闰」前缀；2025 年闰六月。"""
    out = lunar_display(date(2025, 7, 25))
    assert out.startswith("闰六月"), out


def test_month_twelve_is_labya() -> None:
    """十二月显示为「腊月」，不是「十二月」。"""
    import borax.calendars.lunardate as ld_mod

    # 找 2026 年腊月的某一天
    d = date(2026, 1, 1)
    while d < date(2026, 3, 1):
        if ld_mod.LunarDate.from_solar_date(d.year, d.month, d.day).month == 12:
            assert lunar_display(d).startswith("腊月"), lunar_display(d)
            return
        d = date.fromordinal(d.toordinal() + 1)
    pytest.skip("该年未扫到腊月")


def test_occurrence_returns_a_date_not_in_the_past() -> None:
    """任何向量下，返回日期都不得早于 today。"""
    for v in VECTORS:
        if v["kind"] != "occurrence":
            continue
        today = date.fromisoformat(v["input"]["today"])
        got = next_lunar_occurrence(date.fromisoformat(v["input"]["base"]), today)
        if got != date.fromisoformat(v["input"]["base"]):
            assert got >= today, f"{v['name']} 返回了过去的日期 {got} < {today}"


def test_occurrence_preserves_lunar_month_day() -> None:
    """结果与基准日的农历月日一致（含闰月退回非闰同日的约定）。"""
    from borax.calendars.lunardate import LunarDate

    for v in VECTORS:
        if v["kind"] != "occurrence":
            continue
        base = date.fromisoformat(v["input"]["base"])
        got = date.fromisoformat(v["expect"])
        bl = LunarDate.from_solar_date(base.year, base.month, base.day)
        gl = LunarDate.from_solar_date(got.year, got.month, got.day)
        assert (gl.month, gl.day) == (bl.month, bl.day), \
            f"{v['name']} 农历月日漂移：{(bl.month, bl.day)} -> {(gl.month, gl.day)}"