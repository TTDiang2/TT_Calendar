"""文档与代码的一致性守卫。

审查在这一类上翻车过：README 让人跑 `npm run tauri dev`，而项目约定的脚本名是
`tauri:dev`——devtools 被改成 opt-in 之后，这条命令仍能跑通但会静默丢掉
--features devtools。这类错误不会让任何测试变红，只会让人按文档操作时遇到
 inexplicably 的行为差异。

这里做的是通用化检查：README 里出现的每条 `npm run X`，package.json 里必须有
同名 script。比逐条人工核对更能防住后续漂移。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

README_FILES = [ROOT / "README.md", ROOT / "README.zh-CN.md"]
PKG = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
SCRIPTS = set(PKG["scripts"])


def _documented_commands(text: str) -> set[str]:
    """抽出文档里所有 `npm run <script>` 的 script 名。"""
    return set(re.findall(r"npm run ([A-Za-z0-9:_-]+)", text))


@pytest.mark.parametrize("readme", README_FILES, ids=lambda p: p.name)
def test_documented_npm_scripts_exist(readme: Path) -> None:
    """README 里的每条 npm run 命令都必须真实存在。"""
    text = readme.read_text(encoding="utf-8")
    missing = _documented_commands(text) - SCRIPTS
    assert not missing, (
        f"{readme.name} 写了不存在的 npm script：{sorted(missing)}；"
        f"实际可用：{sorted(SCRIPTS)}"
    )


@pytest.mark.parametrize("readme", README_FILES, ids=lambda p: p.name)
def test_tauri_dev_command_matches_project_convention(readme: Path) -> None:
    """开发命令必须是 tauri:dev——tauri dev 会丢掉 devtools 的 opt-in flag。"""
    text = readme.read_text(encoding="utf-8")
    assert "npm run tauri:dev" in text, f"{readme.name} 应写 npm run tauri:dev"
    assert "npm run tauri dev" not in text, (
        f"{readme.name} 仍在用 npm run tauri dev：它不带 --features devtools，"
        f"而 devtools 已改为 opt-in（见 Cargo.toml [features]）"
    )


def test_devtools_flag_is_opt_in() -> None:
    """devtools 必须挂在 [features] 上，不能进 tauri 默认 features。

    否则 release 也带调试器，用户右键即可执行任意 JS——这条是 devtools 那次
    改动的核心不变量，README 与它必须一致。
    """
    cargo = (ROOT / "frontend" / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8")
    dep = re.search(r"^tauri\s*=\s*\{([^}]*)\}", cargo, re.M)
    assert dep, "未找到 tauri 依赖声明"
    assert "devtools" not in dep.group(1), "devtools 不得进默认 features"
    assert re.search(r"^devtools\s*=\s*\[\"tauri/devtools\"\]", cargo, re.M), \
        "devtools 应作为 opt-in feature 存在"


@pytest.mark.parametrize("readme", README_FILES, ids=lambda p: p.name)
def test_readme_version_matches_tauri_conf(readme: Path) -> None:
    """README 的 Release 徽章版本须与 tauri.conf.json 一致。"""
    conf = json.loads(
        (ROOT / "frontend" / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))
    text = readme.read_text(encoding="utf-8")
    assert f"v{conf['version']}" in text, \
        f"{readme.name} 未提及当前版本 v{conf['version']}"


@pytest.mark.parametrize("readme", README_FILES, ids=lambda p: p.name)
def test_removed_three_slot_feature_is_not_advertised(readme: Path) -> None:
    """三段式日程已从产品中移除，README 不得再宣称它。

    该功能原有 UI 与后端 PUT /api/schedule/{d} 都还在，但前端已无任何写入方——
    日程改由 schedule-items（起止时间 + 可跨多天 + 分类）承载。留着旧宣称会让人
    按不存在的功能去找，是「功能已删、文档未跟」的典型漂移。
    """
    text = readme.read_text(encoding="utf-8")
    for phrase in ("Three-slot", "three-slot", "三段式", "上午 / 下午 / 晚上"):
        assert phrase not in text, f"{readme.name} 仍在宣称已移除的三段式日程（{phrase}）"


def test_busyness_tinting_is_driven_by_todos_not_schedules() -> None:
    """充实度染色的数据来源是 todo，文档别写成日程。

    day_busy 只由 todo 表算出（_recompute_day_busy 查的是 todo 的 due/planned/
    completed_at），中文 README 曾把它描述成「按日程多少」，与实现不符。
    """
    calc = (ROOT / "backend" / "routes.py").read_text(encoding="utf-8")
    assert "FROM todo" in calc, "day_busy 应仍由 todo 表驱动"

    for readme in README_FILES:
        text = readme.read_text(encoding="utf-8")
        for wrong in ("按日程多少", "日程密度", "how many schedules"):
            assert wrong not in text, \
                f"{readme.name} 把充实度染色说成由日程驱动（{wrong}），实际是待办"
