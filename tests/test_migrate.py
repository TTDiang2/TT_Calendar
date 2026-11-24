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


def _make_empty_db(path: Path) -> None:
    """模拟安装版首次启动建出来的空库：schema 在、layer_config 有 seed，但没用户数据。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE layer_config (layer_id TEXT PRIMARY KEY)")
        conn.execute("CREATE TABLE todo (id TEXT PRIMARY KEY, title TEXT)")
        conn.execute("CREATE TABLE schedule_items (id TEXT PRIMARY KEY, title TEXT)")
        conn.execute("INSERT INTO layer_config (layer_id) VALUES ('important')")
        conn.commit()


def test_imports_into_empty_but_existing_target(tmp_path, monkeypatch):
    """空库文件已经存在也要迁移——2.4.0 之后老用户升上来丢数据就是这个原因。"""
    legacy_root = tmp_path / "legacy"
    _make_db(legacy_root / "data" / "calendar.db", "旧日程")
    home = tmp_path / "home"
    _make_empty_db(home / "data" / "calendar.db")
    monkeypatch.setattr(migrate, "PROJECT_ROOT", legacy_root)

    assert migrate.import_legacy_data(home) is True
    with sqlite3.connect(home / "data" / "calendar.db") as conn:
        assert conn.execute("SELECT title FROM events").fetchone() == ("旧日程",)


def test_backs_up_empty_target_before_overwriting(tmp_path, monkeypatch):
    legacy_root = tmp_path / "legacy"
    _make_db(legacy_root / "data" / "calendar.db", "旧")
    home = tmp_path / "home"
    _make_empty_db(home / "data" / "calendar.db")
    monkeypatch.setattr(migrate, "PROJECT_ROOT", legacy_root)

    assert migrate.import_legacy_data(home) is True
    saved = list((home / "backups").glob("calendar-before-import-*.db"))
    assert len(saved) == 1
    with sqlite3.connect(saved[0]) as conn:
        # 备份的是被覆盖前的空库，不是旧数据
        assert conn.execute("SELECT COUNT(*) FROM todo").fetchone() == (0,)


def test_stale_wal_is_dropped_on_overwrite(tmp_path, monkeypatch):
    """旧库的 -wal 留着会被新库重放，把刚导进来的数据改回去。"""
    legacy_root = tmp_path / "legacy"
    _make_db(legacy_root / "data" / "calendar.db", "旧")
    home = tmp_path / "home"
    target = home / "data" / "calendar.db"
    _make_empty_db(target)
    target.with_name(target.name + "-wal").write_bytes(b"stale wal")
    target.with_name(target.name + "-shm").write_bytes(b"stale shm")
    monkeypatch.setattr(migrate, "PROJECT_ROOT", legacy_root)

    assert migrate.import_legacy_data(home) is True
    assert not target.with_name(target.name + "-wal").exists()
    assert not target.with_name(target.name + "-shm").exists()
    with sqlite3.connect(target) as conn:
        assert conn.execute("SELECT title FROM events").fetchone() == ("旧",)


def test_has_user_data_treats_broken_db_as_having_data(tmp_path):
    """打不开的库一律当"有数据"，宁可不迁也不能覆盖。"""
    broken = tmp_path / "broken.db"
    broken.write_bytes(b"this is not a sqlite file at all" * 100)
    assert migrate._has_user_data(broken) is True
