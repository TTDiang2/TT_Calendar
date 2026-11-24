"""把 version.json 同步到所有需要版本号的地方。

版本号只有一个来源：仓库根的 version.json。出包脚本和 CI 都先跑这个脚本，
避免出现「安装包 2.4.0、界面 2.3.0、后端 2.0.0」这种对不上的情况。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def read_version(root: Path) -> str:
    data = json.loads((root / "version.json").read_text(encoding="utf-8"))
    version = str(data.get("version", "")).strip()
    if not SEMVER.match(version):
        raise ValueError(f"version.json 里的版本号不是 x.y.z：{version!r}")
    return version


def _write_json(path: Path, version: str) -> None:
    text = path.read_text(encoding="utf-8")
    if "version" not in json.loads(text):
        raise ValueError(f"{path} 里没有 version 字段")
    # 逐字替换而不是重排整个文件：避免 json.dumps 把长数组拆行，制造无意义 diff
    new_text, count = re.subn(
        r'("version"\s*:\s*")[^"]*(")', rf"\g<1>{version}\g<2>", text, count=1
    )
    if count != 1:
        raise ValueError(f"{path} 里找不到 version 字段")
    path.write_text(new_text, encoding="utf-8", newline="\n")


def _write_cargo(path: Path, version: str) -> None:
    text = path.read_text(encoding="utf-8")
    # 只改 [package] 段里的第一个 version，依赖项的 version 不能动
    pattern = re.compile(r'(?m)^(\[package\][^\[]*?^version\s*=\s*")[^"]+(")')
    new_text, count = pattern.subn(rf"\g<1>{version}\g<2>", text, count=1)
    if count != 1:
        raise ValueError(f"{path} 里找不到 [package] version")
    path.write_text(new_text, encoding="utf-8", newline="\n")


def _write_readme_badge(path: Path, version: str) -> None:
    """README 的 Release 徽章同步版本号。

    tests/test_docs_consistency.py 会断言「README 里出现当前版本」，
    手改版本时很容易漏掉徽章，让发版前测试红一片——这里顺手一起改。
    """
    text = path.read_text(encoding="utf-8")
    new_text, count = re.subn(
        r"(badge/Release-v)\d+\.\d+\.\d+", rf"\g<1>{version}", text)
    if count and new_text != text:
        path.write_text(new_text, encoding="utf-8", newline="\n")


def sync(root: Path) -> str:
    version = read_version(root)
    _write_json(root / "frontend" / "src-tauri" / "tauri.conf.json", version)
    _write_json(root / "frontend" / "package.json", version)
    _write_cargo(root / "frontend" / "src-tauri" / "Cargo.toml", version)
    for name in ("README.md", "README.zh-CN.md"):
        readme = root / name
        if readme.exists():
            _write_readme_badge(readme, version)
    (root / "tt_calendar" / "_build_version.py").write_text(
        '"""由 scripts/sync_version.py 生成，请勿手改。"""\n\n'
        f'__version__ = "{version}"\n',
        encoding="utf-8",
        newline="\n",
    )
    return version


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    version = sync(root)
    print(f"version -> {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
