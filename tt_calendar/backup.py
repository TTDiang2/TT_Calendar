"""SQLite 热备份。

每天首次启动时复制一份数据库到 ``BACKUP_DIR``，保留最近 14 天。使用 SQLite
在线备份 API（``Connection.backup``）而不是文件复制：WAL 模式下直接拷 ``.db``
可能拿到不一致的快照，备份 API 会处理锁与页边界。

备份失败不应阻断启动，调用方负责捕获异常。
"""

from __future__ import annotations

import logging
import re
import sqlite3
from datetime import date, datetime
from pathlib import Path

log = logging.getLogger(__name__)

KEEP_DAYS = 14

_DAILY_RE = re.compile(r"^calendar-\d{8}\.db$")


def _today_name() -> str:
    return f"calendar-{date.today():%Y%m%d}.db"


def _prune_daily(backup_dir: Path, keep: int) -> None:
    """只清理每日备份，手动快照不受保留策略影响。"""

    daily = sorted(p for p in backup_dir.iterdir() if _DAILY_RE.match(p.name))
    for old in daily[:-keep]:
        try:
            old.unlink()
        except OSError:
            log.warning("删除旧备份失败: %s", old, exc_info=True)


def _snapshot(conn: sqlite3.Connection, dest: Path) -> None:
    """写临时文件再原子替换，避免半截备份被当成有效文件。"""

    tmp = dest.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    target = None
    try:
        target = sqlite3.connect(tmp)
        conn.backup(target)
        # Windows 上不显式 close，replace 会因文件仍被占用而失败。
        target.close()
        target = None
        tmp.replace(dest)
    except Exception:
        if target is not None:
            target.close()
        tmp.unlink(missing_ok=True)
        raise


def daily_backup(
    conn: sqlite3.Connection,
    backup_dir: Path,
    keep: int = KEEP_DAYS,
) -> Path | None:
    """今天已有备份则返回 ``None``，否则生成并返回路径。"""

    backup_dir.mkdir(parents=True, exist_ok=True)
    dest = backup_dir / _today_name()
    created = False
    if not dest.exists():
        _snapshot(conn, dest)
        created = True
    _prune_daily(backup_dir, keep)
    return dest if created else None


def backup_now(conn: sqlite3.Connection, backup_dir: Path) -> Path:
    """手动快照，文件名带时分秒；同一秒重复调用时追加序号。"""

    backup_dir.mkdir(parents=True, exist_ok=True)
    stem = f"calendar-{datetime.now():%Y%m%d-%H%M%S}"
    dest = backup_dir / f"{stem}.db"
    n = 1
    while dest.exists():
        dest = backup_dir / f"{stem}-{n}.db"
        n += 1
    _snapshot(conn, dest)
    return dest


def list_backups(backup_dir: Path) -> list[dict]:
    """按时间倒序返回备份文件元信息。"""

    if not backup_dir.is_dir():
        return []
    files = [p for p in backup_dir.iterdir() if p.suffix == ".db"]
    files.sort(key=lambda p: p.name, reverse=True)
    return [
        {
            "name": p.name,
            "size": p.stat().st_size,
            "mtime": datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds"),
        }
        for p in files
    ]
