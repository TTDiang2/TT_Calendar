"""每日 SQLite 备份。"""

from __future__ import annotations

import sqlite3

from tt_calendar import backup


def _make_db(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE events (id INTEGER PRIMARY KEY, title TEXT)")
    conn.execute("INSERT INTO events (title) VALUES ('测试日程')")
    conn.commit()
    return conn


def test_creates_one_backup_per_day(tmp_path):
    conn = _make_db(tmp_path / "data" / "calendar.db")
    backup_dir = tmp_path / "backups"

    first = backup.daily_backup(conn, backup_dir)
    assert first is not None and first.exists()
    assert backup.daily_backup(conn, backup_dir) is None
    assert len(list(backup_dir.glob("calendar-*.db"))) == 1
    conn.close()


def test_backup_is_readable(tmp_path):
    conn = _make_db(tmp_path / "data" / "calendar.db")
    dest = backup.daily_backup(conn, tmp_path / "backups")
    conn.close()

    assert dest is not None
    with sqlite3.connect(dest) as copy:
        assert copy.execute("SELECT title FROM events").fetchone() == ("测试日程",)


def test_prunes_old_daily_backups(tmp_path):
    conn = _make_db(tmp_path / "data" / "calendar.db")
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    for day in range(1, 6):
        (backup_dir / f"calendar-2026010{day}.db").write_bytes(b"old")

    backup.daily_backup(conn, backup_dir, keep=3)
    conn.close()

    names = sorted(p.name for p in backup_dir.glob("*.db"))
    assert len(names) == 3
    assert "calendar-20260101.db" not in names
    assert "calendar-20260102.db" not in names
    assert "calendar-20260103.db" not in names


def test_manual_backup_keeps_timestamp_and_skips_prune(tmp_path):
    conn = _make_db(tmp_path / "data" / "calendar.db")
    backup_dir = tmp_path / "backups"
    for day in range(1, 6):
        backup_dir.mkdir(exist_ok=True)
        (backup_dir / f"calendar-2026010{day}.db").write_bytes(b"old")

    dest = backup.backup_now(conn, backup_dir)
    conn.close()

    assert dest.exists()
    assert dest.name.startswith("calendar-")
    assert dest.name.endswith(".db")
    assert len(list(backup_dir.glob("*.db"))) == 6
