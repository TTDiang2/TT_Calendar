"""数据、插件与备份目录解析。

优先级：
- ``TT_CALENDAR_HOME`` 环境变量（Tauri 启动后端时注入）
- 打包态：``%LOCALAPPDATA%\\TT Calendar``
- 源码态：仓库根目录（保持既有 ``data/``、``plugins/`` 行为不变）

插件目录单独解析：打包态放 ``%APPDATA%\\TT Calendar\\plugins``，与安装目录
解耦——安装到任何位置都可写，升级与卸载也不会碰用户的插件。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Final

APP_NAME: Final[str] = "TT Calendar"

# 项目根目录：源码运行时是仓库根；PyInstaller 打包后是 exe 所在目录
# （onefile 模式下 __file__ 指向 _MEIPASS 临时解压目录，写入会丢失）
if getattr(sys, "frozen", False):
    PROJECT_ROOT: Final[Path] = Path(sys.executable).resolve().parent
else:
    PROJECT_ROOT: Final[Path] = Path(__file__).resolve().parent.parent


def resolve_home() -> Path:
    """应用主目录：数据、备份与日志都在它下面。"""
    env = os.environ.get("TT_CALENDAR_HOME")
    if env:
        return Path(env).expanduser().resolve()
    if getattr(sys, "frozen", False):
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if base:
            return Path(base) / APP_NAME
        return Path.home() / ".tt-calendar"
    return PROJECT_ROOT


def resolve_plugins_dir(home: Path) -> Path:
    """插件目录：打包态与安装目录完全解耦。"""
    env = os.environ.get("TT_CALENDAR_PLUGINS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    if getattr(sys, "frozen", False):
        base = os.environ.get("APPDATA")
        if base:
            return Path(base) / APP_NAME / "plugins"
        return home / "plugins"
    return home / "plugins"


def _ensure(path: Path) -> None:
    """目录不可创建（只读介质/权限）不应拦住进程启动。"""
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass


HOME: Final[Path] = resolve_home()
DATA_DIR: Final[Path] = HOME / "data"
BACKUP_DIR: Final[Path] = HOME / "backups"
PLUGINS_DIR: Final[Path] = resolve_plugins_dir(HOME)

for _dir in (HOME, DATA_DIR, BACKUP_DIR, PLUGINS_DIR):
    _ensure(_dir)
