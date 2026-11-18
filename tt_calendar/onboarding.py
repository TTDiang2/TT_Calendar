"""首次启动状态与旧数据库导入。

首次启动只做两件事：告诉用户数据存在哪里，以及允许把旧版
``data/calendar.db`` 搬进来。导入采用"上传到 pending → 重启时替换"
两段式，避免在数据库仍被打开时覆盖文件。
"""

from __future__ import annotations

import logging
import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from . import config as app_config

log = logging.getLogger(__name__)

SQLITE_MAGIC = b"SQLite format 3\x00"
MAX_IMPORT_BYTES = 200 * 1024 * 1024
PENDING_NAME = "import-pending.db"
MARKER_NAME = ".initialized"
REQUIRED_TABLE = "events"


def _home(home: Path | str | None = None) -> Path:
    return Path(home) if home is not None else Path(app_config.HOME)


def marker_path(home: Path | str | None = None) -> Path:
    return _home(home) / MARKER_NAME


def is_initialized(home: Path | str | None = None) -> bool:
    return marker_path(home).exists()


def mark_initialized(home: Path | str | None = None) -> None:
    path = marker_path(home)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(datetime.now().isoformat(timespec="seconds"), encoding="utf-8")
    except OSError as e:  # 标记失败只影响下次是否再引导，不阻断启动
        log.warning("无法写入初始化标记 %s: %s", path, e)


def has_user_data(conn: sqlite3.Connection) -> bool:
    """库里是否已有用户内容；空库仍应进入首次引导。"""
    row = conn.execute(
        """
        SELECT
            EXISTS(SELECT 1 FROM events)
         OR EXISTS(SELECT 1 FROM schedule_items)
         OR EXISTS(SELECT 1 FROM todo)
         OR EXISTS(SELECT 1 FROM coloring)
        """
    ).fetchone()
    return bool(row and row[0])


def _version() -> str:
    try:
        from ._build_version import __version__
    except ImportError:
        return "dev"
    return __version__


def status(conn: sqlite3.Connection, home: Path | str | None = None) -> dict[str, Any]:
    return {
        "first_run": not is_initialized(home) and not has_user_data(conn),
        "data_dir": str(app_config.DATA_DIR),
        "plugins_dir": str(app_config.PLUGINS_DIR),
        "version": _version(),
    }


def validate_database(path: Path) -> None:
    """只接受能打开且含 events 表的 SQLite 文件。"""
    try:
        with path.open("rb") as fh:
            header = fh.read(len(SQLITE_MAGIC))
    except OSError as e:
        raise ValueError(f"无法读取文件：{e}") from e
    if header != SQLITE_MAGIC:
        raise ValueError("不是有效的 SQLite 数据库")

    try:
        conn = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
        try:
            row = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                (REQUIRED_TABLE,),
            ).fetchone()
        finally:
            conn.close()
    except sqlite3.DatabaseError as e:
        raise ValueError(f"无法打开数据库：{e}") from e
    if row is None:
        raise ValueError("数据库缺少 events 表，可能不是 TT Calendar 数据")


def save_import(data: bytes, home: Path | str | None = None) -> Path:
    """校验上传内容并写入 pending 文件；真正替换发生在下次启动。"""
    if len(data) > MAX_IMPORT_BYTES:
        raise ValueError("数据库超过 200 MB，已拒绝导入")
    if not data:
        raise ValueError("文件为空")

    target = _home(home) / "data" / PENDING_NAME
    tmp = target.with_name(target.name + ".uploading")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        tmp.write_bytes(data)
        validate_database(tmp)
        tmp.replace(target)
    finally:
        tmp.unlink(missing_ok=True)
    return target


def _backup_name(backup_dir: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = backup_dir / f"pre-import-{stamp}.db"
    seq = 1
    while dest.exists():
        dest = backup_dir / f"pre-import-{stamp}-{seq}.db"
        seq += 1
    return dest


def apply_pending_import(
    home: Path | str | None = None,
    db_path: Path | str | None = None,
    backup_dir: Path | str | None = None,
) -> bool:
    """把 pending 库替换为当前库；失败时保留原库并清理 pending。"""
    home_path = _home(home)
    pending = home_path / "data" / PENDING_NAME
    if not pending.is_file():
        return False

    try:
        validate_database(pending)
    except ValueError as e:
        log.error("待导入数据库无效，已忽略：%s", e)
        pending.unlink(missing_ok=True)
        return False

    target = Path(db_path) if db_path is not None else Path(app_config.DB_PATH)
    backups = Path(backup_dir) if backup_dir is not None else Path(app_config.BACKUP_DIR)

    try:
        if target.is_file():
            backups.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, _backup_name(backups))
        target.parent.mkdir(parents=True, exist_ok=True)
        for suffix in ("-wal", "-shm"):
            Path(str(target) + suffix).unlink(missing_ok=True)
        os.replace(pending, target)
    except OSError:
        log.exception("导入数据库失败，保留原数据库")
        return False

    mark_initialized(home_path)
    log.info("已导入外部数据库到 %s", target)
    return True
