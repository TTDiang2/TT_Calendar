"""插件市场：registry 合并、安装校验、卸载边界。"""

from __future__ import annotations

import hashlib
import json

import pytest

from backend import plugins_api
from tt_calendar import config as app_config
from tt_calendar.sources import all_source_ids, reload_plugins

PLUGIN_CODE = b"""from tt_calendar.sources.base import Source

class DemoSource(Source):
    source_id = "demo_source"
    display_name = "Demo source"

    async def fetch(self, start, end, **kw):
        return [], None
"""


def _setup(tmp_path, monkeypatch, code=PLUGIN_CODE, **overrides):
    monkeypatch.setattr(app_config, "PLUGINS_DIR", tmp_path / "plugins")
    monkeypatch.setattr(app_config, "DATA_DIR", tmp_path / "data")
    (tmp_path / "data").mkdir()
    entry = {
        "source_id": "demo_source",
        "display_name": "Demo",
        "file": "demo_source.py",
        "url": plugins_api.ALLOWED_URL_PREFIX + "demo_source.py",
        "sha256": hashlib.sha256(code).hexdigest(),
        "size": len(code),
        "protocol_version": 2,
        "group": "demo",
        "needs_internet": True,
        "layers": [{"layer_id": "demo"}],
    }
    entry.update(overrides)
    registry = {"schema_version": 1, "protocol_version": 2, "plugins": [entry]}
    registry_bytes = json.dumps(registry).encode("utf-8")

    def fake_get(url, timeout=10.0):
        if url == plugins_api.REGISTRY_URL:
            return registry_bytes
        return code

    monkeypatch.setattr(plugins_api, "_http_get", fake_get)
    reload_plugins()
    return entry


def test_list_merges_registry_and_local_state(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)

    before = plugins_api.list_plugins()
    assert before["ok"] is True
    assert before["offline"] is False
    assert before["plugins"][0]["installed"] is False
    assert before["plugins"][0]["layer_count"] == 1

    assert plugins_api.install("demo_source")["ok"] is True

    after = plugins_api.list_plugins()
    item = after["plugins"][0]
    assert item["installed"] is True
    assert item["update_available"] is False
    assert item["local_modified"] is False
    assert item["installed_sha"] == hashlib.sha256(PLUGIN_CODE).hexdigest()
    assert "demo_source" in all_source_ids()


def test_install_requires_official_url(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch, url="https://evil.example/demo_source.py")
    with pytest.raises(ValueError, match="官方仓库"):
        plugins_api.install("demo_source")
    assert not (tmp_path / "plugins" / "demo_source.py").exists()


def test_install_rejects_sha_mismatch(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch, sha256="0" * 64)
    with pytest.raises(ValueError, match="sha256"):
        plugins_api.install("demo_source")
    assert not (tmp_path / "plugins" / "demo_source.py").exists()


def test_install_rejects_path_traversal(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch, file="../evil.py")
    with pytest.raises(ValueError, match="文件名"):
        plugins_api.install("demo_source")


def test_install_rejects_oversized_plugin(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(plugins_api, "MAX_PLUGIN_BYTES", 20)
    with pytest.raises(ValueError, match="2 MB"):
        plugins_api.install("demo_source")


def test_install_rejects_wrong_source_id_and_cleans_temp(tmp_path, monkeypatch):
    other_code = PLUGIN_CODE.replace(b"demo_source", b"other_source")
    _setup(tmp_path, monkeypatch, code=other_code)
    with pytest.raises(ValueError, match="source_id"):
        plugins_api.install("demo_source")
    plugins_dir = tmp_path / "plugins"
    assert not (plugins_dir / "demo_source.py").exists()
    assert list(plugins_dir.glob("*.tmp")) == []
    assert list(plugins_dir.glob("_verify_*.py")) == []


def test_uninstall_only_registered_plugins(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    plugins_api.install("demo_source")
    plugins_api.uninstall("demo_source")
    assert not (tmp_path / "plugins" / "demo_source.py").exists()

    with pytest.raises(ValueError, match="registry"):
        plugins_api.uninstall("not_in_registry")


def test_offline_falls_back_to_cache(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    plugins_api.fetch_registry()

    def offline(url, timeout=10.0):
        raise OSError("network down")

    monkeypatch.setattr(plugins_api, "_http_get", offline)
    cached = plugins_api.fetch_registry(force=True)
    assert cached is not None
    assert cached["plugins"][0]["source_id"] == "demo_source"
