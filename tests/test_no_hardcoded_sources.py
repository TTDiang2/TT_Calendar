"""门禁：核心代码不得按具体数据源分支（插件化回归防线）。

背景：集思录曾是内置源，核心在 routes / aggregator / db / layers 里到处硬编码
它的 source_id 与图层前缀，导致「全新安装也会凭空冒出一个集思录」，且任何第二个
数据源都要复制一遍特例。现在数据源的一切行为都由协议声明（LayerSpec.sub_filter /
manual_pickable），核心只认协议。

本测试用 AST 遍历核心模块，只检查**字符串字面量**——注释不进 AST，docstring 显式
排除，所以文档里举「集思录」作例子不会误伤，但代码里拿它做判断会立刻失败。

判据：核心不得出现任何已注册数据源的 source_id 字面量，也不得出现 'builtin:'
前缀（历史内置订阅标记，已由 migrate_builtin_subscriptions 迁走）。
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

CORE_DIRS = ("backend", "tt_calendar")
# 核心不得出现的字面量前缀
FORBIDDEN_PREFIXES = ("builtin:",)


def _docstring_nodes(tree: ast.AST) -> set[int]:
    """收集所有 docstring 常量节点的 id（模块/类/函数的）。"""
    ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", None)
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                if isinstance(body[0].value.value, str):
                    ids.add(id(body[0].value))
    return ids


def _string_literals(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    docs = _docstring_nodes(tree)
    out: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if id(node) not in docs:
                out.append(node.value)
    return out


def _registered_source_ids() -> set[str]:
    from tt_calendar.sources import list_sources

    return {cls.source_id for cls in list_sources() if cls.source_id}


def test_core_has_no_source_id_literals() -> None:
    source_ids = _registered_source_ids()
    assert source_ids, "至少应有一个已注册数据源，否则本门禁形同虚设"

    offences: list[str] = []
    for rel_dir in CORE_DIRS:
        for path in sorted((ROOT / rel_dir).rglob("*.py")):
            for lit in _string_literals(path):
                bad = None
                if lit in source_ids:
                    bad = f"数据源 id {lit!r}"
                elif any(lit.startswith(p) for p in FORBIDDEN_PREFIXES):
                    bad = f"内置订阅标记 {lit!r}"
                if bad:
                    offences.append(f"{path.relative_to(ROOT)}: {bad}")

    assert not offences, "核心代码不得按具体数据源分支：\n  " + "\n  ".join(offences)


def test_plugins_are_not_part_of_core_imports() -> None:
    """核心模块不得 import plugins 包（插件只能经协议被动态发现）。"""
    offenders: list[str] = []
    for rel_dir in CORE_DIRS:
        for path in sorted((ROOT / rel_dir).rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                names: list[str] = []
                if isinstance(node, ast.Import):
                    names = [a.name for a in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    names = [node.module]
                if any(n == "plugins" or n.startswith("plugins.") for n in names):
                    offenders.append(f"{path.relative_to(ROOT)}")
    assert not offenders, "核心不得直接 import 插件：\n  " + "\n  ".join(offenders)


def test_sub_filter_is_protocol_level() -> None:
    """子动作过滤必须走协议声明，不得在核心里硬编码某源的标题格式。"""
    agg = (ROOT / "backend" / "aggregator.py").read_text(encoding="utf-8")
    assert "【" not in agg, "aggregator.py 不得出现具体源的标题括号格式"
    assert "startswith('jisilu" not in agg and 'startswith("jisilu' not in agg, \
        "aggregator.py 不得按数据源图层前缀分支"