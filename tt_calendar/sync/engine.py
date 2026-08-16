"""同步编排：pull → 三方合并 → 写库 → push → 更新 base。

配置与状态存 meta 表（sync.* 键，DPAPI 加密 token，永不出本机）。
base 快照 = 上次同步完成时的数据形态，存 data/sync_base/snapshot.json，
是三方合并的锚点，与 provider 是否有版本机制无关。
"""

import json
import socket
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

from tt_calendar.config import DATA_DIR

from . import merge as M
from . import providers as P
from . import secrets, snapshot as S
from .providers import GitHubProvider, ProviderError

BASE_DIR = DATA_DIR / "sync_base"
BASE_FILE = BASE_DIR / "snapshot.json"

# 同步全程互斥：启动自动同步与手动「立即同步」可能并发，撞车会导致
# 两份合并结果互相覆盖。锁只在本进程内有效（sidecar 是唯一写入口，足够）。
_sync_lock = threading.Lock()


class SyncError(Exception):
    pass


class SyncBusy(SyncError):
    pass


# ---------------------------------------------------------------- 配置


def get_sync_config(conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        "SELECT value FROM meta WHERE key = 'sync.config_json'").fetchone()
    cfg = json.loads(row["value"]) if row else {}
    return {
        "provider": cfg.get("provider", "github"),
        "repo": cfg.get("repo", ""),
        "branch": cfg.get("branch", "main"),
        "token_dpapi": cfg.get("token_dpapi", ""),
        "auto_on_start": cfg.get("auto_on_start", True),
        "sync_on_close": cfg.get("sync_on_close", True),
    }


def save_sync_config(conn: sqlite3.Connection, repo: str, branch: str,
                     token: str | None, auto_on_start: bool,
                     sync_on_close: bool = True) -> None:
    cfg = get_sync_config(conn)
    cfg.update({"provider": "github", "repo": repo.strip(),
                "branch": (branch or "main").strip(),
                "auto_on_start": auto_on_start,
                "sync_on_close": sync_on_close})
    if token and token.strip():
        cfg["token_dpapi"] = secrets.protect(token.strip())
    with conn:
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('sync.config_json', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps(cfg, ensure_ascii=False),))


def _provider(conn: sqlite3.Connection) -> GitHubProvider:
    cfg = get_sync_config(conn)
    if not cfg["repo"] or not cfg["token_dpapi"]:
        raise SyncError("尚未配置同步（仓库/PAT）")
    try:
        token = secrets.unprotect(cfg["token_dpapi"])
    except OSError as e:
        raise SyncError(f"PAT 解密失败：{e}")
    return GitHubProvider(cfg["repo"], token, cfg["branch"])


def last_status(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT value FROM meta WHERE key = 'sync.last'").fetchone()
    return json.loads(row["value"]) if row else {}


def _save_status(conn: sqlite3.Connection, status: dict) -> None:
    with conn:
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('sync.last', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps(status, ensure_ascii=False),))


# ---------------------------------------------------------------- base 快照


def _load_base() -> tuple[M.Data | None, S.Tombstones]:
    if not BASE_FILE.exists():
        return None, {}
    raw = json.loads(BASE_FILE.read_text(encoding="utf-8"))
    tombs = {}
    for combined, dt in raw.get("tombstones", {}).items():
        t, k = combined.split("|", 1)
        tombs[(t, k)] = dt
    return raw.get("data"), tombs


def _save_base(data: M.Data, tombs: S.Tombstones) -> None:
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    BASE_FILE.write_text(json.dumps(
        {"data": data,
         "tombstones": {f"{t}|{k}": dt for (t, k), dt in tombs.items()}},
        ensure_ascii=False), encoding="utf-8")


def _has_base() -> bool:
    return BASE_FILE.exists()


# ---------------------------------------------------------------- 同步主流程


def sync_now(conn: sqlite3.Connection,
             on_imported=None) -> dict:
    """完整同步。返回报告 dict；首次绑定抛 NeedsDecision；失败抛 SyncError。"""
    if not _sync_lock.acquire(blocking=False):
        raise SyncBusy("同步正在进行中，请稍候")
    try:
        return _sync_now(conn, on_imported)
    except ProviderError as e:
        raise SyncError(str(e))
    finally:
        _sync_lock.release()


def _sync_now(conn: sqlite3.Connection, on_imported) -> dict:
    prov = _provider(conn)

    if not _has_base():
        remote = prov.fetch()
        if remote is None:
            n = _init_upload(conn, prov, on_imported)
            return {"result": "initialized", "pushed": n}
        raise NeedsDecision(remote_pulled=len(sum(remote.data.values(), [])))

    for attempt in (1, 2):
        remote = prov.fetch()
        if remote is None:
            raise SyncError("远端为空但本地已有同步历史；请检查数据仓库是否被误清空")

        base_data, base_tombs = _load_base()
        local = S.export_data(conn)
        local_tombs = S.export_tombstones(conn)

        result = M.merge(base_data or {}, remote.data, local,
                         base_tombs, remote.tombstones, local_tombs)
        S.import_plan(conn, result["upsert"], result["deletes"], result["tombstones"])
        if on_imported:
            on_imported(conn)

        remote_changed = (result["data"] != remote.data
                          or result["tombstones"] != remote.tombstones)
        report = dict(result["report"])
        commit_url = None
        if remote_changed:
            device = socket.gethostname()
            msg = f"sync: {device} {datetime.now():%Y-%m-%d %H:%M} " \
                  f"(pull {report['pulled']} / push {report['pushed']})"
            try:
                files = P.encode_files(result["data"], result["tombstones"], device)
                commit_url = prov.push(files, msg)
            except ProviderError as e:
                if "并发冲突" in str(e) and attempt == 1:
                    continue
                report["warning"] = f"推送失败（本地已合并）：{e}"
        _save_base(result["data"], result["tombstones"])
        S.prune_tombstones(conn)

        status = {"at": datetime.now().isoformat(timespec="seconds"),
                  "ok": True, "report": report, "commit": commit_url}
        _save_status(conn, status)
        return {"result": "ok", **report, "commit_url": commit_url}
    raise SyncError("并发冲突重试后仍失败，请稍后再试")


class NeedsDecision(Exception):
    def __init__(self, remote_pulled: int):
        self.remote_pulled = remote_pulled


def resolve_first_bind(conn: sqlite3.Connection, mode: str, on_imported=None) -> dict:
    """首次绑定二选一：pull_overwrite / merge_push。"""
    if mode not in ("pull_overwrite", "merge_push"):
        raise SyncError(f"未知模式 {mode}")
    if not _sync_lock.acquire(blocking=False):
        raise SyncBusy("同步正在进行中，请稍候")
    try:
        return _resolve_first_bind(conn, mode, on_imported)
    except ProviderError as e:
        raise SyncError(str(e))
    finally:
        _sync_lock.release()


def _resolve_first_bind(conn: sqlite3.Connection, mode: str, on_imported) -> dict:
    prov = _provider(conn)
    remote = prov.fetch()
    if remote is None:
        n = _init_upload(conn, prov, on_imported)
        return {"result": "initialized", "pushed": n}

    local = S.export_data(conn)
    local_tombs = S.export_tombstones(conn)
    result = M.first_bind_merge(mode, remote.data, local,
                                remote.tombstones, local_tombs)
    S.import_plan(conn, result["upsert"], result["deletes"], result["tombstones"])
    if on_imported:
        on_imported(conn)

    device = socket.gethostname()
    files = P.encode_files(result["data"], result["tombstones"], device)
    commit_url = prov.push(files, f"sync: first bind ({mode}) by {device}")
    _save_base(result["data"], result["tombstones"])
    S.prune_tombstones(conn)
    report = dict(result["report"])
    status = {"at": datetime.now().isoformat(timespec="seconds"),
              "ok": True, "report": report, "commit": commit_url}
    _save_status(conn, status)
    return {"result": "ok", **report, "commit_url": commit_url}


def _init_upload(conn: sqlite3.Connection, prov: GitHubProvider,
                 on_imported) -> int:
    local = S.export_data(conn)
    tombs = S.export_tombstones(conn)
    device = socket.gethostname()
    files = P.encode_files(local, tombs, device)
    prov.push(files, f"sync: init upload by {device}")
    _save_base(local, tombs)
    status = {"at": datetime.now().isoformat(timespec="seconds"),
              "ok": True, "report": {"initialized": True},
              "commit": None}
    _save_status(conn, status)
    return sum(len(v) for v in local.values())


def is_configured(conn: sqlite3.Connection) -> bool:
    cfg = get_sync_config(conn)
    return bool(cfg["repo"] and cfg["token_dpapi"])


def test_connection(conn: sqlite3.Connection) -> dict:
    return _provider(conn).test()
