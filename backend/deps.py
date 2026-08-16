"""TT Calendar 后端依赖注入。"""

from tt_calendar import db
from tt_calendar.sync.schema import ensure_sync_schema


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
        pass
    db.ensure_default_layer_configs(conn)
    db.ensure_todo_layer(conn)
    db.ensure_todo_done_layer(conn)
    db.ensure_builtin_subscription(conn)
    return conn
