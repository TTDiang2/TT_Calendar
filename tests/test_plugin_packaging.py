"""打包覆盖与插件加载失败的可见性。

两件曾经真出过事的东西：

1. **sidecar 缺模块**：`plugins/jisilu.py` 用 `tt_calendar.utils.text_utils`。
   这个模块只有插件引用，PyInstaller 的静态分析看不到 → 打包版里没有它，
   插件加载失败。用户看到的却是订阅刷新报 `pending_adaptation`，看起来像
   「需要重新适配」，把排查引向完全错误的方向。
2. **失败原因不外露**：`load_errors()` 之前不存在，加载异常只进了日志。

所以这里锁两条不变量：spec 必须整包收集 `tt_calendar`；加载失败要能被查询到。
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar import config as cfg  # noqa: E402
from tt_calendar import sources as reg  # noqa: E402


def _plugin_core_imports() -> set[str]:
    mods: set[str] = set()
    for py in (ROOT / "plugins").glob("*.py"):
        tree = ast.parse(py.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("tt_calendar"):
                mods.add(node.module)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith("tt_calendar"):
                        mods.add(alias.name)
    return mods


def test_spec_bundles_whole_tt_calendar_package() -> None:
    """插件是运行时加载的，静态分析看不到它们 import 的核心模块。

    逐个列 hiddenimports 一定会漏（已经漏过一次），所以 spec 必须整包收集。
    """
    spec = (ROOT / "tt-calendar-backend.spec").read_text(encoding="utf-8")
    assert "collect_submodules('tt_calendar')" in spec, (
        "tt-calendar-backend.spec 不再整包收集 tt_calendar：插件依赖的辅助模块"
        "（如 utils.text_utils）会重新从打包版里消失")


@pytest.mark.parametrize("mod", sorted(_plugin_core_imports()))
def test_plugin_core_imports_resolve_in_source(mod: str) -> None:
    """插件 import 的核心模块必须在源码树里真实存在（防手滑改名）。"""
    import importlib

    importlib.import_module(mod)


def test_load_errors_reports_broken_plugin(monkeypatch, tmp_path) -> None:
    """坏插件要被 load_errors() 报出来，而不是只写一行日志。"""
    bad = tmp_path / "broken_plugin.py"
    bad.write_text("import tt_calendar_not_a_real_module\n", encoding="utf-8")

    monkeypatch.setattr(cfg, "PLUGINS_DIR", tmp_path)
    reg.reload_plugins()
    try:
        errors = reg.load_errors()
        assert "broken_plugin.py" in errors
        assert "No module named" in errors["broken_plugin.py"]
    finally:
        reg.reload_plugins()
