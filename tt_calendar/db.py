"""SQLite 数据层：建表、CRUD、首启动自动迁移 3 个旧 JSON。

数据库 schema:
    events         万能事件表（所有图层的事件，按 layer_id/source_ref 去重）
    schedule       AM/PM/EV 三段日程（按天唯一）
    coloring       充实度染色 0..4（按天唯一）
    layer_config   图层显示配置
    meta           元数据（迁移状态、最后同步时间等）
    todo_list      待办列表（任务分组容器）
    todo           单条待办任务（title/status/importance/due_date）
"""

from __future__ import annotations

import json
import logging
import sqlite3
from collections import defaultdict
from contextlib import contextmanager
from datetime import date as date_t, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Iterator

from . import config as cfg
from .models import ColoringEntry, Event, LayerConfig, Mark, ScheduleEntry, ScheduleItem, Todo, TodoList
from .utils.date_utils import parse_date

log = logging.getLogger(__name__)


SCHEMA_SQL: str = """
CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    layer_id     TEXT NOT NULL,
    source       TEXT NOT NULL,
    date         TEXT NOT NULL,           -- 'YYYY-MM-DD'（全天事件）
    title        TEXT NOT NULL,
    description  TEXT,
    color        TEXT,
    extra_json   TEXT,                    -- JSON 字符串，存自定义字段
    source_ref   TEXT,                    -- 外部源唯一 ID（去重用）
    sort_key     INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_events_date  ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_layer ON events(layer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_layer_ref ON events(layer_id, source_ref)
    WHERE source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS schedule (
    date         TEXT PRIMARY KEY,        -- 'YYYY-MM-DD'
    am           TEXT,
    pm           TEXT,
    ev           TEXT,
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS schedule_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT NOT NULL,           -- 'YYYY-MM-DD'（起始日）
    end_date     TEXT,                    -- 多日日程结束日（含，'YYYY-MM-DD'）；NULL=单日
    start_time   TEXT,                    -- 'HH:MM'
    end_time     TEXT,                    -- 'HH:MM'
    title        TEXT NOT NULL,
    color        TEXT,
    category     TEXT DEFAULT 'work',     -- 日程类型：work/course/sport/play/other
    sort_order   INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_schedule_items_date ON schedule_items(date);

CREATE TABLE IF NOT EXISTS coloring (
    date         TEXT PRIMARY KEY,        -- 'YYYY-MM-DD'
    level        INTEGER NOT NULL,        -- 0..4
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS layer_config (
    layer_id     TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    enabled      INTEGER DEFAULT 1,
    color        TEXT,
    sort_order   INTEGER DEFAULT 0,
    kind         TEXT DEFAULT 'color',
    group_name   TEXT,
    config_json  TEXT
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS todo_list (
    id            TEXT PRIMARY KEY,
    display_name  TEXT NOT NULL,
    sort_order    INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS todo (
    id             TEXT PRIMARY KEY,
    list_id        TEXT NOT NULL REFERENCES todo_list(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    body           TEXT,
    status         TEXT DEFAULT 'notStarted',
    importance     TEXT DEFAULT 'normal',
    due_date       TEXT,
    planned_date   TEXT,
    start_date     TEXT,
    complexity     TEXT DEFAULT 'medium',
    tags           TEXT,
    created_at     TEXT DEFAULT (datetime('now','localtime')),
    completed_at   TEXT,
    sort_order     INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_todo_list   ON todo(list_id);
CREATE INDEX IF NOT EXISTS idx_todo_due    ON todo(due_date);
CREATE INDEX IF NOT EXISTS idx_todo_status ON todo(status);

CREATE TABLE IF NOT EXISTS day_busy (
    date          TEXT PRIMARY KEY,
    predict_level INTEGER,
    done_level    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_day_busy_date ON day_busy(date);

CREATE TABLE IF NOT EXISTS marks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    layer_id   TEXT NOT NULL,
    date       TEXT NOT NULL,           -- 'YYYY-MM-DD'
    level      INTEGER,                 -- graded 模式 0..4；solid 模式 NULL
    note       TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(layer_id, date)
);
CREATE INDEX IF NOT EXISTS idx_marks_date ON marks(date);

CREATE TABLE IF NOT EXISTS countdown (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    category       TEXT NOT NULL DEFAULT '其他',
    base_date      TEXT NOT NULL,
    repeat_yearly  INTEGER DEFAULT 0,
    repeat_type    TEXT DEFAULT 'solar',
    milestone_rule TEXT,
    never_expire   INTEGER DEFAULT 0,
    notes          TEXT,
    color          TEXT,
    sort_order     INTEGER DEFAULT 0,
    created_at     TEXT DEFAULT (datetime('now','localtime')),
    updated_at     TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id             TEXT PRIMARY KEY,
    display_name   TEXT NOT NULL,
    source_key     TEXT NOT NULL,
    url            TEXT,
    rules_text     TEXT,
    enabled        INTEGER DEFAULT 1,
    auto_update    INTEGER DEFAULT 1,
    status         TEXT DEFAULT 'pending',
    last_synced_at TEXT,
    config_json    TEXT,
    created_at     TEXT DEFAULT (datetime('now','localtime')),
    updated_at     TEXT DEFAULT (datetime('now','localtime'))
);
"""


# ---------------------------------------------------------------------------
# 连接与初始化
# ---------------------------------------------------------------------------


def connect() -> sqlite3.Connection:
    """打开 SQLite 连接，启用 WAL 和外键。

    check_same_thread=False：FastAPI 线程池可能把依赖与路由分到不同线程
    （每请求独立连接 + WAL，短查询，无跨线程并发写，安全）。
    """

    conn = sqlite3.connect(
        str(cfg.DB_PATH),
        detect_types=sqlite3.PARSE_DECLTYPES,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


@contextmanager
def cursor(conn: sqlite3.Connection) -> Iterator[sqlite3.Cursor]:
    """事务上下文管理器。"""

    cur = conn.cursor()
    try:
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def init_db(conn: sqlite3.Connection) -> None:
    """建表（幂等）+ 旧库缺列迁移。"""

    with cursor(conn) as cur:
        cur.executescript(SCHEMA_SQL)
        _ensure_todo_columns(cur)
        _ensure_countdown_columns(cur)
        _ensure_schedule_item_columns(cur)
        _ensure_layer_config_columns(cur)
        _drop_legacy_schedule_layer(cur)


def _drop_legacy_schedule_layer(cur: sqlite3.Cursor) -> None:
    """弃用旧的顶层 schedule 图层（AM/PM/EV 三段结构已拆成 schedule_items）。

    schedule 表数据保留（兼容旧查询），仅删除 layer_config 里的 'schedule' 行，
    使点点/涂色选择器不再出现顶层"日程"选项。
    """

    cur.execute("DELETE FROM layer_config WHERE layer_id = 'schedule'")


def _ensure_schedule_item_columns(cur: sqlite3.Cursor) -> None:
    """旧库升级：schedule_items 表缺列时补上。"""

    cols = {r["name"] for r in cur.execute("PRAGMA table_info(schedule_items)").fetchall()}
    if "category" not in cols:
        cur.execute("ALTER TABLE schedule_items ADD COLUMN category TEXT DEFAULT 'work'")
    if "end_date" not in cols:
        cur.execute("ALTER TABLE schedule_items ADD COLUMN end_date TEXT")


def _ensure_layer_config_columns(cur: sqlite3.Cursor) -> None:
    """旧库升级：layer_config 表缺 kind/group_name 列时补上。"""

    cols = {r["name"] for r in cur.execute("PRAGMA table_info(layer_config)").fetchall()}
    if "kind" not in cols:
        cur.execute("ALTER TABLE layer_config ADD COLUMN kind TEXT DEFAULT 'color'")
    if "group_name" not in cols:
        cur.execute("ALTER TABLE layer_config ADD COLUMN group_name TEXT")


def _ensure_todo_columns(cur: sqlite3.Cursor) -> None:
    """旧库升级：todo 表缺列时补上。"""

    cols = {r["name"] for r in cur.execute("PRAGMA table_info(todo)").fetchall()}
    if "start_date" not in cols:
        cur.execute("ALTER TABLE todo ADD COLUMN start_date TEXT")
    if "complexity" not in cols:
        cur.execute("ALTER TABLE todo ADD COLUMN complexity TEXT DEFAULT 'medium'")
    if "tags" not in cols:
        cur.execute("ALTER TABLE todo ADD COLUMN tags TEXT")
    if "planned_date" not in cols:
        cur.execute("ALTER TABLE todo ADD COLUMN planned_date TEXT")


def _ensure_countdown_columns(cur: sqlite3.Cursor) -> None:
    """旧库升级：countdown 表缺 repeat_type 列时补上（农历重复倒数日）。"""
    cols = {r["name"] for r in cur.execute("PRAGMA table_info(countdown)").fetchall()}
    if "repeat_type" not in cols:
        cur.execute("ALTER TABLE countdown ADD COLUMN repeat_type TEXT DEFAULT 'solar'")


# ---------------------------------------------------------------------------
# Meta 表 CRUD（用于迁移状态、最后同步时间等）
# ---------------------------------------------------------------------------


def get_meta(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    with cursor(conn) as cur:
        cur.execute(
            "INSERT INTO meta(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


# 待办忙度配置：双图层（预测/实际活动量），共用 weights+thresholds+双调色板
TODO_BUSY_CONFIG_KEY = "todo_busy_config_v1"

DEFAULT_TODO_BUSY_CONFIG: dict = {
    "weights": {
        "due_date": 5,
        "planned_date": 3,
        "importance": {"high": 3, "medium": 2, "low": 1},
        "complexity": {"high": 2, "medium": 1.5, "low": 1},
    },
    "thresholds": [0, 3, 8, 15, 25],
    "predict_colors": ["#FEF3C7", "#FDE68A", "#FBBF24", "#F59E0B", "#B45309"],
    "done_colors":    ["#E0E7FF", "#C7D2FE", "#818CF8", "#4F46E5", "#3730A3"],
}


def get_todo_busy_config(conn) -> dict:
    """读取待办忙度配置；不存在或损坏则返回默认值。"""
    raw = get_meta(conn, TODO_BUSY_CONFIG_KEY)
    if not raw:
        return DEFAULT_TODO_BUSY_CONFIG
    try:
        cfg = json.loads(raw)
        for k, v in DEFAULT_TODO_BUSY_CONFIG.items():
            cfg.setdefault(k, v)
        return cfg
    except Exception:
        return DEFAULT_TODO_BUSY_CONFIG


def set_todo_busy_config(conn, cfg: dict) -> None:
    """写入待办忙度配置（JSON 字符串）。"""
    set_meta(conn, TODO_BUSY_CONFIG_KEY, json.dumps(cfg, ensure_ascii=False))


# 每日提醒配置：应用内轻推（过了设定时间且今日计划未完成为正时，横幅提示一次）
TODO_REMINDER_CONFIG_KEY = "todo_reminder_config_v1"

DEFAULT_TODO_REMINDER_CONFIG: dict = {
    "enabled": False,
    "time": "16:00",    # HH:MM，本地时间
}


def get_todo_reminder_config(conn) -> dict:
    """读取每日提醒配置；不存在或损坏则返回默认值。"""
    raw = get_meta(conn, TODO_REMINDER_CONFIG_KEY)
    if not raw:
        return dict(DEFAULT_TODO_REMINDER_CONFIG)
    try:
        cfg = json.loads(raw)
        if not isinstance(cfg, dict):
            return dict(DEFAULT_TODO_REMINDER_CONFIG)
        enabled = bool(cfg.get("enabled", False))
        time_str = str(cfg.get("time") or DEFAULT_TODO_REMINDER_CONFIG["time"])
        try:
            hh, mm = time_str.split(":")
            if not (0 <= int(hh) <= 23 and 0 <= int(mm) <= 59):
                time_str = DEFAULT_TODO_REMINDER_CONFIG["time"]
        except ValueError:
            time_str = DEFAULT_TODO_REMINDER_CONFIG["time"]
        return {"enabled": enabled, "time": time_str}
    except Exception:
        return dict(DEFAULT_TODO_REMINDER_CONFIG)


def set_todo_reminder_config(conn, cfg: dict) -> None:
    """写入每日提醒配置（JSON 字符串）。"""
    set_meta(conn, TODO_REMINDER_CONFIG_KEY, json.dumps(cfg, ensure_ascii=False))


def upsert_day_busy(conn, date_: date_t, predict_level: int | None, done_level: int | None) -> None:
    """写入某日的双层忙度快照。level=None 表示该层无数据。"""
    with cursor(conn) as cur:
        cur.execute(
            "INSERT INTO day_busy(date, predict_level, done_level) VALUES(?, ?, ?) "
            "ON CONFLICT(date) DO UPDATE SET "
            "predict_level=excluded.predict_level, done_level=excluded.done_level",
            (date_.isoformat(), predict_level, done_level),
        )


def fetch_day_busy_between(conn, start: date_t, end: date_t) -> dict[date_t, tuple[int | None, int | None]]:
    """取 [start, end] 区间的 day_busy 快照，按日期分组。"""
    rows = conn.execute(
        "SELECT date, predict_level, done_level FROM day_busy WHERE date >= ? AND date <= ?",
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    out: dict[date_t, tuple[int | None, int | None]] = {}
    for r in rows:
        out[parse_date(r["date"])] = (r["predict_level"], r["done_level"])
    return out


# ---------------------------------------------------------------------------
# Events CRUD
# ---------------------------------------------------------------------------


def _row_to_event(row: sqlite3.Row) -> Event:
    extra = json.loads(row["extra_json"]) if row["extra_json"] else {}
    return Event(
        id=row["id"],
        layer_id=row["layer_id"],
        source=row["source"],
        date=parse_date(row["date"]),
        title=row["title"],
        description=row["description"],
        color=row["color"],
        extra=extra,
        source_ref=row["source_ref"],
        sort_key=row["sort_key"],
    )


def fetch_events_between(
    conn: sqlite3.Connection,
    start: date_t,
    end: date_t,
    layer_ids: Iterable[str] | None = None,
) -> list[Event]:
    """取 [start, end] 之间的事件，按 layer_id 可选过滤。"""

    sql = (
        "SELECT * FROM events WHERE date >= ? AND date <= ? "
        "AND date NOT LIKE '%00:00:00' "  # 简化：仅按 date 字段过滤
    )
    params: list[Any] = [start.isoformat(), end.isoformat()]
    if layer_ids is not None:
        ids = list(layer_ids)
        if not ids:
            return []
        placeholders = ",".join("?" * len(ids))
        sql += f" AND layer_id IN ({placeholders})"
        params.extend(ids)
    sql += " ORDER BY date, sort_key, id"
    rows = conn.execute(sql, params).fetchall()
    return [_row_to_event(r) for r in rows]


def fetch_events_for_dates(
    conn: sqlite3.Connection,
    dates: Iterable[date_t],
    layer_ids: Iterable[str] | None = None,
) -> dict[date_t, list[Event]]:
    """按日期批量取事件，返回 {date: [events]} 映射。"""

    date_list = [d.isoformat() for d in dates]
    if not date_list:
        return {}
    sql = "SELECT * FROM events WHERE date IN (" + ",".join("?" * len(date_list)) + ")"
    params: list[Any] = list(date_list)
    if layer_ids is not None:
        ids = list(layer_ids)
        if not ids:
            return {}
        sql += " AND layer_id IN (" + ",".join("?" * len(ids)) + ")"
        params.extend(ids)
    sql += " ORDER BY date, sort_key, id"
    rows = conn.execute(sql, params).fetchall()
    result: dict[date_t, list[Event]] = {}
    for row in rows:
        ev = _row_to_event(row)
        result.setdefault(ev.date, []).append(ev)
    return result


def upsert_event(conn: sqlite3.Connection, event: Event) -> Event:
    """插入或更新（按 layer_id + source_ref 去重）。返回带 id 的 Event。"""

    extra_json = json.dumps(event.extra, ensure_ascii=False) if event.extra else None
    with cursor(conn) as cur:
        if event.source_ref:
            # 看是否已存在
            existing = cur.execute(
                "SELECT id FROM events WHERE layer_id = ? AND source_ref = ?",
                (event.layer_id, event.source_ref),
            ).fetchone()
            if existing:
                cur.execute(
                    "UPDATE events SET date=?, title=?, description=?, color=?, "
                    "extra_json=?, sort_key=?, source=?, updated_at=? "
                    "WHERE id=?",
                    (
                        event.date.isoformat(),
                        event.title,
                        event.description,
                        event.color,
                        extra_json,
                        event.sort_key,
                        event.source,
                        datetime.now().isoformat(timespec="seconds"),
                        existing["id"],
                    ),
                )
                event.id = existing["id"]
                return event
        cur.execute(
            "INSERT INTO events(layer_id, source, date, title, description, color, "
            "extra_json, source_ref, sort_key) VALUES(?,?,?,?,?,?,?,?,?)",
            (
                event.layer_id,
                event.source,
                event.date.isoformat(),
                event.title,
                event.description,
                event.color,
                extra_json,
                event.source_ref,
                event.sort_key,
            ),
        )
        event.id = cur.lastrowid
    return event


def delete_event(conn: sqlite3.Connection, event_id: int) -> None:
    with cursor(conn) as cur:
        cur.execute("DELETE FROM events WHERE id = ?", (event_id,))


def move_day_content(
    conn: sqlite3.Connection,
    src: date_t,
    dst: date_t,
) -> tuple[int, bool]:
    """把 src 日的手动事件和日程整体搬到 dst 日（拖拽改期）。

    - 只移动 source='manual' 的事件（集思录/节假日等外部数据不动）
    - 日程：dst 已有则合并（dst 字段优先，src 补空缺），然后删除 src 日程
    - 返回 (移动事件数, 是否移动了日程)
    """

    moved_events = 0
    moved_schedule = False
    if src == dst:
        return moved_events, moved_schedule
    with cursor(conn) as cur:
        cur.execute(
            "UPDATE events SET date=?, updated_at=? "
            "WHERE date=? AND source='manual'",
            (
                dst.isoformat(),
                datetime.now().isoformat(timespec="seconds"),
                src.isoformat(),
            ),
        )
        moved_events = cur.rowcount

        src_row = cur.execute(
            "SELECT * FROM schedule WHERE date=?", (src.isoformat(),)
        ).fetchone()
        if src_row:
            dst_row = cur.execute(
                "SELECT * FROM schedule WHERE date=?", (dst.isoformat(),)
            ).fetchone()
            if dst_row:
                cur.execute(
                    "UPDATE schedule SET am=?, pm=?, ev=?, updated_at=? WHERE date=?",
                    (
                        dst_row["am"] or src_row["am"],
                        dst_row["pm"] or src_row["pm"],
                        dst_row["ev"] or src_row["ev"],
                        datetime.now().isoformat(timespec="seconds"),
                        dst.isoformat(),
                    ),
                )
            else:
                cur.execute(
                    "UPDATE schedule SET date=?, updated_at=? WHERE date=?",
                    (
                        dst.isoformat(),
                        datetime.now().isoformat(timespec="seconds"),
                        src.isoformat(),
                    ),
                )
            cur.execute("DELETE FROM schedule WHERE date=?", (src.isoformat(),))
            moved_schedule = True

    return moved_events, moved_schedule


def delete_events_by_layer_source(
    conn: sqlite3.Connection, layer_id: str, source: str
) -> int:
    """删除某图层某来源的所有事件。返回删除条数。"""

    with cursor(conn) as cur:
        cur.execute(
            "DELETE FROM events WHERE layer_id = ? AND source = ?",
            (layer_id, source),
        )
        return cur.rowcount


def delete_events_by_source_ref(
    conn: sqlite3.Connection,
    layer_id: str,
    source_refs: Iterable[str],
) -> int:
    """删除指定 source_ref 的事件（用于增量同步前清掉失效条目）。"""

    refs = list(source_refs)
    if not refs:
        return 0
    placeholders = ",".join("?" * len(refs))
    with cursor(conn) as cur:
        cur.execute(
            f"DELETE FROM events WHERE layer_id = ? AND source_ref IN ({placeholders})",
            [layer_id, *refs],
        )
        return cur.rowcount


# ---------------------------------------------------------------------------
# Schedule CRUD
# ---------------------------------------------------------------------------


def fetch_schedule_between(
    conn: sqlite3.Connection, start: date_t, end: date_t
) -> dict[date_t, ScheduleEntry]:
    rows = conn.execute(
        "SELECT * FROM schedule WHERE date >= ? AND date <= ?",
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    return {
        parse_date(r["date"]): ScheduleEntry(
            date=parse_date(r["date"]), am=r["am"], pm=r["pm"], ev=r["ev"]
        )
        for r in rows
    }


def upsert_schedule(conn: sqlite3.Connection, entry: ScheduleEntry) -> None:
    with cursor(conn) as cur:
        cur.execute(
            "INSERT INTO schedule(date, am, pm, ev, updated_at) VALUES(?,?,?,?,?) "
            "ON CONFLICT(date) DO UPDATE SET am=excluded.am, pm=excluded.pm, "
            "ev=excluded.ev, updated_at=excluded.updated_at",
            (
                entry.date.isoformat(),
                entry.am,
                entry.pm,
                entry.ev,
                datetime.now().isoformat(timespec="seconds"),
            ),
        )


def delete_schedule(conn: sqlite3.Connection, d: date_t) -> None:
    with cursor(conn) as cur:
        cur.execute("DELETE FROM schedule WHERE date = ?", (d.isoformat(),))


# ---------------------------------------------------------------------------
# ScheduleItems CRUD（新结构：一天多条，带起止时间）
# ---------------------------------------------------------------------------


def _row_to_schedule_item(row: sqlite3.Row) -> ScheduleItem:
    return ScheduleItem(
        id=row["id"],
        date=parse_date(row["date"]),
        start_time=row["start_time"],
        end_time=row["end_time"],
        title=row["title"],
        color=row["color"],
        category=row["category"] or "work",
        sort_order=row["sort_order"] or 0,
        end_date=_parse_iso_date(row["end_date"]) if "end_date" in row.keys() else None,
    )


def _parse_iso_date(raw: str | None) -> date_t | None:
    """宽容解析 'YYYY-MM-DD'；空值或脏数据返回 None（多日日程退化为单日，不让视图崩）。"""

    if not raw:
        return None
    try:
        return date_t.fromisoformat(raw)
    except (TypeError, ValueError):
        return None


def fetch_schedule_items_between(
    conn: sqlite3.Connection, start: date_t, end: date_t
) -> list[ScheduleItem]:
    """取 [start, end] 内可见的日程（含多日日程）。

    多日日程只存一行（date=起始日, end_date=结束日），所以判定条件是「区间相交」而非
    「date 落在区间内」：
        date <= end                      起始日不晚于视图末日
        COALESCE(end_date, date) >= start 结束日（单日用起始日）不早于视图首日
    否则跨月视图里，上月开始、本月仍在持续的日程会整条消失。
    """

    rows = conn.execute(
        "SELECT * FROM schedule_items WHERE date <= ? AND COALESCE(end_date, date) >= ? "
        "ORDER BY date, sort_order, start_time, id",
        (end.isoformat(), start.isoformat()),
    ).fetchall()
    return [_row_to_schedule_item(r) for r in rows]


def upsert_schedule_item(conn: sqlite3.Connection, item: ScheduleItem) -> ScheduleItem:
    # 归一化：倒挂或等于起始日的 end_date 一律清掉，避免脏数据把普通日程变成跨天。
    # 直接改对象 —— 返回值会回给前端，必须和库里的真实状态一致，否则 UI 会画出幽灵跨天条。
    if item.end_date is not None and item.end_date <= item.date:
        item.end_date = None

    now = datetime.now().isoformat(timespec="seconds")
    with cursor(conn) as cur:
        if item.id is None:
            cur.execute(
                "INSERT INTO schedule_items(date, end_date, start_time, end_time, title, color, category, sort_order, updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    item.date.isoformat(),
                    item.end_date.isoformat() if item.end_date else None,
                    item.start_time,
                    item.end_time,
                    item.title,
                    item.color,
                    item.category,
                    item.sort_order,
                    now,
                ),
            )
            item.id = cur.lastrowid
        else:
            # 显式 UPDATE。曾经用「INSERT 不带 id + ON CONFLICT(id) DO UPDATE」，
            # 但 INSERT 不指定 id 时永远拿到新自增 id，冲突永不触发 —— 每次“更新”
            # 实际都插入了新行（2026-09-03 由 HTTP 集成测试暴露：缩短日程后旧行仍在）。
            cur.execute(
                "UPDATE schedule_items SET date=?, end_date=?, start_time=?, end_time=?, "
                "title=?, color=?, category=?, sort_order=?, updated_at=? WHERE id=?",
                (
                    item.date.isoformat(),
                    item.end_date.isoformat() if item.end_date else None,
                    item.start_time,
                    item.end_time,
                    item.title,
                    item.color,
                    item.category,
                    item.sort_order,
                    now,
                    item.id,
                ),
            )
    return item


def delete_schedule_item(conn: sqlite3.Connection, item_id: int) -> None:
    with cursor(conn) as cur:
        cur.execute("DELETE FROM schedule_items WHERE id = ?", (item_id,))


def migrate_schedule_to_items(conn: sqlite3.Connection) -> int:
    """把旧 schedule 表的 AM/PM/EV 迁移成 schedule_items（幂等，跑一次即可）。"""

    rows = conn.execute("SELECT * FROM schedule").fetchall()
    migrated = 0
    with cursor(conn) as cur:
        for r in rows:
            d = r["date"]
            exists = cur.execute(
                "SELECT 1 FROM schedule_items WHERE date = ?", (d,)
            ).fetchone()
            if exists:
                continue
            for slot, label in (("am", "上午"), ("pm", "下午"), ("ev", "晚上")):
                text = r[slot]
                if not text:
                    continue
                cur.execute(
                    "INSERT INTO schedule_items(date, start_time, end_time, title, color, sort_order) "
                    "VALUES(?,?,?,?,?,?)",
                    (d, None, None, f"{label}: {text}", None, migrated),
                )
                migrated += 1
    return migrated


# ---------------------------------------------------------------------------
# Coloring CRUD
# ---------------------------------------------------------------------------


def fetch_coloring_between(
    conn: sqlite3.Connection, start: date_t, end: date_t
) -> dict[date_t, int]:
    rows = conn.execute(
        "SELECT * FROM coloring WHERE date >= ? AND date <= ?",
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    return {parse_date(r["date"]): r["level"] for r in rows}


def upsert_coloring(conn: sqlite3.Connection, entry: ColoringEntry) -> None:
    with cursor(conn) as cur:
        cur.execute(
            "INSERT INTO coloring(date, level, updated_at) VALUES(?,?,?) "
            "ON CONFLICT(date) DO UPDATE SET level=excluded.level, "
            "updated_at=excluded.updated_at",
            (
                entry.date.isoformat(),
                entry.level,
                datetime.now().isoformat(timespec="seconds"),
            ),
        )


def delete_coloring(conn: sqlite3.Connection, d: date_t) -> None:
    with cursor(conn) as cur:
        cur.execute("DELETE FROM coloring WHERE date = ?", (d.isoformat(),))


# ---------------------------------------------------------------------------
# Mark CRUD（涂色标记：打卡/自定义完成度，按 layer_id+date 唯一）
# ---------------------------------------------------------------------------


def _row_to_mark(row: sqlite3.Row) -> Mark:
    return Mark(
        id=row["id"],
        layer_id=row["layer_id"],
        date=parse_date(row["date"]),
        level=row["level"],
        note=row["note"],
        created_at=row["created_at"],
    )


def fetch_marks_between(
    conn: sqlite3.Connection, start: date_t, end: date_t
) -> dict[date_t, list[Mark]]:
    rows = conn.execute(
        "SELECT * FROM marks WHERE date >= ? AND date <= ? ORDER BY date, layer_id",
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    out: dict[date_t, list[Mark]] = defaultdict(list)
    for r in rows:
        out[parse_date(r["date"])].append(_row_to_mark(r))
    return out


def upsert_mark(conn: sqlite3.Connection, mark: Mark) -> None:
    with cursor(conn) as cur:
        cur.execute(
            "INSERT INTO marks(layer_id, date, level, note, updated_at) VALUES(?,?,?,?,?) "
            "ON CONFLICT(layer_id, date) DO UPDATE SET level=excluded.level, "
            "note=excluded.note, updated_at=excluded.updated_at",
            (
                mark.layer_id,
                mark.date.isoformat(),
                mark.level,
                mark.note,
                datetime.now().isoformat(timespec="seconds"),
            ),
        )


def delete_mark(conn: sqlite3.Connection, layer_id: str, d: date_t) -> None:
    with cursor(conn) as cur:
        cur.execute(
            "DELETE FROM marks WHERE layer_id = ? AND date = ?",
            (layer_id, d.isoformat()),
        )


# ---------------------------------------------------------------------------
# Layer config CRUD
# ---------------------------------------------------------------------------


def fetch_layer_configs(conn: sqlite3.Connection) -> list[LayerConfig]:
    rows = conn.execute(
        "SELECT * FROM layer_config ORDER BY sort_order, layer_id"
    ).fetchall()
    return [
        LayerConfig(
            layer_id=r["layer_id"],
            display_name=r["display_name"],
            enabled=bool(r["enabled"]),
            color=r["color"],
            sort_order=r["sort_order"],
            kind=r["kind"] if "kind" in r.keys() and r["kind"] else "color",
            group=r["group_name"] if "group_name" in r.keys() else None,
            config=json.loads(r["config_json"]) if r["config_json"] else {},
        )
        for r in rows
    ]


def upsert_layer_config(conn: sqlite3.Connection, layer: LayerConfig) -> None:
    with cursor(conn) as cur:
        cur.execute(
            "INSERT INTO layer_config(layer_id, display_name, enabled, color, "
            "sort_order, kind, group_name, config_json) VALUES(?,?,?,?,?,?,?,?) "
            "ON CONFLICT(layer_id) DO UPDATE SET display_name=excluded.display_name, "
            "enabled=excluded.enabled, color=excluded.color, "
            "sort_order=excluded.sort_order, kind=excluded.kind, "
            "group_name=excluded.group_name, config_json=excluded.config_json",
            (
                layer.layer_id,
                layer.display_name,
                int(layer.enabled),
                layer.color,
                layer.sort_order,
                layer.kind or "color",
                layer.group,
                json.dumps(layer.config, ensure_ascii=False) if layer.config else None,
            ),
        )


def delete_layer_config(conn: sqlite3.Connection, layer_id: str) -> None:
    with cursor(conn) as cur:
        cur.execute("DELETE FROM layer_config WHERE layer_id = ?", (layer_id,))


# ---------------------------------------------------------------------------
# 旧 JSON 自动迁移（仅首启动执行一次）
# ---------------------------------------------------------------------------


def _try_load_json(path: Path, candidate_encodings: list[str]) -> Any:
    """用多种编码尝试加载 JSON。"""

    for enc in candidate_encodings:
        try:
            with open(path, "r", encoding=enc) as f:
                return json.load(f)
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    return None


def migrate_legacy_json(conn: sqlite3.Connection) -> dict[str, int]:
    """首启动迁移：color_data.json / schedule_data.json / important_dates.json。

    保留原文件不动（用户作为备份）。
    返回 {'coloring': N, 'schedule': N, 'important': N}。
    """

    if get_meta(conn, "legacy_migrated") == "1":
        log.info("legacy_migrated already done, skip")
        return {"coloring": 0, "schedule": 0, "important": 0}

    counts = {"coloring": 0, "schedule": 0, "important": 0}

    # color_data.json -> coloring 表
    if cfg.LEGACY_COLOR_JSON.exists():
        data = _try_load_json(cfg.LEGACY_COLOR_JSON, ["utf-8", "gbk", "gb18030"]) or {}
        # 旧版按 hex 颜色存；新 schema 用 0..4 等级
        # 做个映射：根据颜色亮度近似转回等级
        for date_str, hex_color in data.items():
            try:
                d = parse_date(date_str)
                level = _hex_to_level(hex_color)
                upsert_coloring(conn, ColoringEntry(date=d, level=level))
                counts["coloring"] += 1
            except Exception as e:
                log.warning("coloring migration skip %s: %s", date_str, e)

    # schedule_data.json -> schedule 表
    if cfg.LEGACY_SCHEDULE_JSON.exists():
        data = _try_load_json(cfg.LEGACY_SCHEDULE_JSON, ["utf-8", "gbk"]) or {}
        for date_str, item in data.items():
            try:
                d = parse_date(date_str)
                am, pm, ev = _parse_legacy_schedule_text(item.get("text", ""))
                upsert_schedule(conn, ScheduleEntry(date=d, am=am, pm=pm, ev=ev))
                counts["schedule"] += 1
            except Exception as e:
                log.warning("schedule migration skip %s: %s", date_str, e)

    # important_dates.json -> events 表 (layer_id='important')
    if cfg.LEGACY_IMPORTANT_JSON.exists():
        # important_dates.json 是 GBK 编码（旧 Python 没处理 utf-8）
        data = _try_load_json(
            cfg.LEGACY_IMPORTANT_JSON, ["gbk", "gb18030", "utf-8"]
        ) or {}
        for date_str, items in data.items():
            if not isinstance(items, list):
                continue
            try:
                d = parse_date(date_str)
            except Exception:
                continue
            for it in items:
                label = it.get("label", "")
                if not label:
                    continue
                source_ref = it.get("source", date_str) + f"::off{it.get('offset', 0)}"
                color = "#FF4D4D" if it.get("offset", 0) == 0 else "#FFB0B0"
                ev = Event(
                    layer_id=cfg.LayerID.IMPORTANT,
                    source="migrated",
                    date=d,
                    title=label,
                    color=color,
                    source_ref=source_ref,
                    extra={
                        "auto": bool(it.get("auto", False)),
                        "offset": int(it.get("offset", 0)),
                        "base_source": it.get("source"),
                    },
                    sort_key=0 if it.get("offset", 0) == 0 else 1,
                )
                upsert_event(conn, ev)
                counts["important"] += 1

    set_meta(conn, "legacy_migrated", "1")
    log.info("legacy migration done: %s", counts)
    return counts


def _hex_to_level(hex_color: str) -> int:
    """把旧版 hex 颜色近似映射到 0..4 等级。

    旧版 5 档色值（来自原代码）：
        #ffffff -> 0
        #aad4aa -> 1
        #66aa66 -> 2
        #337f33 -> 3
        #115511 -> 4
    """

    mapping: dict[str, int] = {
        "#ffffff": 0,
        "#aad4aa": 1,
        "#66aa66": 2,
        "#337f33": 3,
        "#115511": 4,
    }
    key = hex_color.strip().lower()
    if key in mapping:
        return mapping[key]
    # 兜底：按亮度
    try:
        r = int(key[1:3], 16)
        g = int(key[3:5], 16)
        b = int(key[5:7], 16)
        luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        # 越深 -> 越高级别
        return int(round((1 - luminance) * 4))
    except Exception:
        return 0


def _parse_legacy_schedule_text(text: str) -> tuple[str | None, str | None, str | None]:
    """把旧版 schedule text '  23\nAM: <上午安排>\nPM: <下午安排>\n ' 解析为 (am, pm, ev)。"""

    am = pm = ev = None
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("AM:"):
            am = line[3:].strip() or None
        elif line.startswith("PM:"):
            pm = line[3:].strip() or None
        elif line.startswith("EV:"):
            ev = line[3:].strip() or None
    return am, pm, ev


# ---------------------------------------------------------------------------
# 默认图层配置初始化（首启动）
# ---------------------------------------------------------------------------


def ensure_default_layer_configs(conn: sqlite3.Connection) -> None:
    """如果 layer_config 表为空，写入默认图层列表。"""

    if get_meta(conn, "default_layers_seeded") == "1":
        return
    existing = conn.execute("SELECT COUNT(*) AS c FROM layer_config").fetchone()["c"]
    if existing > 0:
        set_meta(conn, "default_layers_seeded", "1")
        return

    from .theme import LAYER_COLORS  # 避免循环导入

    defaults: list[tuple[str, str, str, int, str, str | None]] = [
        # (layer_id, display_name, color, sort_order, kind, group)
        (cfg.LayerID.SCHEDULE,  "日程（旧）",   LAYER_COLORS[cfg.LayerID.SCHEDULE],  0, "dot", "日程"),
        (cfg.LayerID.IMPORTANT, "重要日期",   LAYER_COLORS[cfg.LayerID.IMPORTANT], 1, "color", None),
        (cfg.LayerID.COLORING,  "充实度染色", LAYER_COLORS[cfg.LayerID.COLORING],  2, "color", None),
        (cfg.LayerID.HOLIDAY,   "公共节假日", LAYER_COLORS[cfg.LayerID.HOLIDAY],   3, "color", None),
    ]
    for layer_id, name, color, order, kind, group in defaults:
        upsert_layer_config(
            conn,
            LayerConfig(
                layer_id=layer_id,
                display_name=name,
                enabled=False if layer_id == cfg.LayerID.SCHEDULE else True,
                color=color,
                sort_order=order,
                kind=kind,
                group=group,
            ),
        )
    # 集思录子图层（每个 qtype 一个，点点图层，归类"集思录"）
    for qtype, info in cfg.JISILU_QTYPES.items():
        layer_id = cfg.LayerID.JISILU_PREFIX + qtype
        upsert_layer_config(
            conn,
            LayerConfig(
                layer_id=layer_id,
                display_name=f"集思录·{info['label']}",
                enabled=bool(info["enabled"]),
                color=str(info["color"]),
                sort_order=10,
                kind="dot",
                group="集思录",
                config={"qtype": qtype},
            ),
        )
    set_meta(conn, "default_layers_seeded", "1")


def ensure_todo_layer(conn: sqlite3.Connection) -> None:
    """幂等插入 todo 图层配置（已 seeded 的旧 DB 升级时补这个图层）。"""

    row = conn.execute("SELECT 1 FROM layer_config WHERE layer_id = ?", (cfg.LayerID.TODO,)).fetchone()
    if row:
        return
    upsert_layer_config(
        conn,
        LayerConfig(
            layer_id=cfg.LayerID.TODO,
            display_name="待办",
            enabled=True,
            color=cfg.TODO_LAYER_COLOR,
            sort_order=4,
            kind="color",
        ),
    )


def ensure_todo_done_layer(conn: sqlite3.Connection) -> None:
    """幂等插入 todo_done 图层（实际活动量，过去日期的「勾掉了多少」加权染色）。"""

    row = conn.execute("SELECT 1 FROM layer_config WHERE layer_id = ?", ("todo_done",)).fetchone()
    if row:
        return
    upsert_layer_config(
        conn,
        LayerConfig(
            layer_id="todo_done",
            display_name="待办·已完成",
            enabled=True,
            color="#818CF8",
            sort_order=5,
            kind="color",
        ),
    )


SCHEDULE_CATEGORIES: list[tuple[str, str, str, int]] = [
    # (category, display_name, color, sort_order)
    ("work", "工作", "#3D6BFB", 0),
    ("course", "课程", "#8E24AA", 1),
    ("sport", "运动", "#10B981", 2),
    ("play", "玩耍", "#F59E0B", 3),
    ("other", "其他", "#64748B", 4),
]


def ensure_schedule_category_layers(conn: sqlite3.Connection) -> None:
    """幂等插入日程分类图层（schedule_<category>，点点图层，归类"日程"）。"""

    for category, name, color, order in SCHEDULE_CATEGORIES:
        layer_id = f"schedule_{category}"
        row = conn.execute("SELECT 1 FROM layer_config WHERE layer_id = ?", (layer_id,)).fetchone()
        if row:
            continue
        upsert_layer_config(
            conn,
            LayerConfig(
                layer_id=layer_id,
                display_name=name,
                enabled=True,
                color=color,
                sort_order=5 + order,
                kind="dot",
                group="日程",
                config={"category": category},
            ),
        )


def backfill_layer_kind_group(conn: sqlite3.Connection) -> None:
    """旧库升级：给已有图层补 kind/group（基于 layer_id 规则推断）。"""

    rows = conn.execute("SELECT layer_id, kind, group_name FROM layer_config").fetchall()
    for r in rows:
        lid = r["layer_id"]
        cur_kind = r["kind"] if "kind" in r.keys() else None
        cur_group = r["group_name"] if "group_name" in r.keys() else None
        if cur_kind and cur_group is not None:
            continue
        if lid.startswith("schedule_"):
            new_kind, new_group = "dot", "日程"
        elif lid.startswith("jisilu_"):
            new_kind, new_group = "dot", "集思录"
        elif lid == cfg.LayerID.SCHEDULE:
            new_kind, new_group = "dot", "日程"
        elif lid in (cfg.LayerID.IMPORTANT, cfg.LayerID.COLORING, cfg.LayerID.HOLIDAY, cfg.LayerID.TODO):
            new_kind, new_group = "color", None
        elif lid.startswith("custom_"):
            new_kind = cur_kind or "color"
            new_group = cur_group
        else:
            new_kind = cur_kind or "color"
            new_group = cur_group
        with cursor(conn) as cur:
            cur.execute(
                "UPDATE layer_config SET kind = ?, group_name = ? WHERE layer_id = ? AND (kind IS NULL OR kind = '' OR group_name IS NULL)",
                (new_kind, new_group, lid),
            )


# ---------------------------------------------------------------------------
# Todo CRUD
# ---------------------------------------------------------------------------


def _row_to_todo_list(row: sqlite3.Row) -> TodoList:
    return TodoList(
        id=row["id"],
        display_name=row["display_name"],
        sort_order=row["sort_order"],
        created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
    )


def _row_to_todo(row: sqlite3.Row) -> Todo:
    return Todo(
        id=row["id"],
        list_id=row["list_id"],
        title=row["title"],
        body=row["body"],
        status=row["status"],
        importance=row["importance"],
        due_date=parse_date(row["due_date"]) if row["due_date"] else None,
        planned_date=parse_date(row["planned_date"]) if row["planned_date"] else None,
        start_date=parse_date(row["start_date"]) if row["start_date"] else None,
        complexity=row["complexity"] or "medium",
        tags=json.loads(row["tags"]) if row["tags"] else None,
        created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
        completed_at=datetime.fromisoformat(row["completed_at"]) if row["completed_at"] else None,
        sort_order=row["sort_order"],
    )


def fetch_todo_lists(conn: sqlite3.Connection) -> list[TodoList]:
    rows = conn.execute("SELECT * FROM todo_list ORDER BY sort_order, created_at").fetchall()
    return [_row_to_todo_list(r) for r in rows]


def upsert_todo_list(conn: sqlite3.Connection, todo_list: TodoList) -> None:
    with cursor(conn) as cur:
        cur.execute(
            "INSERT INTO todo_list(id, display_name, sort_order) VALUES(?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, "
            "sort_order=excluded.sort_order",
            (todo_list.id, todo_list.display_name, todo_list.sort_order),
        )


def delete_todo_list(conn: sqlite3.Connection, list_id: str) -> None:
    with cursor(conn) as cur:
        cur.execute("DELETE FROM todo_list WHERE id = ?", (list_id,))


def reorder_todo_lists(conn: sqlite3.Connection, ordered_ids: list[str]) -> None:
    """按给定顺序批量更新 todo_list.sort_order。"""

    with cursor(conn) as cur:
        for i, lid in enumerate(ordered_ids):
            cur.execute(
                "UPDATE todo_list SET sort_order = ? WHERE id = ?",
                (i, lid),
            )


def reorder_todos(conn: sqlite3.Connection, ordered_ids: list[str]) -> None:
    """按给定顺序批量更新 todo.sort_order。"""

    with cursor(conn) as cur:
        for i, tid in enumerate(ordered_ids):
            cur.execute("UPDATE todo SET sort_order = ? WHERE id = ?", (i, tid))


def get_todo(conn: sqlite3.Connection, todo_id: str) -> Todo | None:
    """按 id 取单条 todo；不存在返回 None。"""
    row = conn.execute("SELECT * FROM todo WHERE id = ?", (todo_id,)).fetchone()
    return _row_to_todo(row) if row else None


def fetch_todos_completed_on(conn: sqlite3.Connection, d: date_t) -> list[Todo]:
    """取所有 completed_at 日期 = d 的 todo（无论 due_date 在哪天），用于实际活动量算法。"""
    rows = conn.execute(
        "SELECT * FROM todo WHERE completed_at IS NOT NULL AND date(completed_at) = ?",
        (d.isoformat(),),
    ).fetchall()
    return [_row_to_todo(r) for r in rows]


_TODO_SORT_SQL = {
    "manual": "sort_order ASC",
    "due_importance": (
        "CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, "
        "CASE importance WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END"
    ),
    "due_planned_importance": (
        "CASE WHEN COALESCE(MIN(due_date, planned_date), due_date, planned_date) IS NULL THEN 1 ELSE 0 END, "
        "COALESCE(MIN(due_date, planned_date), due_date, planned_date) ASC, "
        "CASE importance WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END"
    ),
    "due": "CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC",
    "planned": "CASE WHEN planned_date IS NULL THEN 1 ELSE 0 END, planned_date ASC",
    "importance": "CASE importance WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END",
    "created": "created_at DESC",
}


def fetch_todos(
    conn: sqlite3.Connection,
    list_id: str | None = None,
    status_filter: str = "notStarted",
    sort: str = "due_importance",
    limit: int | None = None,
) -> list[Todo]:
    """列任务。status_filter: notStarted(默认,排除completed) / all / completed。"""

    clauses = []
    params: list = []
    if list_id:
        clauses.append("list_id = ?")
        params.append(list_id)
    if status_filter == "notStarted":
        clauses.append("status != 'completed'")
    elif status_filter == "completed":
        clauses.append("status = 'completed'")
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    order_sql = _TODO_SORT_SQL.get(sort, _TODO_SORT_SQL["due_importance"])
    # completed 列表：一律按完成时间倒序（最新完成在前）。
    # 原因：已完成任务关注的是完成时刻；若沿用 due/planned 排序，刚勾选完成的任务
    # 会沉到末尾，被前端 limit=500 截断，看板展开列/列表已完成区看不到最新完成。
    if status_filter == "completed":
        order_sql = "completed_at DESC"
    # manual 排序本身就是 sort_order，不需要再追加次级排序键
    if sort == "manual":
        sql = f"SELECT * FROM todo{where} ORDER BY {order_sql}"
    else:
        sql = f"SELECT * FROM todo{where} ORDER BY {order_sql}, sort_order ASC"
    if limit is not None:
        sql += f" LIMIT {int(limit)}"
    rows = conn.execute(sql, params).fetchall()
    return [_row_to_todo(r) for r in rows]


def fetch_todos_between(
    conn: sqlite3.Connection,
    start: date_t,
    end: date_t,
) -> dict[date_t, list[Todo]]:
    """取 [start, end] 之间 due_date 或 planned_date 命中的未完成 todo，按日期分组。

    （视图聚合用：一个 todo 可能出现在截止日与计划日两个日期。）
    """

    rows = conn.execute(
        "SELECT * FROM todo WHERE status != 'completed' AND ("
        "(due_date IS NOT NULL AND due_date >= ? AND due_date <= ?) OR "
        "(planned_date IS NOT NULL AND planned_date >= ? AND planned_date <= ?)) "
        "ORDER BY due_date ASC",
        (start.isoformat(), end.isoformat(), start.isoformat(), end.isoformat()),
    ).fetchall()
    out: dict[date_t, list[Todo]] = defaultdict(list)
    seen: set[tuple[str, str]] = set()
    for r in rows:
        t = _row_to_todo(r)
        for d in (t.due_date, t.planned_date):
            if d and start <= d <= end and (t.id, d.isoformat()) not in seen:
                seen.add((t.id, d.isoformat()))
                out[d].append(t)
    return out


def upsert_todo(conn: sqlite3.Connection, todo: Todo) -> None:
    with cursor(conn) as cur:
        cur.execute(
            "INSERT INTO todo(id, list_id, title, body, status, importance, due_date, "
            "planned_date, start_date, complexity, tags, completed_at, sort_order) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET list_id=excluded.list_id, title=excluded.title, "
            "body=excluded.body, status=excluded.status, importance=excluded.importance, "
            "due_date=excluded.due_date, planned_date=excluded.planned_date, "
            "start_date=excluded.start_date, complexity=excluded.complexity, "
            "tags=excluded.tags, completed_at=excluded.completed_at, "
            "sort_order=excluded.sort_order",
            (
                todo.id,
                todo.list_id,
                todo.title,
                todo.body,
                todo.status,
                todo.importance,
                todo.due_date.isoformat() if todo.due_date else None,
                todo.planned_date.isoformat() if todo.planned_date else None,
                todo.start_date.isoformat() if todo.start_date else None,
                todo.complexity or "medium",
                json.dumps(todo.tags, ensure_ascii=False) if todo.tags else None,
                todo.completed_at.isoformat() if todo.completed_at else None,
                todo.sort_order,
            ),
        )


def count_todos(conn: sqlite3.Connection, list_id: str | None = None) -> dict[str, int]:
    """待办统计：{total, incomplete, completed}，可选按列表过滤。"""

    where = ""
    params: list = []
    if list_id:
        where = " WHERE list_id = ?"
        params.append(list_id)
    total = conn.execute(f"SELECT COUNT(*) AS c FROM todo{where}", params).fetchone()["c"]
    incomplete = conn.execute(
        f"SELECT COUNT(*) AS c FROM todo{where}{' AND' if where else ' WHERE'} status != 'completed'",
        params,
    ).fetchone()["c"]
    return {"total": total, "incomplete": incomplete, "completed": total - incomplete}


def daily_completed(conn: sqlite3.Connection, days: int = 90) -> list[dict]:
    """近 N 天每日完成数量：[{date: 'YYYY-MM-DD', count: n}]，无完成的天补 0。"""

    start = date_t.today() - timedelta(days=days - 1)
    rows = conn.execute(
        "SELECT substr(completed_at, 1, 10) AS d, COUNT(*) AS c FROM todo "
        "WHERE status = 'completed' AND completed_at IS NOT NULL AND substr(completed_at, 1, 10) >= ? "
        "GROUP BY d",
        (start.isoformat(),),
    ).fetchall()
    by_day = {r["d"]: r["c"] for r in rows}
    out = []
    for i in range(days):
        d = (start + timedelta(days=i)).isoformat()
        out.append({"date": d, "count": by_day.get(d, 0)})
    return out


def delete_todo(conn: sqlite3.Connection, todo_id: str) -> None:
    with cursor(conn) as cur:
        cur.execute("DELETE FROM todo WHERE id = ?", (todo_id,))


# ---------------------------------------------------------------------------
# Countdown CRUD（倒数日独立表）
# ---------------------------------------------------------------------------


def _row_to_countdown(row: sqlite3.Row):
    from .models import Countdown

    keys = row.keys()
    return Countdown(
        id=row["id"],
        name=row["name"],
        category=row["category"],
        base_date=parse_date(row["base_date"]),
        repeat_yearly=bool(row["repeat_yearly"]),
        repeat_type=row["repeat_type"] if "repeat_type" in keys else "solar",
        milestone_rule=row["milestone_rule"],
        never_expire=bool(row["never_expire"]),
        notes=row["notes"],
        color=row["color"],
        sort_order=row["sort_order"],
        created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
        updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
    )


def fetch_countdowns(conn: sqlite3.Connection) -> list:
    rows = conn.execute(
        "SELECT * FROM countdown ORDER BY sort_order, base_date, id"
    ).fetchall()
    return [_row_to_countdown(r) for r in rows]


def upsert_countdown(conn: sqlite3.Connection, cd) -> None:
    with cursor(conn) as cur:
        if cd.id is None:
            cur.execute(
                "INSERT INTO countdown(name, category, base_date, repeat_yearly, repeat_type, "
                "milestone_rule, never_expire, notes, color, sort_order) "
                "VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    cd.name, cd.category, cd.base_date.isoformat(),
                    int(cd.repeat_yearly), getattr(cd, "repeat_type", "solar"),
                    cd.milestone_rule, int(cd.never_expire),
                    cd.notes, cd.color, cd.sort_order,
                ),
            )
            cd.id = cur.lastrowid
        else:
            cur.execute(
                "UPDATE countdown SET name=?, category=?, base_date=?, repeat_yearly=?, repeat_type=?, "
                "milestone_rule=?, never_expire=?, notes=?, color=?, sort_order=?, "
                "updated_at=datetime('now','localtime') WHERE id=?",
                (
                    cd.name, cd.category, cd.base_date.isoformat(),
                    int(cd.repeat_yearly), getattr(cd, "repeat_type", "solar"),
                    cd.milestone_rule, int(cd.never_expire),
                    cd.notes, cd.color, cd.sort_order, cd.id,
                ),
            )


def delete_countdown(conn: sqlite3.Connection, cd_id: int) -> None:
    with cursor(conn) as cur:
        cur.execute("DELETE FROM countdown WHERE id = ?", (cd_id,))


# ---------------------------------------------------------------------------
# 订阅
# ---------------------------------------------------------------------------


def _row_to_subscription(row: sqlite3.Row):
    from .models import Subscription

    return Subscription(
        id=row["id"],
        display_name=row["display_name"],
        source_key=row["source_key"],
        url=row["url"],
        rules_text=row["rules_text"],
        enabled=bool(row["enabled"]),
        auto_update=bool(row["auto_update"]),
        status=row["status"],
        last_synced_at=row["last_synced_at"],
        config_json=row["config_json"],
        created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
        updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
    )


def fetch_subscriptions(conn: sqlite3.Connection) -> list:
    rows = conn.execute(
        "SELECT * FROM subscriptions ORDER BY created_at, id"
    ).fetchall()
    return [_row_to_subscription(r) for r in rows]


def get_subscription(conn: sqlite3.Connection, sub_id: str):
    row = conn.execute(
        "SELECT * FROM subscriptions WHERE id = ?", (sub_id,)
    ).fetchone()
    return _row_to_subscription(row) if row else None


def upsert_subscription(conn: sqlite3.Connection, sub) -> None:
    with cursor(conn) as cur:
        cur.execute(
            "INSERT INTO subscriptions(id, display_name, source_key, url, rules_text, "
            "enabled, auto_update, status, last_synced_at, config_json) "
            "VALUES(?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, "
            "source_key=excluded.source_key, url=excluded.url, rules_text=excluded.rules_text, "
            "enabled=excluded.enabled, auto_update=excluded.auto_update, status=excluded.status, "
            "last_synced_at=excluded.last_synced_at, config_json=excluded.config_json, "
            "updated_at=datetime('now','localtime')",
            (
                sub.id, sub.display_name, sub.source_key, sub.url, sub.rules_text,
                int(sub.enabled), int(sub.auto_update), sub.status,
                sub.last_synced_at, sub.config_json,
            ),
        )


def delete_subscription(conn: sqlite3.Connection, sub_id: str) -> None:
    with cursor(conn) as cur:
        cur.execute("DELETE FROM subscriptions WHERE id = ?", (sub_id,))


def touch_subscription_synced(conn: sqlite3.Connection, sub_id: str,
                              status: str, error_note: str | None = None) -> None:
    """记录一次拉取结果：更新 status/last_synced_at（error 时把错误摘要放 config_json）。"""
    import json as _json

    row = conn.execute(
        "SELECT config_json FROM subscriptions WHERE id = ?", (sub_id,)
    ).fetchone()
    cfg = {}
    if row and row["config_json"]:
        try:
            cfg = _json.loads(row["config_json"])
        except Exception:
            cfg = {}
    if error_note:
        cfg["last_error"] = error_note[:300]
    else:
        cfg.pop("last_error", None)
    with cursor(conn) as cur:
        cur.execute(
            "UPDATE subscriptions SET status=?, last_synced_at=datetime('now','localtime'), "
            "config_json=?, updated_at=datetime('now','localtime') WHERE id=?",
            (status, _json.dumps(cfg, ensure_ascii=False), sub_id),
        )


def ensure_builtin_subscription(conn: sqlite3.Connection) -> None:
    """内置集思录订阅（幂等）。"""
    from .models import Subscription

    if get_subscription(conn, "builtin:jisilu") is None:
        upsert_subscription(conn, Subscription(
            id="builtin:jisilu",
            display_name="集思录",
            source_key="jisilu",
            enabled=True,
            auto_update=True,
            status="active",
        ))
        conn.commit()


_CN_DIGITS = "零一二三四五六七八九"


def _cn_num(n: int) -> str:
    if n <= 0:
        return _CN_DIGITS[0]
    if n < 10:
        return _CN_DIGITS[n]
    if n < 20:
        return "十" if n == 10 else "十" + _CN_DIGITS[n - 10]
    tens, ones = divmod(n, 10)
    return _CN_DIGITS[tens] + "十" + (_CN_DIGITS[ones] if ones else "")


def _countdown_event_specs(cd, today: date_t) -> list[tuple[date_t, str, int, str, int]]:
    """根据单条 countdown 推导出 (date, title, offset, color, sort_key) 列表。"""

    name = cd.name
    base = cd.base_date
    base_color = cd.color or "#FF4D4D"
    out: list[tuple[date_t, str, int, str, int]] = []

    if cd.repeat_yearly:
        for year_offset in range(-5, 11):
            try:
                d = base.replace(year=today.year + year_offset)
            except ValueError:
                d = base.replace(year=today.year + year_offset, day=28)
            out.append((d, name, 0, base_color, 0))
    else:
        out.append((base, name, 0, base_color, 0))

    if cd.milestone_rule:
        for raw in cd.milestone_rule.split(","):
            raw = raw.strip()
            if not raw.isdigit():
                continue
            days = int(raw)
            d = base + timedelta(days=days)
            if days > 0 and days % 365 == 0:
                label = f"{_cn_num(days // 365)}周年"
            else:
                label = f"{days} 天"
            out.append((d, f"{name} {label}", days, "#FFB0B0", 1))

    return out


def sync_countdown_events(conn: sqlite3.Connection) -> int:
    """根据 countdown 表重新生成 important 图层事件。

    countdown 表是纪念日/生日/节日的真源；events 表里 important 图层的事件
    只是月视图等渲染用的派生数据。每次 countdown 增删改后调用本函数，确保
    两张表一致——否则会出现「在倒数日里改了日期，月视图里旧日期的色点/文字
    还在、新日期没有」的脱节。

    保留 source='manual' 的手动事件；删除 source='migrated'/'countdown' 的
    派生事件后按当前 countdown 重新生成。返回写入事件数。
    """

    today = date_t.today()
    with cursor(conn) as cur:
        cur.execute(
            "DELETE FROM events WHERE layer_id = ? AND source IN ('migrated', 'countdown')",
            (cfg.LayerID.IMPORTANT,),
        )

    written = 0
    for cd in fetch_countdowns(conn):
        for d, title, offset, color, sort_key in _countdown_event_specs(cd, today):
            ev = Event(
                layer_id=cfg.LayerID.IMPORTANT,
                source="countdown",
                date=d,
                title=title,
                description=None,
                color=color,
                extra={
                    "auto": offset != 0,
                    "offset": offset,
                    "countdown_id": cd.id,
                },
                source_ref=f"countdown::{cd.id}::off{offset}::{d.isoformat()}",
                sort_key=sort_key,
            )
            upsert_event(conn, ev)
            written += 1
    return written
