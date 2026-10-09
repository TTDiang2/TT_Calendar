"""测试全局夹具。

目前只有一个夹具，但它堵的是一类会伪装成「代码缺陷」的现象：

插件发现相关的用例需要往真实 plugins/ 目录写临时 .py 文件。而 plugins/*.py 是
.gitignore 排除的可选扩展——干净 clone 上该目录根本不存在，于是这些用例会以
FileNotFoundError 失败，看起来像发现逻辑坏了，实际是前置目录缺失。

这里保证目录存在，并在每个用例前后清掉 test_tmp_* 残留。后者同样必要：若某个
用例中途抛异常，它的临时插件会留在目录里被后续用例发现，导致测试之间互相污染
（表现为「单跑绿、全跑红」这类难查现象）。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _plugins_dir() -> Path:
    from tt_calendar import config as cfg

    return cfg.PROJECT_ROOT / "plugins"


def _sweep_temp_plugins() -> None:
    pdir = _plugins_dir()
    if not pdir.is_dir():
        return
    for stale in pdir.glob("test_tmp_*.py"):
        stale.unlink(missing_ok=True)


@pytest.fixture(autouse=True)
def plugins_dir_ready():
    """保证 plugins/ 存在，且用例前后无临时插件残留。"""
    _sweep_temp_plugins()
    _plugins_dir().mkdir(parents=True, exist_ok=True)
    yield
    _sweep_temp_plugins()