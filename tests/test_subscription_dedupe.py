"""重复订阅合并（旧版 builtin:jisilu 反复播种的兜底）。"""

from __future__ import annotations

import json
import sqlite3

import pytest

from tt_calendar import db

ORIGINAL_ID = "b3fea9b8-620c-47da-bc4b-ac5082999c1d"
DUPLICATE_ID = "903946f2-ccb9-4171-b705-6a5dd78bfd5c"
LATEST_ID = "46a1fbaf-2aca-46ce-afa3-537092654552"


@pytest.fixture
def conn() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    db.init_db(c)
    yield c
    c.close()


def add_subscription(
    conn: sqlite3.Connection,
    sub_id: str,
    source_key: str = "jisilu",
    *,
    enabled: int = 1,
    auto_update: int = 1,
    status: str = "active",
    last_synced_at: str | None = None,
    config_json: str | None = None,
    created_at: str = "2026-08-23 17:44:07",
) -> None:
    conn.execute(
        "INSERT INTO subscriptions(id, display_name, source_key, enabled, auto_update, "
        "status, last_synced_at, config_json, created_at) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (
            sub_id,
            "集思录",
            source_key,
            enabled,
            auto_update,
            status,
            last_synced_at,
            config_json,
            created_at,
        ),
    )
    conn.commit()


def subscriptions(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM subscriptions ORDER BY created_at, id"
    ).fetchall()


def test_keeps_oldest_and_merges_flags_config(conn: sqlite3.Connection) -> None:
    add_subscription(
        conn,
        ORIGINAL_ID,
        status="active",
        last_synced_at="2026-11-17 13:07:39",
        config_json="{}",
    )
    add_subscription(
        conn,
        DUPLICATE_ID,
        enabled=0,
        auto_update=0,
        status="error",
        last_synced_at="2026-11-17 13:07:06",
        config_json=json.dumps({"last_error": "getaddrinfo failed"}),
        created_at="2026-11-16 13:24:00",
    )
    add_subscription(
        conn,
        LATEST_ID,
        status="error",
        last_synced_at="2026-11-18 09:00:00",
        config_json=json.dumps({"last_error": "dns", "keep_me": 1}),
        created_at="2026-11-17 09:55:20",
    )

    assert db.dedupe_subscriptions(conn) == 2

    rows = subscriptions(conn)
    assert len(rows) == 1
    kept = rows[0]
    assert kept["id"] == ORIGINAL_ID, "必须保留最早创建的那条"
    assert kept["status"] == "active", "任意一条 active 即视为已恢复"
    assert kept["enabled"] == 1 and kept["auto_update"] == 1
    assert kept["last_synced_at"] == "2026-11-18 09:00:00"
    assert json.loads(kept["config_json"]) == {"keep_me": 1}, "恢复后应清掉旧错误"


def test_enabled_and_auto_update_are_ored(conn: sqlite3.Connection) -> None:
    add_subscription(conn, ORIGINAL_ID, enabled=0, auto_update=0)
    add_subscription(
        conn,
        DUPLICATE_ID,
        enabled=1,
        auto_update=0,
        created_at="2026-11-16 13:24:00",
    )

    assert db.dedupe_subscriptions(conn) == 1
    kept = subscriptions(conn)[0]
    assert kept["enabled"] == 1
    assert kept["auto_update"] == 0


def test_custom_subscriptions_are_never_merged(conn: sqlite3.Connection) -> None:
    add_subscription(conn, "custom-1", source_key="custom:abc123", created_at="2026-09-01 10:00:00")
    add_subscription(conn, "custom-2", source_key="custom:abc123", created_at="2026-09-02 10:00:00")

    assert db.dedupe_subscriptions(conn) == 0
    assert len(subscriptions(conn)) == 2


def test_distinct_sources_stay_separate_and_second_run_is_noop(
    conn: sqlite3.Connection,
) -> None:
    add_subscription(conn, ORIGINAL_ID)
    add_subscription(conn, DUPLICATE_ID, created_at="2026-11-16 13:24:00")
    add_subscription(
        conn,
        "investing-1",
        source_key="investing",
        status="error",
        created_at="2026-09-03 17:00:59",
    )

    assert db.dedupe_subscriptions(conn) == 1
    assert len(subscriptions(conn)) == 2
    assert db.dedupe_subscriptions(conn) == 0, "第二次运行必须无副作用"


def test_init_db_runs_dedupe(conn: sqlite3.Connection) -> None:
    add_subscription(conn, ORIGINAL_ID)
    add_subscription(conn, DUPLICATE_ID, created_at="2026-11-16 13:24:00")

    db.init_db(conn)

    assert len(subscriptions(conn)) == 1
