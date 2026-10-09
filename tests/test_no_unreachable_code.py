"""不可达代码守卫。

`compute_todo_busy_level` 的 `return` 之后曾粘着 17 行 `_holiday_of` 的函数体，
永不执行，却穿过了 132 次提交与 368 个测试——没有任何自动检查能发现它。

注意 ruff 的 F/E9 **抓不到这类问题**（实测：把同样的死代码喂给
`ruff check --select F,E9` 仍是 All checks passed）。不可达代码检测是pylint 的
W0101，ruff 尚未实现。故这里用 AST 自己做——本仓库已有同类AST 守卫
（test_no_hardcoded_sources.py），风格一致。
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

SOURCES = sorted(
    [p for p in (ROOT / "backend").rglob("*.py")]
    + [p for p in (ROOT / "tt_calendar").rglob("*.py")]
)

# 这些语句之后的同层语句永不执行
TERMINATORS = (ast.Return, ast.Raise, ast.Continue, ast.Break)


def _unreachable_in_function(fn: ast.FunctionDef) -> list[int]:
    hit: list[int] = []
    for i, stmt in enumerate(fn.body[:-1]):
        if isinstance(stmt, TERMINATORS):
            hit.extend(s.id for s in fn.body[i + 1:])
            break
    return hit


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: str(p.relative_to(ROOT)))
def test_no_unreachable_code_after_return(path: Path) -> None:
    """函数体内 return/raise/break/continue 之后不应再有语句。"""
    tree = ast.parse(path.read_text(encoding="utf-8"), str(path))
    lines = path.read_text(encoding="utf-8").splitlines()
    offenders = []
    for fn in [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]:
        for ln in _unreachable_in_function(fn):
            text = lines[ln - 1].strip() if 0 < ln <= len(lines) else ""
            offenders.append(f"{fn.name}() 第 {ln} 行: {text[:60]}")
    assert not offenders, (
        f"{path.relative_to(ROOT)} 有不可达代码：\n  " + "\n  ".join(offenders)
    )


def test_specific_regression_aggregator_has_no_dead_block() -> None:
    """点名道姓地钉住这次的具体回归，便于日后 blame 时一眼看懂。"""
    tree = ast.parse((ROOT / "backend" / "aggregator.py").read_text(encoding="utf-8"))
    fn = next(n for n in tree.body
              if isinstance(n, ast.FunctionDef) and n.name == "compute_todo_busy_level")
    assert _unreachable_in_function(fn) == [], \
        "compute_todo_busy_level 的 return 之后又出现了死代码"
    assert fn.body[-1] is not None and isinstance(fn.body[-1], ast.Return), \
        "函数应以 return 收尾——这正是死代码能藏在其后的原因"
