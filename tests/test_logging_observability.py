"""日志可落地 + 迁移失败不再静默。

问题不在于「少了句 log」，而在于整条链路根本没有出口：打包后后端由 launcher
以 GUI 方式拉起，stderr 用户看不见，而全仓没有任何 logging handler 配置——
db.py 里的 log.warning 只走了 logging 的 lastResort，等于写进虚空。整个迁移
中断时用户数据留在旧格式、应用照常启动，事后完全无从察觉。

因此这里断言两件真正重要的事：日志有落到磁盘的出口；迁移失败会留下 ERROR
级别、带 traceback 的记录。
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import deps  # noqa: E402
from backend import main as backend_main  # noqa: E402
from tt_calendar import config as cfg  # noqa: E402
from tt_calendar import db  # noqa: E402


@pytest.fixture
def clean_root(monkeypatch):
    """重置幂等标记并摘掉 root handler，让每个用例都真正走到配置逻辑。

    必须重置标记：_configure_logging 靠模块级 flag 幂等（而非检查 root 有无
    handler——那会被 uvicorn 等库抢先 basicConfig 掉），不重置就只跑一次。
    """
    root = logging.getLogger()
    saved = root.handlers[:]
    saved_level = root.level
    root.handlers.clear()
    monkeypatch.setattr(backend_main, "_logging_ready", False)
    try:
        yield root
    finally:
        for h in root.handlers[:]:
            root.removeHandler(h)
        for h in saved:
            root.addHandler(h)
        root.setLevel(saved_level)


def test_configure_logging_writes_a_file(clean_root, tmp_path, monkeypatch) -> None:
    """必须有真实落盘的 handler，否则日志无处可去。"""
    monkeypatch.setattr(cfg, "DATA_DIR", tmp_path / "data")
    backend_main._configure_logging()

    log_file = tmp_path / "data" / "backend.log"
    logging.getLogger("t").info("hello-from-backend")
    for h in clean_root.handlers:
        h.flush()

    assert log_file.exists(), "未生成 backend.log，日志没有出口"
    assert "hello-from-backend" in log_file.read_text(encoding="utf-8")


def test_configure_logging_is_idempotent(clean_root, tmp_path, monkeypatch) -> None:
    """重复调用不应叠加 handler，否则一次启动写多份。"""
    monkeypatch.setattr(cfg, "DATA_DIR", tmp_path / "data")
    backend_main._configure_logging()
    n = len(clean_root.handlers)
    backend_main._configure_logging()
    assert len(clean_root.handlers) == n


def test_unwritable_log_dir_does_not_break_startup(clean_root, tmp_path, monkeypatch) -> None:
    """日志写不了也不能拦住启动——否则可观测性改造本身成了故障源。"""
    blocker = tmp_path / "blocker"
    blocker.write_text("not a dir", encoding="utf-8")
    monkeypatch.setattr(cfg, "DATA_DIR", blocker / "data")

    backend_main._configure_logging()  # 不得抛
    logging.getLogger("t").info("still alive")


def test_migration_failure_is_logged_not_swallowed(monkeypatch, caplog) -> None:
    """整个迁移中断必须留下 ERROR + traceback，且不能拦住启动。"""
    calls = {"n": 0}

    def boom(conn):
        calls["n"] += 1
        raise RuntimeError("legacy json corrupt")

    monkeypatch.setattr(db, "migrate_legacy_json", boom)
    monkeypatch.setattr(db, "connect", lambda: _FakeConn())
    monkeypatch.setattr(db, "init_db", lambda conn: None)
    monkeypatch.setattr(deps, "ensure_sync_schema", lambda conn: None)
    monkeypatch.setattr(db, "ensure_default_layer_configs", lambda conn: None)
    monkeypatch.setattr(db, "ensure_todo_layer", lambda conn: None)
    monkeypatch.setattr(db, "ensure_todo_done_layer", lambda conn: None)

    with caplog.at_level(logging.ERROR):
        conn = deps.connect_db()

    assert conn is not None, "迁移失败不应拦住启动"
    assert calls["n"] == 1
    assert any(r.levelno >= logging.ERROR for r in caplog.records), \
        "迁移失败未留下 ERROR 记录"
    assert any("legacy json corrupt" in r.getMessage() or r.exc_info
               for r in caplog.records), "记录里应能看出失败原因/traceback"


class _FakeConn:
    def close(self):
        pass
