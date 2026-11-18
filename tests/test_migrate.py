"""便携版数据迁移。"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from tt_calendar import migrate


def _make_db(path: Path, title: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE events (id INTEGER PRIMARY KEY, title TEXT)")
        conn.execute("INSERT INTO events (title) VALUES (?)", (title,))
        conn.commit()


def test_copies_legacy_db_once(tmp_path, monkeypatch):
    legacy_root = tmp_path / "legacy"
    _make_db(legacy_root / "data" / "calendar.db", "旧日程")
    home = tmp_path / "home"
    (home / "data").mkdir(parents=True)
    monkeypatch.setattr(migrate, "PROJECT_ROOT", legacy_root)

    assert migrate.import_legacy_data(home) is True
    with sqlite3.connect(home / "data" / "calendar.db") as conn:
        assert conn.execute("SELECT title FROM events").fetchone() == ("旧日程",)
    # 第二次不再覆盖
    assert migrate.import_legacy_data(home) is False


def test_does_not_overwrite_existing(tmp_path, monkeypatch):
    legacy_root = tmp_path / "legacy"
    _make_db(legacy_root / "data" / "calendar.db", "旧")
    home = tmp_path / "home"
    _make_db(home / "data" / "calendar.db", "新")
    monkeypatch.setattr(migrate, "PROJECT_ROOT", legacy_root)

    assert migrate.import_legacy_data(home) is False
    with sqlite3.connect(home / "data" / "calendar.db") as conn:
        assert conn.execute("SELECT title FROM events").fetchone() == ("新",)


def test_no_legacy_returns_false(tmp_path, monkeypatch):
    monkeypatch.setattr(migrate, "PROJECT_ROOT", tmp_path / "nowhere")
    assert migrate.import_legacy_data(tmp_path / "home") is False


def test_copies_user_config(tmp_path, monkeypatch):
    legacy_root = tmp_path / "legacy"
    _make_db(legacy_root / "data" / "calendar.db", "x")
    (legacy_root / "data" / "user_config.json").write_text('{"lang":"en"}', encoding="utf-8")
    home = tmp_path / "home"
    monkeypatch.setattr(migrate, "PROJECT_ROOT", legacy_root)

    assert migrate.import_legacy_data(home) is True
    assert (home / "data" / "user_config.json").read_text(encoding="utf-8") == '{"lang":"en"}'


def test_copies_legacy_plugins_once(tmp_path, monkeypatch):
    legacy_root = tmp_path / "legacy"
    plugins = legacy_root / "plugins"
    plugins.mkdir(parents=True)
    (plugins / "investing.py").write_text("# plugin", encoding="utf-8")
    (plugins / "_README.md").write_text("x", encoding="utf-8")
    target = tmp_path / "home" / "plugins"
    monkeypatch.setattr(migrate, "PROJECT_ROOT", legacy_root)
    monkeypatch.setattr(migrate, "PLUGINS_DIR", target)

    assert migrate.import_legacy_plugins() == 1
    assert (target / "investing.py").read_text(encoding="utf-8") == "# plugin"
    assert not (target / "_README.md").exists()
    assert migrate.import_legacy_plugins() == 0
