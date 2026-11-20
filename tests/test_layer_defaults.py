"""图层默认值：充实度染色默认关闭（20261120 用户反馈）。

用户原话：新装第一天打开，日历上「什么都没干的一天」也被涂成绿块，看着像数据错乱。
所以默认不染色，需要的人自己在侧栏开。存量库要补一次迁移，但只跑一次——
用户之后自己打开的不能被偷偷关掉。
"""

from __future__ import annotations

import sqlite3

from tt_calendar import config as cfg
from tt_calendar import db


def _fresh_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    # init_db 只建表，默认图层由启动流程另外播种
    db.ensure_default_layer_configs(conn)
    return conn


def _enabled(conn: sqlite3.Connection, layer_id: str) -> bool:
    row = conn.execute(
        "SELECT enabled FROM layer_config WHERE layer_id = ?", (layer_id,)
    ).fetchone()
    assert row is not None
    return bool(row["enabled"])


def test_new_database_has_coloring_disabled():
    conn = _fresh_conn()
    assert _enabled(conn, cfg.LayerID.COLORING) is False
    # 重要日期/节假日这些「不涂就看不出」的图层仍然默认开
    assert _enabled(conn, cfg.LayerID.IMPORTANT) is True
    assert _enabled(conn, cfg.LayerID.HOLIDAY) is True


def test_migration_turns_off_existing_coloring_once():
    conn = _fresh_conn()
    # 模拟旧库：充实度是开着的，且没有迁移标记
    conn.execute("UPDATE layer_config SET enabled = 1 WHERE layer_id = ?", (cfg.LayerID.COLORING,))
    conn.execute("DELETE FROM meta WHERE key = 'coloring_default_off'")
    conn.commit()

    db.ensure_default_layer_configs(conn)
    assert _enabled(conn, cfg.LayerID.COLORING) is False

    # 用户重新打开后，再跑一次初始化不能把它关回去
    conn.execute("UPDATE layer_config SET enabled = 1 WHERE layer_id = ?", (cfg.LayerID.COLORING,))
    conn.commit()
    db.ensure_default_layer_configs(conn)
    assert _enabled(conn, cfg.LayerID.COLORING) is True
