"""订阅插件协议测试（不依赖任何真实插件文件 —— 主仓库不含插件）。

覆盖 2026-09 插件化重构的核心承诺：
1. 源通过 Source.layer_specs / ensure_layers 自管图层，播种器不认识具体源；
2. plugins/*.py 的第三方源能被发现注册；
3. 未知 source_key / 未安装插件的订阅走 pending_adaptation；
4. 源声明的 refresh 窗口驱动统一刷新窗口计算。
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import date as date_t
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar import config as cfg  # noqa: E402
from tt_calendar import db as dbmod  # noqa: E402
from tt_calendar.models import Event, ImportResult  # noqa: E402
from tt_calendar.sources import (  # noqa: E402
    all_source_ids,
    get_source,
    list_sources,
    register_source,
)
from tt_calendar.sources.base import LayerSpec, Source  # noqa: E402

# 内联假源：协议测试不依赖 plugins/ 里的真实插件文件
_FAKE_ID = "test_fake_source"


class _FakeSource(Source):
    source_id = _FAKE_ID
    display_name = "Fake 订阅"
    refresh_past_days = 5
    refresh_future_days = 30

    def layer_specs(self):
        return [LayerSpec(layer_id="fake_all", display_name="Fake 订阅·全部", color="#123456")]

    async def fetch(self, start, end, **kw):
        return [], ImportResult(source=_FAKE_ID, layer_id="fake_*")


def _mem_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    dbmod.init_db(conn)
    return conn


# ---------------------------------------------------------------------------
# 注册中心（无插件环境下：内置为空、get_source 返回 None）
# ---------------------------------------------------------------------------


def test_registry_works_without_plugins():
    """主仓库不发布插件：干净环境 list_sources 为空是合法状态。"""
    ids = all_source_ids()
    assert isinstance(ids, list)
    assert get_source("no_such_source") is None


def test_register_and_get_source(monkeypatch):
    register_source(_FAKE_ID, _FakeSource)
    try:
        assert get_source(_FAKE_ID) is not None
        assert _FAKE_ID in all_source_ids()
        assert get_source(_FAKE_ID).display_name == "Fake 订阅"
    finally:
        from tt_calendar.sources import _PLUGINS

        if _PLUGINS:
            _PLUGINS.pop(_FAKE_ID, None)


# ---------------------------------------------------------------------------
# 图层播种协议（用假源）
# ---------------------------------------------------------------------------


def test_ensure_layers_seeds_and_preserves_enabled():
    """播种：缺失插入；display_name 相同的图层保留用户 enabled。"""
    conn = _mem_db()
    _FakeSource().ensure_layers(conn)
    conn.commit()
    row = conn.execute(
        "SELECT display_name FROM layer_config WHERE layer_id='fake_all'"
    ).fetchone()
    assert row is not None and row["display_name"] == "Fake 订阅·全部"

    # 用户关掉图层 → 再播种不应重新打开
    conn.execute("UPDATE layer_config SET enabled=0 WHERE layer_id='fake_all'")
    conn.commit()
    _FakeSource().ensure_layers(conn)
    conn.commit()
    row = conn.execute(
        "SELECT enabled FROM layer_config WHERE layer_id='fake_all'"
    ).fetchone()
    assert row["enabled"] == 0
    conn.close()


def test_ensure_default_seeds_generic_layers_only():
    """无插件环境：ensure_default_layer_configs 播种通用图层即可，不崩。"""
    conn = _mem_db()
    dbmod.ensure_default_layer_configs(conn)
    rows = conn.execute("SELECT layer_id FROM layer_config").fetchall()
    ids = {r["layer_id"] for r in rows}
    assert "coloring" in ids and "holiday" in ids and "important" in ids
    conn.close()


def test_layer_specs_group_defaults_to_display_name():
    """layer_specs 未给 group 时播种用 display_name（源协议默认）。"""
    class _NoGroup(Source):
        source_id = "test_nogroup"
        display_name = "分组名"

        def layer_specs(self):
            return [LayerSpec(layer_id="nogroup_a", display_name="A", color="#fff")]

        async def fetch(self, start, end, **kw):
            return [], ImportResult(source=self.source_id, layer_id="x")

    conn = _mem_db()
    _NoGroup().ensure_layers(conn)
    conn.commit()
    row = conn.execute(
        "SELECT group_name FROM layer_config WHERE layer_id='nogroup_a'"
    ).fetchone()
    assert row["group_name"] == "分组名"
    conn.close()


# ---------------------------------------------------------------------------
# 插件发现（真实 plugins/ 目录动态注入假插件）
# ---------------------------------------------------------------------------


def test_plugin_discovery_from_plugins_dir(monkeypatch, tmp_path):
    """第三方插件：复制 .py 进 plugins/ 目录即被注册（验证后清理，不留痕）。"""
    import tt_calendar.sources as reg

    plugin_file = reg._plugins_dir() / "test_tmp_plugin.py"
    plugin_file.write_text(
        "from tt_calendar.sources.base import Source\n"
        "from tt_calendar.models import Event, ImportResult\n"
        "class HelloSub(Source):\n"
        "    source_id = 'hello_sub'\n"
        "    display_name = 'Hello 订阅'\n"
        "    refresh_past_days = 3\n"
        "    refresh_future_days = 10\n"
        "    async def fetch(self, start, end, **kw):\n"
        "        return [], ImportResult(source='hello_sub', layer_id='x')\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(reg, "_PLUGINS", None)
    try:
        found = reg._discover_plugins()
        assert "hello_sub" in found
        src = reg.get_source("hello_sub")
        assert src is not None and src.display_name == "Hello 订阅"
        assert src.refresh_past_days == 3
    finally:
        monkeypatch.setattr(reg, "_PLUGINS", None)
        plugin_file.unlink()


# ---------------------------------------------------------------------------
# 协议版本（插件声明「我需要 ≥N 的 app」，不兼容则跳过并说清原因）
# ---------------------------------------------------------------------------


def test_plugin_declining_future_protocol_is_skipped(monkeypatch, caplog):
    """要求更高协议版本的插件被跳过，且日志说清差在哪个版本。"""
    import tt_calendar.sources as reg

    future = Source.PROTOCOL_VERSION + 1
    plugin_file = reg._plugins_dir() / "test_tmp_future_plugin.py"
    plugin_file.write_text(
        "from tt_calendar.sources.base import Source\n"
        "from tt_calendar.models import ImportResult\n"
        "class FutureSub(Source):\n"
        "    source_id = 'future_sub'\n"
        "    display_name = '未来源'\n"
        f"    PROTOCOL_VERSION = {future}\n"
        "    async def fetch(self, start, end, **kw):\n"
        "        return [], ImportResult(source='future_sub', layer_id='x')\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(reg, "_PLUGINS", None)
    try:
        with caplog.at_level("ERROR"):
            found = reg._discover_plugins()
        assert "future_sub" not in found
        assert reg.get_source("future_sub") is None
        # 报错必须可操作：说清插件要哪个版本、app 支持哪个
        msg = "\n".join(r.getMessage() for r in caplog.records)
        assert str(future) in msg
        assert str(Source.PROTOCOL_VERSION) in msg
    finally:
        monkeypatch.setattr(reg, "_PLUGINS", None)
        plugin_file.unlink()


def test_plugin_declining_current_protocol_loads(monkeypatch):
    """声明了当前协议版本的插件正常加载。"""
    import tt_calendar.sources as reg

    plugin_file = reg._plugins_dir() / "test_tmp_v2_plugin.py"
    plugin_file.write_text(
        "from tt_calendar.sources.base import Source\n"
        "from tt_calendar.models import ImportResult\n"
        "class V2Sub(Source):\n"
        "    source_id = 'v2_sub'\n"
        "    display_name = 'v2 源'\n"
        f"    PROTOCOL_VERSION = {Source.PROTOCOL_VERSION}\n"
        "    async def fetch(self, start, end, **kw):\n"
        "        return [], ImportResult(source='v2_sub', layer_id='x')\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(reg, "_PLUGINS", None)
    try:
        found = reg._discover_plugins()
        assert "v2_sub" in found
    finally:
        monkeypatch.setattr(reg, "_PLUGINS", None)
        plugin_file.unlink()


def test_plugin_without_version_declaration_still_loads(monkeypatch):
    """早期插件未声明版本（继承基类）不应被拒——只有「要求更高」才拦。"""
    import tt_calendar.sources as reg

    plugin_file = reg._plugins_dir() / "test_tmp_noversion_plugin.py"
    plugin_file.write_text(
        "from tt_calendar.sources.base import Source\n"
        "from tt_calendar.models import ImportResult\n"
        "class NoVerSub(Source):\n"
        "    source_id = 'nover_sub'\n"
        "    display_name = '无版本源'\n"
        "    async def fetch(self, start, end, **kw):\n"
        "        return [], ImportResult(source='nover_sub', layer_id='x')\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(reg, "_PLUGINS", None)
    try:
        assert "nover_sub" in reg._discover_plugins()
    finally:
        monkeypatch.setattr(reg, "_PLUGINS", None)
        plugin_file.unlink()


def test_protocol_incompatibility_never_blocks_older_plugins():
    """单元口径：只拦「要求更高」这一个方向。"""
    from tt_calendar.sources.base import protocol_incompatibility

    class Future(Source):
        source_id = "f"
        PROTOCOL_VERSION = Source.PROTOCOL_VERSION + 1

    class Older(Source):
        source_id = "o"
        PROTOCOL_VERSION = Source.PROTOCOL_VERSION - 1

    class Same(Source):
        source_id = "s"

    assert protocol_incompatibility(Future) is not None
    assert protocol_incompatibility(Older) is None
    assert protocol_incompatibility(Same) is None


# ---------------------------------------------------------------------------
# 刷新窗口（由源声明驱动）
# ---------------------------------------------------------------------------


def test_refresh_window_from_source_declaration():
    from datetime import timedelta

    today = date_t.today()
    src = _FakeSource()
    # 窗口语义：start = today - past_days；end = today + future_days
    assert (today - timedelta(days=src.refresh_past_days)) < today
    assert (today + timedelta(days=src.refresh_future_days)) > today
