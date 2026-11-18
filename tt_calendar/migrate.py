"""便携版 → 安装版的数据迁移。

老版本把 ``data/`` 放在 exe 旁边；安装版的数据在 ``%LOCALAPPDATA%``。
首次启动若发现新位置还没有数据库，就把旧库热拷贝过来。只用 SQLite 的
backup API，不用文件复制——旧库可能还带着 ``-wal``，裸拷会丢掉最近事务。
"""

from __future__ import annotations

import logging
import shutil
import sqlite3
from pathlib import Path

from .paths import PLUGINS_DIR, PROJECT_ROOT

log = logging.getLogger(__name__)


def _legacy_candidates() -> list[Path]:
    """便携版可能把 data/ 放在 exe 同目录，也可能放在上一级（源码布局）。"""
    seen: list[Path] = []
    for base in (PROJECT_ROOT, PROJECT_ROOT.parent):
        db = base / "data" / "calendar.db"
        if db not in seen:
            seen.append(db)
    return seen


def _copy_sqlite(src: Path, dest: Path) -> None:
    tmp = dest.with_name(dest.name + ".importing")
    tmp.unlink(missing_ok=True)
    src_conn = sqlite3.connect(f"file:{src.as_posix()}?mode=ro", uri=True)
    dst = sqlite3.connect(tmp)
    try:
        src_conn.backup(dst)
    finally:
        dst.close()
        src_conn.close()
    try:
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)


def import_legacy_data(home: Path) -> bool:
    """把旧 data/ 导入新 HOME。目标已存在时不做任何事，返回是否发生迁移。"""
    target = home / "data" / "calendar.db"
    if target.exists():
        return False

    for candidate in _legacy_candidates():
        if not candidate.is_file():
            continue
        if candidate.resolve() == target.resolve():
            continue
        if candidate.stat().st_size == 0:
            continue
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            _copy_sqlite(candidate, target)
        except (OSError, sqlite3.Error) as e:
            log.warning("旧数据迁移失败 %s -> %s: %s", candidate, target, e)
            target.unlink(missing_ok=True)
            continue

        for name in ("user_config.json",):
            src = candidate.parent / name
            if src.is_file():
                try:
                    shutil.copy2(src, home / "data" / name)
                except OSError as e:
                    log.warning("旧配置迁移失败 %s: %s", src, e)
        log.info("已从 %s 导入历史数据", candidate)
        return True

    return False


def import_legacy_plugins() -> int:
    """把便携包旁的 plugins/*.py 复制到可写插件目录；已存在的不覆盖。"""
    target = PLUGINS_DIR
    candidates = (PROJECT_ROOT / "plugins", PROJECT_ROOT.parent / "plugins")
    if any(candidate.resolve() == target.resolve() for candidate in candidates):
        return 0

    copied = 0
    for base in candidates:
        if not base.is_dir():
            continue
        for src in sorted(base.glob("*.py")):
            if src.name.startswith("_"):
                continue
            dest = target / src.name
            if dest.exists():
                continue
            try:
                target.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
                copied += 1
            except OSError as e:
                log.warning("插件迁移失败 %s: %s", src, e)
        if copied:
            log.info("已从 %s 迁移 %d 个插件", base, copied)
            break
    return copied
