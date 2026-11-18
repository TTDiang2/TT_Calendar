"""插件市场：从官方 registry 拉取、校验、安装、卸载。

安全边界：
- 只接受官方仓库 raw 地址；
- 文件名白名单、大小上限、sha256 必须匹配；
- 安装前在临时文件上试导入，确认能注册出对应 source_id；
- 卸载只删 registry 里登记过、且确实位于 plugins 目录内的文件。
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import httpx

from tt_calendar import config as app_config
from tt_calendar.sources import reload_plugins
from tt_calendar.sources.base import collect_sources

log = logging.getLogger(__name__)

REGISTRY_URL = "https://raw.githubusercontent.com/TTDiang2/TT_Calendar_Plugins/main/registry.json"
ALLOWED_URL_PREFIX = "https://raw.githubusercontent.com/TTDiang2/TT_Calendar_Plugins/"
CACHE_NAME = "plugin_registry.json"
CACHE_TTL = 6 * 3600
MAX_PLUGIN_BYTES = 2 * 1024 * 1024
PLUGIN_FILE_RE = re.compile(r"^[a-z0-9_]+\.py$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def cache_path() -> Path:
    return app_config.DATA_DIR / CACHE_NAME


def _http_get(url: str, timeout: float = 10.0) -> bytes:
    response = httpx.get(url, timeout=timeout, follow_redirects=True)
    response.raise_for_status()
    return response.content


def _read_cache() -> dict[str, Any] | None:
    path = cache_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _write_cache(data: dict[str, Any]) -> None:
    path = cache_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
    except OSError as e:
        log.warning("无法写入插件 registry 缓存：%s", e)


def _cache_age() -> float | None:
    try:
        return time.time() - cache_path().stat().st_mtime
    except OSError:
        return None


def fetch_registry(force: bool = False) -> dict[str, Any] | None:
    """拉取 registry；失败回退缓存（含过期缓存）。没有缓存返回 None。"""
    if not force:
        age = _cache_age()
        if age is not None and age < CACHE_TTL:
            cached = _read_cache()
            if cached is not None:
                return cached
    try:
        # registry 只有几 KB，4 秒拿不到基本就是网络到不了 GitHub raw。
        # 之前用默认 10 秒，设置页会白转十秒才给「离线」提示，体感像卡死。
        raw = _http_get(REGISTRY_URL, timeout=4.0)
        data = json.loads(raw)
        if not isinstance(data, dict) or not isinstance(data.get("plugins"), list):
            raise ValueError("registry 结构不合法")
    except Exception as e:
        log.warning("插件 registry 拉取失败，尝试缓存：%s", e)
        return _read_cache()
    _write_cache(data)
    return data


def _entries(registry: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not registry:
        return []
    return [entry for entry in registry.get("plugins", []) if isinstance(entry, dict)]


def _entry_for(source_id: str) -> dict[str, Any] | None:
    for entry in _entries(fetch_registry()):
        if entry.get("source_id") == source_id:
            return entry
    return None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_entry(entry: dict[str, Any]) -> str:
    """校验 registry 条目，返回文件名；不合法抛 ValueError。"""
    url = entry.get("url")
    if not isinstance(url, str) or not url.startswith(ALLOWED_URL_PREFIX):
        raise ValueError("插件下载地址不在官方仓库范围内")
    file_name = entry.get("file")
    if not isinstance(file_name, str) or not PLUGIN_FILE_RE.match(file_name):
        raise ValueError("插件文件名不合法")
    digest = entry.get("sha256")
    if not isinstance(digest, str) or not SHA256_RE.match(digest):
        raise ValueError("插件 sha256 不合法")
    size = entry.get("size")
    if isinstance(size, int) and size > MAX_PLUGIN_BYTES:
        raise ValueError("插件超过 2 MB 上限")
    return file_name


def _plugin_path(file_name: str) -> Path:
    root = app_config.PLUGINS_DIR.resolve()
    target = (root / file_name).resolve()
    if target.parent != root:
        raise ValueError("插件路径越界")
    return target


def _verify_import(tmp_path: Path, source_id: str) -> None:
    """在临时文件上试导入，确认它能注册出 registry 声明的 source_id。"""
    module_name = f"tt_plugin_verify_{int(time.time() * 1000)}"
    spec = importlib.util.spec_from_file_location(module_name, tmp_path)
    if spec is None or spec.loader is None:
        raise ValueError("无法加载插件文件")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
        found = {cls.source_id for cls in collect_sources(module)}
    except Exception as e:
        raise ValueError(f"插件导入失败：{e}") from e
    finally:
        sys.modules.pop(module_name, None)
    if source_id not in found:
        raise ValueError("插件没有注册 registry 中声明的 source_id")


def _install(entry: dict[str, Any]) -> dict[str, Any]:
    source_id = str(entry.get("source_id") or "")
    file_name = _validate_entry(entry)
    target = _plugin_path(file_name)

    try:
        data = _http_get(str(entry["url"]), timeout=30.0)
    except Exception as e:
        raise ValueError(f"插件下载失败：{e}") from e
    if len(data) == 0:
        raise ValueError("插件下载为空")
    if len(data) > MAX_PLUGIN_BYTES:
        raise ValueError("插件超过 2 MB 上限")
    expected_size = entry.get("size")
    if isinstance(expected_size, int) and expected_size != len(data):
        raise ValueError("插件大小与 registry 不一致")
    digest = hashlib.sha256(data).hexdigest()
    if digest != entry.get("sha256"):
        raise ValueError("插件 sha256 校验失败")

    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target.with_name(f"_verify_{os.getpid()}_{time.time_ns()}.py")
    try:
        tmp_path.write_bytes(data)
        _verify_import(tmp_path, source_id)
        os.replace(tmp_path, target)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise

    reload_plugins()
    log.info("plugin installed: %s (%s)", source_id, file_name)
    return {"ok": True, "source_id": source_id, "installed_sha": digest}


def install(source_id: str) -> dict[str, Any]:
    if not source_id:
        raise ValueError("缺少 source_id")
    entry = _entry_for(source_id)
    if entry is None:
        raise ValueError("registry 中没有这个插件")
    return _install(entry)


def uninstall(source_id: str) -> dict[str, Any]:
    entry = _entry_for(source_id)
    if entry is None:
        raise ValueError("registry 中没有这个插件，拒绝删除")
    file_name = _validate_entry(entry)
    target = _plugin_path(file_name)
    if not target.exists():
        raise ValueError("插件尚未安装")
    target.unlink()
    reload_plugins()
    log.info("plugin removed: %s (%s)", source_id, file_name)
    return {"ok": True, "source_id": source_id}


def list_plugins() -> dict[str, Any]:
    registry = fetch_registry()
    if registry is None:
        return {
            "ok": False,
            "offline": True,
            "error": "offline",
            "plugins": [],
            "registry_url": REGISTRY_URL,
        }

    items: list[dict[str, Any]] = []
    for entry in _entries(registry):
        source_id = entry.get("source_id")
        file_name = entry.get("file")
        if not isinstance(source_id, str) or not isinstance(file_name, str) or not PLUGIN_FILE_RE.match(file_name):
            continue
        path = _plugin_path(file_name)
        installed = path.is_file()
        local_sha = _sha256(path) if installed else None
        expected = entry.get("sha256")
        layers = entry.get("layers")
        items.append(
            {
                "source_id": source_id,
                "display_name": entry.get("display_name") or source_id,
                "group": entry.get("group") or "",
                "needs_internet": bool(entry.get("needs_internet")),
                "file": file_name,
                "size": entry.get("size") if isinstance(entry.get("size"), int) else None,
                "layer_count": len(layers) if isinstance(layers, list) else 0,
                "installed": installed,
                "installed_sha": local_sha,
                "update_available": bool(installed and expected and local_sha != expected),
                "local_modified": bool(installed and expected and local_sha != expected),
            }
        )
    return {
        "ok": True,
        "offline": False,
        "plugins": items,
        "registry_url": REGISTRY_URL,
        "cache_age_seconds": _cache_age(),
    }


def reload_all() -> dict[str, Any]:
    reload_plugins()
    from tt_calendar.sources import all_source_ids

    return {"ok": True, "source_ids": sorted(all_source_ids())}
