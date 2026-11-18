"""诊断包：内容白名单、计数、凭据脱敏。"""

from __future__ import annotations

import json
import sqlite3
import zipfile

from backend import diagnostics


def _make_db(tmp_path):
    db = tmp_path / "data" / "calendar.db"
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE events (id INTEGER PRIMARY KEY, title TEXT)")
    conn.execute("CREATE TABLE todo (id INTEGER PRIMARY KEY)")
    conn.execute("INSERT INTO events (title) VALUES ('a'), ('b')")
    conn.commit()
    return conn


def test_bundle_contains_only_whitelisted_files(tmp_path):
    conn = _make_db(tmp_path)
    (tmp_path / "data" / "user_config.json").write_text('{"token": "super-secret"}', encoding="utf-8")
    (tmp_path / "data" / "backend.log").write_text("started\n", encoding="utf-8")

    path = diagnostics.build_bundle(conn, home=tmp_path, data_dir=tmp_path / "data")

    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
    assert names == {"README.txt", "version.json", "system.json", "logs/backend.log"}
    assert not any(name.endswith(("calendar.db", "user_config.json")) for name in names)


def test_system_json_records_counts_and_paths(tmp_path):
    conn = _make_db(tmp_path)
    path = diagnostics.build_bundle(conn, home=tmp_path, data_dir=tmp_path / "data")

    with zipfile.ZipFile(path) as archive:
        system = json.loads(archive.read("system.json"))

    assert system["database"]["counts"]["events"] == 2
    assert system["database"]["counts"]["todo"] == 0
    assert system["database"]["counts"]["coloring"] == -1
    assert system["paths"]["data_dir"] == str(tmp_path / "data")
    assert system["app"]["version"]


def test_logs_redact_tokens_and_passwords(tmp_path):
    conn = _make_db(tmp_path)
    log = tmp_path / "data" / "backend.log"
    log.write_text(
        'token=abc123\nAuthorization: Bearer eyJhbGciOi.payload.sig\n"password": "hunter2"\nnormal line\n',
        encoding="utf-8",
    )
    path = diagnostics.build_bundle(conn, home=tmp_path, data_dir=tmp_path / "data")

    with zipfile.ZipFile(path) as archive:
        text = archive.read("logs/backend.log").decode("utf-8")

    assert "abc123" not in text
    assert "hunter2" not in text
    assert "eyJhbGciOi" not in text
    assert "normal line" in text


def test_second_bundle_gets_unique_name(tmp_path):
    conn = _make_db(tmp_path)
    first = diagnostics.build_bundle(conn, home=tmp_path, data_dir=tmp_path / "data")
    second = diagnostics.build_bundle(conn, home=tmp_path, data_dir=tmp_path / "data")
    assert first != second
    assert second.exists()


def test_export_returns_metadata(tmp_path, monkeypatch):
    conn = _make_db(tmp_path)
    monkeypatch.setattr(diagnostics.app_config, "HOME", tmp_path)
    monkeypatch.setattr(diagnostics.app_config, "DATA_DIR", tmp_path / "data")

    result = diagnostics.export(conn)

    assert result["name"].endswith(".zip")
    assert result["size"] > 0
    assert result["path"].endswith(".zip")
