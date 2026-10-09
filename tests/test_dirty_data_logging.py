"""脏数据必须留痕，不能静默跳过。

这些站点原先都是 `except Exception: pass`，而它们都在数据路径上：
todo 里一条脏日期会让那天的充实度色块永久缺失、订阅 config 损坏会让
last_error静默变None、两处配置损坏会让用户的调参无声重置。症状都是「看起来
正常但结果不对」，日志是唯一的线索。

所以这里断言的不只是「不抛异常」，而是「确实留下了可定位的记录」。
"""

from __future__ import annotations

import json
import logging
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import routes as R  # noqa: E402
from tt_calendar import db  # noqa: E402


@pytest.fixture
def conn() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    db.init_db(c)
    yield c
    c.close()


# ------------------------------------------------------- 脏日期 → 色块缺失


def _busy_config() -> dict:
    return dict(db.DEFAULT_TODO_BUSY_CONFIG)


def test_dirty_todo_date_is_logged_not_swallowed(conn, caplog) -> None:
    """脏 due_date 当天不会被染色，但必须在日志里点名是哪个值坏了。"""
    conn.execute(
        "INSERT INTO todo(id, list_id, title, due_date, importance, complexity) "
        "VALUES('t1','L1','脏数据','垃圾','normal','medium')"
    )
    conn.execute(
        "INSERT INTO todo(id, list_id, title, due_date, importance, complexity) "
        "VALUES('t2','L1','正常','2026-08-10','normal','medium')"
    )

    with caplog.at_level(logging.WARNING, logger="backend.routes"):
        written = R._recompute_day_busy(conn)

    assert any("脏日期" in r.getMessage() for r in caplog.records), \
        f"脏日期未记日志：{[r.getMessage() for r in caplog.records]}"
    msg = " ".join(r.getMessage() for r in caplog.records)
    assert "t1" in msg, f"日志应点名是哪个 todo 坏了：{msg}"
    assert written >= 1, "正常那条仍应被写入，不能因脏数据整体放弃"


def test_dirty_completed_at_is_logged(conn, caplog) -> None:
    conn.execute(
        "INSERT INTO todo(id, list_id, title, completed_at, importance, complexity) "
        "VALUES('t3','L1','脏完成时间','not-a-timestamp','normal','medium')"
    )
    with caplog.at_level(logging.WARNING, logger="backend.routes"):
        R._recompute_day_busy(conn)

    assert any("completed_at" in r.getMessage() for r in caplog.records), \
        "completed_at 脏值应被记录"


def test_clean_data_logs_nothing(conn, caplog) -> None:
    """正常数据不该刷警告——否则日志会被噪声淹没，真脏数据反而看不见。"""
    conn.execute(
        "INSERT INTO todo(id, list_id, title, due_date, importance, complexity) "
        "VALUES('t4','L1','正常','2026-08-10','normal','medium')"
    )
    with caplog.at_level(logging.WARNING, logger="backend.routes"):
        R._recompute_day_busy(conn)

    assert not [r for r in caplog.records if "脏日期" in r.getMessage()], \
        "干净数据不该产生脏数据告警"


# ------------------------------------------------------- 配置损坏 → 无声重置


def test_broken_busy_config_is_logged(conn, caplog) -> None:
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?,?)",
        (db.TODO_BUSY_CONFIG_KEY, "{坏掉的 JSON"),
    )
    with caplog.at_level(logging.WARNING, logger="tt_calendar.db"):
        cfg = db.get_todo_busy_config(conn)

    assert cfg == db.DEFAULT_TODO_BUSY_CONFIG, "损坏时仍应退回默认值"
    assert any("todo-busy" in r.getMessage() for r in caplog.records), \
        "配置损坏必须留痕，否则用户调参被无声重置却无从追因"


def test_broken_reminder_config_is_logged(conn, caplog) -> None:
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?,?)",
        (db.TODO_REMINDER_CONFIG_KEY, "{坏掉的 JSON"),
    )
    with caplog.at_level(logging.WARNING, logger="tt_calendar.db"):
        cfg = db.get_todo_reminder_config(conn)

    assert cfg == dict(db.DEFAULT_TODO_REMINDER_CONFIG)
    assert any("todo-reminder" in r.getMessage() for r in caplog.records)


def test_valid_busy_config_roundtrip_without_warning(conn, caplog) -> None:
    """合法配置不该被记成损坏——否则真损坏会被噪声淹没。"""
    cfg = dict(db.DEFAULT_TODO_BUSY_CONFIG)
    cfg["thresholds"] = [0, 4, 9, 16, 26]
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?,?)",
        (db.TODO_BUSY_CONFIG_KEY, json.dumps(cfg, ensure_ascii=False)),
    )
    with caplog.at_level(logging.WARNING, logger="tt_calendar.db"):
        out = db.get_todo_busy_config(conn)

    assert out["thresholds"] == [0, 4, 9, 16, 26], "合法配置应原样读回"
    assert not [r for r in caplog.records if "损坏" in r.getMessage()], \
        "合法配置不该被记为损坏"
