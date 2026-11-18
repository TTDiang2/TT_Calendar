"""首次启动状态、旧库校验与 pending 导入。"""

from __future__ import annotations

import sqlite3

import pytest

from tt_calendar import db, onboarding


def _make_db(path, title: str | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        db.init_db(conn)
        if title is not None:
            conn.execute(
                "INSERT INTO events(layer_id, source, date, title) VALUES (?,?,?,?)",
                ("test", "manual", "2026-01-01", title),
            )
        conn.commit()
    finally:
        conn.close()


def _titles(path) -> list[str]:
    conn = sqlite3.connect(path)
    try:
        return [r[0] for r in conn.execute("SELECT title FROM events ORDER BY id")]
    finally:
        conn.close()


def test_first_run_then_complete(tmp_path):
    dbfile = tmp_path / "data" / "calendar.db"
    _make_db(dbfile)
    conn = sqlite3.connect(dbfile)
    try:
        assert onboarding.status(conn, home=tmp_path)["first_run"] is True
        onboarding.mark_initialized(tmp_path)
        assert onboarding.status(conn, home=tmp_path)["first_run"] is False
    finally:
        conn.close()


def test_existing_data_skips_onboarding(tmp_path):
    dbfile = tmp_path / "data" / "calendar.db"
    _make_db(dbfile, title="旧事件")
    conn = sqlite3.connect(dbfile)
    try:
        assert onboarding.status(conn, home=tmp_path)["first_run"] is False
    finally:
        conn.close()


def test_import_rejects_non_sqlite(tmp_path):
    with pytest.raises(ValueError, match="SQLite"):
        onboarding.save_import(b"not a database", home=tmp_path)


def test_import_rejects_missing_events_table(tmp_path):
    src = tmp_path / "other.db"
    conn = sqlite3.connect(src)
    conn.execute("CREATE TABLE something(id INTEGER)")
    conn.commit()
    conn.close()
    with pytest.raises(ValueError, match="events"):
        onboarding.save_import(src.read_bytes(), home=tmp_path)


def test_pending_import_replaces_db_and_keeps_backup(tmp_path):
    home = tmp_path / "home"
    target = home / "data" / "calendar.db"
    backups = home / "backups"
    _make_db(target, title="当前数据")

    incoming = tmp_path / "incoming.db"
    _make_db(incoming, title="导入数据")
    pending = onboarding.save_import(incoming.read_bytes(), home=home)
    assert pending.is_file()

    assert onboarding.apply_pending_import(home=home, db_path=target, backup_dir=backups) is True

    assert _titles(target) == ["导入数据"]
    assert not pending.exists()
    assert onboarding.is_initialized(home)
    saved = list(backups.glob("pre-import-*.db"))
    assert len(saved) == 1
    assert _titles(saved[0]) == ["当前数据"]


def test_invalid_pending_is_discarded(tmp_path):
    home = tmp_path / "home"
    pending = home / "data" / onboarding.PENDING_NAME
    pending.parent.mkdir(parents=True, exist_ok=True)
    pending.write_bytes(b"broken")
    target = home / "data" / "calendar.db"
    _make_db(target, title="保留")

    assert onboarding.apply_pending_import(home=home, db_path=target, backup_dir=home / "backups") is False
    assert not pending.exists()
    assert _titles(target) == ["保留"]
