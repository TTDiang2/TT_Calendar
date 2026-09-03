"""英为财情解析器单元测试。

不发起真实 HTTP（CF 会拦截，详见 SUBSCRIPTION_INVESTING_HANDOFF.md）。
只验证：HTML 标签剥离 / 日期解析 / vs 预期推导 / 国家代码映射 / cookie 文件解析。
"""

from __future__ import annotations

import json
import sys
from datetime import date as date_t
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar.sources.investing import (
    InvestingSource,
    _parse_item,
    _parse_date,
    _strip_tags,
    _to_number,
    _vs_forecast,
    load_cookies_file,
)


# ---------------------------------------------------------------------------
# 基础工具函数
# ---------------------------------------------------------------------------


def test_strip_tags_plain() -> None:
    assert _strip_tags("hello") == "hello"
    assert _strip_tags("<a href='x'>link</a>") == "link"
    assert _strip_tags("  <b>  bold  </b>  text  ") == "bold text"
    assert _strip_tags("a&amp;b&lt;c") == "a&b<c"
    assert _strip_tags("") == ""
    assert _strip_tags(None) == ""  # type: ignore[arg-type]


def test_to_number() -> None:
    assert _to_number("123") == 123.0
    assert _to_number("1,234") == 1234.0
    assert _to_number("2.5%") == 2.5
    assert _to_number("1.5K") == 1500.0
    assert _to_number("-8.330M") == -8330000.0
    assert _to_number("1.2B") == 1_200_000_000.0
    assert _to_number("abc") is None
    assert _to_number(None) is None  # type: ignore[arg-type]
    assert _to_number("") is None


def test_vs_forecast() -> None:
    assert _vs_forecast(None, "1.0", "0.9") == "待公布"
    assert _vs_forecast("", "1.0", "0.9") == "待公布"
    assert _vs_forecast("—", "1.0", "0.9") == "待公布"
    assert _vs_forecast("1.5", "1.0", "0.9") == "超预期"
    assert _vs_forecast("0.8", "1.0", "0.9") == "不及"
    assert _vs_forecast("1.0", "1.0", "0.9") == "符合"
    # forecast 不可比 → 符合
    assert _vs_forecast("abc", "1.0", "0.9") == "符合"


def test_parse_date_formats() -> None:
    assert _parse_date("Sep 01, 2026", "10:00 AM") == date_t(2026, 9, 1)
    assert _parse_date("2026-09-01", "") == date_t(2026, 9, 1)
    assert _parse_date("09/01/2026", "") == date_t(2026, 9, 1)
    assert _parse_date("not a date", "") is None
    assert _parse_date("", "") is None


# ---------------------------------------------------------------------------
# 完整 item 解析
# ---------------------------------------------------------------------------


def _ev(layer_id: str, country: str, item: dict) -> dict:
    """把 Event 转成 dict 方便断言。"""
    e = _parse_item(item, layer_id, country)
    assert e is not None, f"_parse_item returned None for {item}"
    return {
        "layer_id": e.layer_id,
        "source": e.source,
        "date": e.date,
        "title": e.title,
        "color": e.color,
        "source_ref": e.source_ref,
        "extra": dict(e.extra),
    }


def test_parse_item_us_high_actual() -> None:
    """典型美国 ISM 制造业 PMI：已公布、超过预期。"""
    item = {
        "id": "338",
        "title": "<a href='/economic-calendar/...'>美国 ISM 制造业 PMI</a>",
        "country": 5,
        "date": "Sep 01, 2026",
        "time": "10:00 AM",
        "actual": "48.7",
        "forecast": "49.5",
        "previous": "48.0",
        "importance": 3,
    }
    got = _ev("investing_5", "5", item)
    assert got["layer_id"] == "investing_5"
    assert got["source"] == "investing"
    assert got["date"] == date_t(2026, 9, 1)
    assert got["title"] == "美国 ISM 制造业 PMI"
    assert got["source_ref"] == "5:338"
    assert got["color"] == "#3F51B5"  # 美国色（config 字典里）
    extra = got["extra"]
    assert extra["country"] == "美国"
    assert extra["country_code"] == "5"
    assert extra["currency"] == "USD"
    assert extra["importance"] == 3
    assert extra["vs_forecast"] == "不及"  # 48.7 < 49.5
    assert extra["time"] == "10:00 AM"
    assert extra["actual"] == "48.7"
    assert extra["forecast"] == "49.5"
    assert extra["previous"] == "48.0"


def test_parse_item_superforecast() -> None:
    """EIA 原油库存：负数 actual 比 forecast 更负（数值更小）。"""
    item = {
        "id": "1234",
        "title": "美国当周 EIA 原油库存变动",
        "country": 5,
        "date": "Sep 02, 2026",
        "time": "10:30 PM",
        "actual": "-4.450M",
        "forecast": "-0.400M",
        "previous": "0.095M",
        "importance": 3,
    }
    got = _ev("investing_5", "5", item)
    extra = got["extra"]
    # -4.45M (-4_450_000) < -0.4M (-400_000) → a < f → "不及"
    assert extra["vs_forecast"] == "不及"
    assert extra["actual"] == "-4.450M"


def test_parse_item_pending() -> None:
    """实际值空：待公布。"""
    item = {
        "id": "9999",
        "title": "美国初请失业金人数",
        "country": 5,
        "date": "Sep 03, 2026",
        "time": "8:30 PM",
        "actual": "",
        "forecast": "205K",
        "previous": "203K",
        "importance": 3,
    }
    got = _ev("investing_5", "5", item)
    extra = got["extra"]
    assert extra["vs_forecast"] == "待公布"
    assert "actual" not in extra  # 空值不进 extra


def test_parse_item_title_required() -> None:
    assert _parse_item({"id": "1", "title": "", "country": 5, "date": "Sep 01, 2026"}, "investing_5", "5") is None
    assert _parse_item({"id": "1", "title": "   ", "country": 5, "date": "Sep 01, 2026"}, "investing_5", "5") is None


def test_parse_item_date_required() -> None:
    assert _parse_item({"id": "1", "title": "x", "country": 5, "date": ""}, "investing_5", "5") is None
    assert _parse_item({"id": "1", "title": "x", "country": 5, "date": "garbage"}, "investing_5", "5") is None


def test_parse_item_unknown_country_fallback() -> None:
    """未在 config 注册的国家 → fallback 名称 'country_<id>'，色用默认蓝。"""
    item = {
        "id": "1",
        "title": "某未知国家事件",
        "country": 999,
        "date": "Sep 01, 2026",
        "time": "",
        "importance": 2,
    }
    got = _ev("investing_999", "999", item)
    assert got["extra"]["country"] == "country_999"
    assert got["extra"]["currency"] == ""
    assert got["color"] == "#3D6BFB"  # fallback 默认色


def test_parse_item_source_ref_fallback_when_no_id() -> None:
    """没有 id 时 source_ref 用 country+title+date+time 复合，保证去重可工作。"""
    item = {
        "title": "某事件",
        "country": 5,
        "date": "Sep 01, 2026",
        "time": "10:00 AM",
        "importance": 1,
    }
    got = _ev("investing_5", "5", item)
    assert got["source_ref"].startswith("5:某事件:")


# ---------------------------------------------------------------------------
# Cookie 文件解析
# ---------------------------------------------------------------------------


def test_load_cookies_file_json(tmp_dir: Path) -> None:
    p = tmp_dir / "cookies.json"
    p.write_text(json.dumps({"cf_clearance": "abc123", "sessionid": "xyz"}), encoding="utf-8")
    out = load_cookies_file(str(p))
    assert out == {"cf_clearance": "abc123", "sessionid": "xyz"}


def test_load_cookies_file_netscape(tmp_dir: Path) -> None:
    p = tmp_dir / "cookies.txt"
    p.write_text(
        "# Netscape HTTP Cookie File\n"
        ".investing.com\tTRUE\t/\tFALSE\t9999999999\tcf_clearance\tabc123\n"
        ".investing.com\tTRUE\t/\tFALSE\t9999999999\tsid\txyz\n"
        "ignored comment line\n"
        "\n"
        ".broken\tFALSE\t/\tFALSE\t1\tname\n"  # 列数不够，会被跳过
    , encoding="utf-8")
    out = load_cookies_file(str(p))
    assert out == {"cf_clearance": "abc123", "sid": "xyz"}


def test_load_cookies_file_missing(tmp_dir: Path) -> None:
    p = tmp_dir / "no_such.json"
    try:
        load_cookies_file(str(p))
    except FileNotFoundError:
        return
    raise AssertionError("expected FileNotFoundError")


# ---------------------------------------------------------------------------
# Source 类基础字段
# ---------------------------------------------------------------------------


def test_source_class_metadata() -> None:
    s = InvestingSource()
    assert s.source_id == "investing"
    assert s.display_name == "英为财情-投资日历"
    assert s.needs_internet is True
    assert s.needs_credentials is False


# ---------------------------------------------------------------------------
# pytest fixtures 兼容（用 tmp_path 也可以）
# ---------------------------------------------------------------------------


import pytest  # noqa: E402

@pytest.fixture
def tmp_dir(tmp_path: Path) -> Path:
    return tmp_path


if __name__ == "__main__":
    # 简化运行：手动挨个跑（避免引入 pytest 依赖）
    import tempfile
    tmp = Path(tempfile.mkdtemp(prefix="investing_test_"))

    tests = [
        test_strip_tags_plain,
        test_to_number,
        test_vs_forecast,
        test_parse_date_formats,
        test_parse_item_us_high_actual,
        test_parse_item_superforecast,
        test_parse_item_pending,
        test_parse_item_title_required,
        test_parse_item_date_required,
        test_parse_item_unknown_country_fallback,
        test_parse_item_source_ref_fallback_when_no_id,
        test_source_class_metadata,
        (lambda: test_load_cookies_file_json(tmp)),
        (lambda: test_load_cookies_file_netscape(tmp)),
        (lambda: test_load_cookies_file_missing(tmp)),
    ]
    fail = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__ if hasattr(t, '__name__') else t}")
        except Exception as e:
            fail += 1
            print(f"  FAIL  {t.__name__ if hasattr(t, '__name__') else t}: {e}")
    print(f"\n{fail} failed, {len(tests) - fail} passed")
    raise SystemExit(1 if fail else 0)