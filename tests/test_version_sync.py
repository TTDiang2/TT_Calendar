"""版本号单一来源。"""

from __future__ import annotations

import json

import pytest

from scripts.sync_version import read_version, sync


def _fixture_root(tmp_path):
    (tmp_path / "frontend" / "src-tauri").mkdir(parents=True)
    (tmp_path / "tt_calendar").mkdir()
    (tmp_path / "version.json").write_text('{"version": "2.4.0"}', encoding="utf-8")
    (tmp_path / "frontend" / "src-tauri" / "tauri.conf.json").write_text(
        '{\n  "productName": "TT Calendar",\n  "version": "2.3.0"\n}\n', encoding="utf-8"
    )
    (tmp_path / "frontend" / "package.json").write_text(
        '{\n  "name": "x",\n  "version": "0.1.0"\n}\n', encoding="utf-8"
    )
    (tmp_path / "frontend" / "src-tauri" / "Cargo.toml").write_text(
        '[package]\nname = "app"\nversion = "2.3.0"\n\n[dependencies]\nserde = { version = "1.0" }\n',
        encoding="utf-8",
    )
    return tmp_path


def test_sync_updates_all_targets(tmp_path):
    root = _fixture_root(tmp_path)
    assert sync(root) == "2.4.0"

    conf = json.loads((root / "frontend" / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))
    assert conf["version"] == "2.4.0"
    assert conf["productName"] == "TT Calendar"

    pkg = json.loads((root / "frontend" / "package.json").read_text(encoding="utf-8"))
    assert pkg["version"] == "2.4.0"

    cargo = (root / "frontend" / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8")
    assert 'version = "2.4.0"' in cargo
    assert 'serde = { version = "1.0" }' in cargo  # 依赖版本不能被改

    build = (root / "tt_calendar" / "_build_version.py").read_text(encoding="utf-8")
    assert '__version__ = "2.4.0"' in build


def test_sync_is_idempotent(tmp_path):
    root = _fixture_root(tmp_path)
    sync(root)
    first = (root / "frontend" / "src-tauri" / "tauri.conf.json").read_bytes()
    sync(root)
    assert (root / "frontend" / "src-tauri" / "tauri.conf.json").read_bytes() == first


def test_invalid_version_rejected(tmp_path):
    root = _fixture_root(tmp_path)
    (root / "version.json").write_text('{"version": "2.4"}', encoding="utf-8")
    with pytest.raises(ValueError):
        read_version(root)
