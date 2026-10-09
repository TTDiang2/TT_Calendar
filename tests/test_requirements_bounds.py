"""依赖声明的可复现性守卫。

本项目用 PyInstaller 把后端打包成随包分发的桌面 exe，而 CI 不跑打包流程。于是
「某个依赖悄悄升了大版本 → 源码测试仍全绿 → 打包出的 exe 在用户机器上崩溃」
这条路径没有任何拦截：上界缺失时 pip 会一直往上升，直到某次发版才炸。

所以这里断言 requirements.txt 的每一条都有上界。库项目不该设上界（会挡住下游），
应用项目应该——而这正是本项目的性质。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

REQUIREMENTS = ROOT / "requirements.txt"


def _specs() -> list:
    from packaging.requirements import Requirement

    out = []
    for raw in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = raw.split("#")[0].strip()
        if not line:
            continue
        req = Requirement(line)
        out.append(req)
    return out


def test_requirements_parse() -> None:
    assert _specs(), "requirements.txt 未解析出任何依赖"


def _ops(req) -> set[str]:
    """从 specifier 字符串解析运算符。

    不碰 Specifier._specs：它是私有 API，且不同 packaging 版本里产出的元素
    类型不同（元组 vs Specifier 对象），依赖它等于给自己埋一颗定时炸弹。
    """
    return set(re.findall(r"(===|==|!=|<=|>=|~=|<|>)", str(req.specifier)))


@pytest.mark.parametrize("idx", range(len(_specs())))
def test_every_dependency_has_an_upper_bound(idx: int) -> None:
    req = _specs()[idx]
    assert _ops(req) & {"<", "<="}, (
        f"{req.name} 缺上界（当前 {req.specifier}）。打包产物不受 CI 保护，"
        f"依赖大版本升级只会在用户机器上炸。"
    )


def test_no_pinned_exact_versions() -> None:
    """锁死精确版本会让安全补丁无法安装；上界 + 下界才是应用项目该有的形态。"""
    for req in _specs():
        assert not (_ops(req) & {"==", "==="}), \
            f"{req.name} 被精确锁死（{req.specifier}），安全补丁将无法安装"


def test_upload_dependency_declared() -> None:
    """routes.py 有 UploadFile 端点，缺 python-multipart 时导入期即崩。"""
    names = {r.name.lower() for r in _specs()}
    assert "python-multipart" in names, "漏声明 python-multipart：按本文件全新安装后启动即崩"


def test_installed_versions_satisfy_bounds() -> None:
    """当前环境必须仍落在声明范围内，否则上界写错、把开发者自己挡在门外。"""
    import importlib.metadata as md

    for req in _specs():
        try:
            v = md.version(req.name)
        except md.PackageNotFoundError:
            continue
        assert req.specifier.contains(v, prereleases=True), \
            f"已安装 {req.name}=={v} 不满足 {req.specifier}"
