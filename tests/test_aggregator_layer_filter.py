"""图层声明式过滤测试：_event_passes_layer_filter 的 sub_qtypes / min_importance 组合。

覆盖 investing 插件「最低星级」过滤（2026-09-09 设计，
docs/plans/2026-09-09-investing-importance-filter-design.md）：
- min_importance 键缺失 → 不过滤（向后兼容）；
- min_importance > 0 时 ev.extra.importance 低于门槛 → 剔除；
- 与 sub_qtypes 独立、AND 组合。
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.aggregator import _event_passes_layer_filter  # noqa: E402
from tt_calendar.models import Event  # noqa: E402

# 镜像插件通过 LayerSpec.sub_filter 声明的规则（核心只认声明，不硬编码具体源）
SUB_FILTER = {"group_key": "qtype", "title_pattern": r"^【(.+?)】"}


def _ev(importance: int | None = None, title: str = "US CPI") -> Event:
    extra: dict = {"country": "美国", "country_code": "5"}
    if importance is not None:
        extra["importance"] = importance
    return Event(layer_id="investing_5", date=date(2026, 9, 9), title=title, extra=extra)


def test_min_importance_filters_low_events() -> None:
    assert _event_passes_layer_filter(_ev(3), {"min_importance": 3}) is True
    assert _event_passes_layer_filter(_ev(2), {"min_importance": 3}) is False
    assert _event_passes_layer_filter(_ev(2), {"min_importance": 2}) is True
    assert _event_passes_layer_filter(_ev(1), {"min_importance": 2}) is False


def test_min_importance_zero_or_absent_passes_all() -> None:
    assert _event_passes_layer_filter(_ev(0), {"min_importance": 0}) is True
    assert _event_passes_layer_filter(_ev(2), {"country_code": "37"}) is True
    assert _event_passes_layer_filter(_ev(0), None) is True
    assert _event_passes_layer_filter(_ev(0), {}) is True


def test_missing_importance_extra_treated_as_zero() -> None:
    ev = _ev(None)
    assert "importance" not in ev.extra
    assert _event_passes_layer_filter(ev, {"min_importance": 1}) is False
    assert _event_passes_layer_filter(ev, {"min_importance": 0}) is True


def test_min_importance_and_sub_qtypes_combine_with_and() -> None:
    ev = Event(
        layer_id="x",
        date=date(2026, 9, 9),
        title="【申购日】测试转债",
        extra={"qtype": "cnv", "importance": 2},
    )
    assert _event_passes_layer_filter(
        ev, {"sub_filter": SUB_FILTER,
             "sub_qtypes": [{"qtype": "cnv", "sub_action": "申购日"}], "min_importance": 3}
    ) is False
    assert _event_passes_layer_filter(
        ev, {"sub_filter": SUB_FILTER,
             "sub_qtypes": [{"qtype": "cnv", "sub_action": "申购日"}], "min_importance": 2}
    ) is True
    assert _event_passes_layer_filter(
        ev, {"sub_filter": SUB_FILTER,
             "sub_qtypes": [{"qtype": "cnv", "sub_action": "赎回日"}], "min_importance": 0}
    ) is False


def test_sub_qtypes_behavior_unchanged_without_min_importance() -> None:
    ev = Event(
        layer_id="jisilu_cnv",
        date=date(2026, 9, 9),
        title="【申购日】测试转债",
        extra={"qtype": "cnv"},
    )
    assert _event_passes_layer_filter(
        ev, {"sub_filter": SUB_FILTER,
             "sub_qtypes": [{"qtype": "cnv", "sub_action": "申购日"}]}
    ) is True
    assert _event_passes_layer_filter(
        ev, {"sub_filter": SUB_FILTER,
             "sub_qtypes": [{"qtype": "cnv", "sub_action": "赎回日"}]}
    ) is False
    assert _event_passes_layer_filter(
        ev, {"sub_filter": SUB_FILTER, "sub_qtypes": []}) is True
    assert _event_passes_layer_filter(ev, None) is True


def test_sub_qtypes_ignored_when_layer_declares_no_sub_filter() -> None:
    """未声明 sub_filter 的图层不做子动作过滤（子动作规则由源声明，核心不猜）。"""
    ev = Event(
        layer_id="x",
        date=date(2026, 9, 9),
        title="【申购日】测试转债",
        extra={"qtype": "cnv"},
    )
    assert _event_passes_layer_filter(
        ev, {"sub_qtypes": [{"qtype": "cnv", "sub_action": "赎回日"}]}
    ) is True
    assert _event_passes_layer_filter(
        ev, {"sub_filter": {"group_key": "qtype"},  # 缺 title_pattern
             "sub_qtypes": [{"qtype": "cnv", "sub_action": "赎回日"}]}
    ) is True


def test_sub_filter_supports_non_bracket_title_pattern() -> None:
    """规则完全由声明决定：换成任意正则都应生效，不限于【】。"""
    ev = Event(
        layer_id="x",
        date=date(2026, 9, 9),
        title="[Settlement] 测试转债",
        extra={"kind": "settlement"},
    )
    cfg = {"sub_filter": {"group_key": "kind", "title_pattern": r"^\[(.+?)\]"},
           "sub_qtypes": [{"qtype": "settlement", "sub_action": "Settlement"}]}
    assert _event_passes_layer_filter(ev, cfg) is True
    cfg["sub_qtypes"] = [{"qtype": "settlement", "sub_action": "Other"}]
    assert _event_passes_layer_filter(ev, cfg) is False
