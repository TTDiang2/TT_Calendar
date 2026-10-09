"""TT Calendar 后端依赖注入。"""

import logging

from tt_calendar import db
from tt_calendar.sync.schema import ensure_sync_schema

log = logging.getLogger(__name__)


def get_db():
    """每请求一个 SQLite 连接（FastAPI 线程池，连接用完即关）。"""

    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


def connect_db():
    """启动时初始化用。"""
    conn = db.connect()
    db.init_db(conn)  # CREATE TABLE IF NOT EXISTS（幂等，新加的 todo 表也会建）
    ensure_sync_schema(conn)  # 同步层：sync_uid/时间戳/墓碑触发器（幂等）
    try:
        db.migrate_legacy_json(conn)
    except Exception:
        # 旧 JSON 迁移失败不该拦住启动（它是遗留数据的best-effort 搬运），但
        # 绝不能静默：整个迁移中断时 legacy_migrated 标记不会置位、用户数据就此
        # 留在旧格式而应用照常启动，事后完全无从察觉。这条日志是唯一线索。
        # legacy_migrated 未置位，下次启动会自动重试。
        log.exception("旧版 JSON 迁移失败，本次启动已跳过（下次启动会重试）")
    db.ensure_default_layer_configs(conn)
    db.ensure_todo_layer(conn)
    db.ensure_todo_done_layer(conn)
    return conn
