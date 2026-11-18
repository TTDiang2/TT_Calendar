"""诊断包：把排障需要的信息打包成 zip，绝不包含用户数据库或凭据。"""

from __future__ import annotations

import json
import os
import platform
import re
import sqlite3
import sys
import zipfile
from datetime import datetime
from pathlib import Path

from tt_calendar import config as app_config

_SECRET_KEYS = ("token", "secret", "password", "passwd", "api_key", "apikey", "pat", "authorization")
_REDACT_KV = re.compile(
    r"(?i)(\"?(?:" + "|".join(_SECRET_KEYS) + r")\"?\s*[:=]\s*)(\"?)([^\"\s,}]+)"
)
_REDACT_BEARER = re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-]+")

_COUNT_TABLES = ("events", "schedule_items", "todo", "coloring", "layers")

_LOG_NAMES = ("backend.log", "backend.log.1", "backend.log.2", "backend.log.3")


def redact(text: str) -> str:
    """把日志里常见的凭据形态替换成 ***，宁可多抹也不泄露。"""
    text = _REDACT_BEARER.sub(r"\1***", text)
    return _REDACT_KV.sub(r"\1\2***", text)


def _app_version() -> str:
    try:
        from tt_calendar._build_version import __version__

        return __version__
    except Exception:
        return "dev"


def _table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in _COUNT_TABLES:
        try:
            row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
            counts[table] = int(row[0]) if row else 0
        except sqlite3.Error:
            counts[table] = -1
    return counts


def _file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _system_info(conn: sqlite3.Connection, home: Path, data_dir: Path) -> dict:
    db_path = data_dir / "calendar.db"
    return {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "app": {
            "version": _app_version(),
            "frozen": bool(getattr(sys, "frozen", False)),
        },
        "python": {
            "version": sys.version,
            "executable": sys.executable,
        },
        "os": {
            "platform": platform.platform(),
            "release": platform.release(),
            "machine": platform.machine(),
            "locale": os.environ.get("LANG", ""),
        },
        "paths": {
            "home": str(home),
            "data_dir": str(data_dir),
            "plugins_dir": str(app_config.PLUGINS_DIR),
            "backup_dir": str(app_config.BACKUP_DIR),
        },
        "database": {
            "path": str(db_path),
            "size": _file_size(db_path),
            "wal_size": _file_size(data_dir / "calendar.db-wal"),
            "counts": _table_counts(conn),
        },
    }


def _log_candidates(home: Path, data_dir: Path) -> list[tuple[str, Path]]:
    candidates: list[tuple[str, Path]] = []
    for name in _LOG_NAMES:
        candidates.append((name, data_dir / name))
    for base in (home, Path(sys.executable).resolve().parent):
        candidates.append(("launcher.log", base / "launcher.log"))
    return candidates


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _unique_path(directory: Path, stem: str, suffix: str) -> Path:
    target = directory / f"{stem}{suffix}"
    index = 2
    while target.exists():
        target = directory / f"{stem}-{index}{suffix}"
        index += 1
    return target


def build_bundle(
    conn: sqlite3.Connection,
    *,
    home: Path | None = None,
    data_dir: Path | None = None,
    dest_dir: Path | None = None,
) -> Path:
    """生成诊断 zip，返回路径。只白名单收集，不遍历用户目录。"""
    home = home or app_config.HOME
    data_dir = data_dir or app_config.DATA_DIR
    dest_dir = dest_dir or (home / "diagnostics")
    dest_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = _unique_path(dest_dir, f"TT-Calendar-diagnostics-{stamp}", ".zip")

    version = {"version": _app_version(), "frozen": bool(getattr(sys, "frozen", False))}
    system = _system_info(conn, home, data_dir)

    logs: list[tuple[str, Path]] = []
    seen: set[Path] = set()
    used_names: set[str] = set()
    for name, path in _log_candidates(home, data_dir):
        resolved = path.resolve()
        if name in used_names or resolved in seen or not path.is_file():
            continue
        seen.add(resolved)
        used_names.add(name)
        logs.append((name, path))

    readme = (
        "TT Calendar diagnostics bundle\n"
        "==============================\n\n"
        "This archive is meant to help troubleshoot a problem. It contains:\n"
        "- version.json: app version and build mode\n"
        "- system.json: OS, Python, paths, database size and row counts\n"
        "- logs/: recent backend and launcher logs (credentials redacted)\n\n"
        "It does NOT contain calendar.db, user_config.json, plugin files,\n"
        "or any account credentials. Log lines that look like tokens or\n"
        "passwords are replaced with ***.\n"
    )

    system_json = json.dumps(system, ensure_ascii=False, indent=2)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("README.txt", readme)
        archive.writestr("version.json", json.dumps(version, ensure_ascii=False, indent=2))
        archive.writestr("system.json", system_json)
        for name, path in logs:
            archive.writestr(f"logs/{name}", redact(_read_text(path)))
    return target


def export(conn: sqlite3.Connection) -> dict:
    """API 入口：生成诊断包并返回给前端展示的元信息。"""
    path = build_bundle(conn)
    return {"name": path.name, "size": path.stat().st_size, "path": str(path)}
