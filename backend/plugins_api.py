"""插件市场：从官方 registry 拉取、校验、安装、卸载。

安全边界：
- 只接受官方仓库的地址（GitHub raw 及其镜像）；
- 文件名白名单、大小上限、sha256 必须匹配；
- 安装前在临时文件上试导入，确认能注册出对应 source_id；
- 卸载只删 registry 里登记过、且确实位于 plugins 目录内的文件。

网络：raw.githubusercontent.com 在境内大面积不可达（20261120 用户实测老 Win10 上
GitHub 全站打不开，但 CDN 镜像能开）。所以 registry 与插件文件都按「官方 → jsDelivr
→ 第三方代理」的顺序多源取，先成功的胜出；内容仍走 sha256 校验，镜像被篡改也装不上。
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
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import httpx

from tt_calendar import config as app_config
from tt_calendar.sources import reload_plugins
from tt_calendar.sources.base import collect_sources

log = logging.getLogger(__name__)

REPO_OWNER = "TTDiang2"
REPO_NAME = "TT_Calendar_Plugins"
REPO_BRANCH = "main"
REPO_PATH = f"{REPO_OWNER}/{REPO_NAME}"
RAW_PREFIX = f"https://raw.githubusercontent.com/{REPO_PATH}/"

REGISTRY_URL = f"{RAW_PREFIX}{REPO_BRANCH}/registry.json"
ALLOWED_URL_PREFIX = RAW_PREFIX
CACHE_NAME = "plugin_registry.json"
CACHE_TTL = 6 * 3600
MAX_PLUGIN_BYTES = 2 * 1024 * 1024
PLUGIN_FILE_RE = re.compile(r"^[a-z0-9_]+\.py$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def _mirror_urls(url: str) -> list[str]:
    """把 GitHub raw 地址展开成「官方 + 境内可用镜像」的候选列表。

    jsDelivr 有 GitHub 仓库的完整镜像（同一份文件、带 CDN 缓存），境内通常直连；
    ghfast.top 是一层公共反代，作为最后兜底——它不稳定，但总比彻底装不上好。
    非官方仓库的地址原样返回，不做任何改写。
    """
    if not url.startswith(RAW_PREFIX):
        return [url]
    suffix = url[len(RAW_PREFIX) :]
    parts = suffix.split("/", 1)
    if len(parts) != 2:
        return [url]
    branch, path = parts
    return [
        url,
        f"https://cdn.jsdelivr.net/gh/{REPO_PATH}@{branch}/{path}",
        f"https://ghfast.top/{url}",
    ]


def _registry_urls() -> list[str]:
    return _mirror_urls(REGISTRY_URL)


def _get_first(urls: list[str], timeout: float) -> bytes:
    """并发打所有候选地址，谁先回来用谁。

    串行会在「GitHub 被黑洞掉」时先干等一个超时；并发把总耗时压到单个超时的量级。
    shutdown(wait=False) 是必须的：否则 with 退出时会等所有线程跑完，等于白并发。
    """
    if not urls:
        raise ValueError("没有可用的下载地址")
    if len(urls) == 1:
        return _http_get(urls[0], timeout)
    pool = ThreadPoolExecutor(max_workers=len(urls))
    futures = [pool.submit(_http_get, u, timeout) for u in urls]
    try:
        # as_completed 才是真的「先到先用」；按列表顺序 result() 会先干等官方地址超时。
        for fut in as_completed(futures):
            try:
                data = fut.result()
            except Exception:
                continue
            if data:
                return data
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    raise ValueError(f"所有下载地址都失败：{', '.join(urls)}")


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
        # registry 只有几 KB，4 秒拿不到基本就是网络到不了 GitHub 及其镜像。
        # 之前用默认 10 秒，设置页会白转十秒才给「离线」提示，体感像卡死。
        raw = _get_first(_registry_urls(), timeout=4.0)
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


def _fresh_entry(source_id: str, stale: dict[str, Any]) -> dict[str, Any] | None:
    """强制刷新 registry，拿同一插件的新条目；指纹没变则返回 None。

    为什么要这一步：registry 缓存 6 小时，而插件源随时会更新。用户上午点过
    「检查」留下旧缓存，下午维护者推了新插件，此时拿旧 sha256 去校验下载回来的
    新文件必然失败，报「sha256 校验失败（registry 声明与实际文件不一致）」——
    看着像被篡改，实际只是缓存过期。这里刷新一次再重试，自愈。
    """
    old_sha = stale.get("sha256")
    for entry in _entries(fetch_registry(force=True)):
        if entry.get("source_id") != source_id:
            continue
        new_sha = entry.get("sha256")
        if new_sha and new_sha != old_sha:
            return entry
    return None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _normalize_newlines(data: bytes) -> bytes:
    """统一成 LF 落盘。

    Python 读 .py 时本来就走 universal newlines，CRLF 没有任何好处；
    统一成 LF 后，同一份文件在不同机器上的 sha 才稳定可比。
    """
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def _newline_variants(data: bytes) -> list[bytes]:
    """同一份文本的三种换行形态。

    registry 的 sha256/size 是在 Windows 上用 CRLF 文件算的，而 GitHub raw 取回来是 LF
    （20261120 实测：investing.py 声明 32847B/5b66a1…，实际下载 32045B/a1007d…，
    820 行差 802 字节——正好是行数）。只比对一种形态会让所有插件都装不上，
    而三种形态都试并不会削弱校验强度：内容等价，只是行尾不同。
    """
    lf = _normalize_newlines(data)
    return [lf, lf.replace(b"\n", b"\r\n")]


def _matches_expected(blob: bytes, expected_sha: str | None, expected_size: int | None) -> bool:
    if not expected_sha:
        return True
    for variant in _newline_variants(blob):
        if expected_size is not None and len(variant) != expected_size:
            continue
        if hashlib.sha256(variant).hexdigest() == expected_sha:
            return True
    return False


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


def _load_module_source_ids(tmp_path: Path) -> list[str]:
    """把临时文件当模块加载，返回它注册出的 source_id（不落盘、不进 sys.modules）。"""
    module_name = f"tt_plugin_verify_{int(time.time() * 1000)}"
    spec = importlib.util.spec_from_file_location(module_name, tmp_path)
    if spec is None or spec.loader is None:
        raise ValueError("无法加载插件文件")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
        return sorted({cls.source_id for cls in collect_sources(module)})
    except Exception as e:
        raise ValueError(f"插件导入失败：{e}") from e
    finally:
        sys.modules.pop(module_name, None)


def _verify_import(tmp_path: Path, source_id: str) -> None:
    """在临时文件上试导入，确认它能注册出 registry 声明的 source_id。"""
    if source_id not in _load_module_source_ids(tmp_path):
        raise ValueError("插件没有注册 registry 中声明的 source_id")


def _install(entry: dict[str, Any], _retry: bool = True) -> dict[str, Any]:
    source_id = str(entry.get("source_id") or "")
    file_name = _validate_entry(entry)
    target = _plugin_path(file_name)

    try:
        data = _get_first(_mirror_urls(str(entry["url"])), timeout=15.0)
    except Exception as e:
        raise ValueError(f"插件下载失败（官方与镜像均不可达）：{e}") from e
    if len(data) == 0:
        raise ValueError("插件下载为空")
    if len(data) > MAX_PLUGIN_BYTES:
        raise ValueError("插件超过 2 MB 上限")
    # 落盘统一 LF：既能压掉 CRLF/LF 带来的假校验失败，也让不同机器的 local_sha 可比。
    blob = _normalize_newlines(data)
    expected_size = entry.get("size") if isinstance(entry.get("size"), int) else None
    if not _matches_expected(blob, entry.get("sha256"), expected_size):
        # 指纹不符先怀疑缓存过期（插件源已更新），刷新一次再试；仍不符才判失败。
        fresh = _fresh_entry(source_id, entry) if _retry else None
        if fresh is not None:
            log.info("plugin registry stale for %s, retrying with fresh entry", source_id)
            return _install(fresh, _retry=False)
        raise ValueError("插件 sha256 校验失败（registry 声明与实际文件不一致）")
    digest = hashlib.sha256(blob).hexdigest()

    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target.with_name(f"_verify_{os.getpid()}_{time.time_ns()}.py")
    try:
        tmp_path.write_bytes(blob)
        _verify_import(tmp_path, source_id)
        os.replace(tmp_path, target)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise

    reload_plugins()
    log.info("plugin installed: %s (%s)", source_id, file_name)
    return {"ok": True, "source_id": source_id, "installed_sha": digest}


def install_from_upload(file_name: str, data: bytes) -> dict[str, Any]:
    """从用户本地的 .py 文件安装插件。

    存在的意义：插件源在 GitHub，网络到不了的时候市场整个不可用；而插件本身
    就是一个几十 KB 的 Python 文件，让用户从别人那儿拷一个过来直接装，
    比让他先解决网络问题现实得多。

    安全上不比市场宽松：文件名白名单、大小上限、落盘前必须试导入成功。
    """
    # 上传的文件名来自客户端，不能只取 basename 了事：带目录分隔符的直接拒绝，
    # 免得把「../x.py」这种输入当成合法请求（虽然 basename 后确实落在白名单里）。
    if "/" in file_name or "\\" in file_name:
        raise ValueError("插件文件名不能包含路径分隔符")
    name = Path(file_name).name
    if not PLUGIN_FILE_RE.match(name):
        raise ValueError("插件文件名只能是 [a-z0-9_].py 形式")
    if not data:
        raise ValueError("插件文件为空")
    if len(data) > MAX_PLUGIN_BYTES:
        raise ValueError("插件超过 2 MB 上限")
    target = _plugin_path(name)
    tmp_path = target.with_name(f"_verify_{os.getpid()}_{time.time_ns()}.py")
    blob = _normalize_newlines(data)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp_path.write_bytes(blob)
        ids = _load_module_source_ids(tmp_path)
        if not ids:
            raise ValueError("插件没有注册任何数据源（缺少 Source 子类）")
        os.replace(tmp_path, target)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    reload_plugins()
    log.info("plugin installed from file: %s (%s)", name, ", ".join(ids))
    return {"ok": True, "source_id": ids[0], "source_ids": ids, "file": name}


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
        expected_size = entry.get("size") if isinstance(entry.get("size"), int) else None
        # 用换行无关的比较：否则本地存的 LF 文件永远对不上 registry 里的 CRLF 哈希，
        # 每个插件都会显示成「本地已修改 / 可更新」。
        same = bool(installed and _matches_expected(path.read_bytes(), expected, expected_size))
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
                "update_available": bool(installed and expected and not same),
                "local_modified": bool(installed and expected and not same),
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
