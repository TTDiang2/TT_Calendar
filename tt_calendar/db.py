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
from .models import ColoringEntry, Event, LayerConfig, ScheduleEntry, ScheduleItem, Todo, TodoList
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
    date         TEXT NOT NULL,           -- 'YYYY-MM-DD'
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

CREATE TABLE IF NOT EXISTS countdown (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    category       TEXT NOT NULL DEFAULT '其他',
    base_date      TEXT NOT NULL,
    repeat_yearly  INTEGER DEFAULT 0,
    milestone_rule TEXT,
    never_expire   INTEGER DEFAULT 0,
    notes          TEXT,
    color          TEXT,
    sort_order     INTEGER DEFAULT 0,
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
        _ensure_schedule_item_columns(cur)
        _ensure_layer_config_columns(cur)


def _ensure_schedule_item_columns(cur: sqlite3.Cursor) -> None:
    """旧库升级：schedule_items 表缺列时补上。"""

    cols = {r["name"] for r in cur.execute("PRAGMA table_info(schedule_items)").fetchall()}
    if "category" not in cols:
        cur.execute("ALTER TABLE schedule_items ADD COLUMN category TEXT DEFAULT 'work'")


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
    )


def fetch_schedule_items_between(
    conn: sqlite3.Connection, start: date_t, end: date_t
) -> list[ScheduleItem]:
    rows = conn.execute(
        "SELECT * FROM schedule_items WHERE date >= ? AND date <= ? "
        "ORDER BY date, sort_order, start_time, id",
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    return [_row_to_schedule_item(r) for r in rows]


def upsert_schedule_item(conn: sqlite3.Connection, item: ScheduleItem) -> ScheduleItem:
    with cursor(conn) as cur:
        cur.execute(
            "INSERT INTO schedule_items(date, start_time, end_time, title, color, category, sort_order, updated_at) "
            "VALUES(?,?,?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET date=excluded.date, start_time=excluded.start_time, "
            "end_time=excluded.end_time, title=excluded.title, color=excluded.color, "
            "category=excluded.category, sort_order=excluded.sort_order, updated_at=excluded.updated_at",
            (
                item.date.isoformat(),
                item.start_time,
                item.end_time,
                item.title,
                item.color,
                item.category,
                item.sort_order,
                datetime.now().isoformat(timespec="seconds"),
            ),
        )
        if item.id is None:
            item.id = cur.lastrowid
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

    return Countdown(
        id=row["id"],
        name=row["name"],
        category=row["category"],
        base_date=parse_date(row["base_date"]),
        repeat_yearly=bool(row["repeat_yearly"]),
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
                "INSERT INTO countdown(name, category, base_date, repeat_yearly, "
                "milestone_rule, never_expire, notes, color, sort_order) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    cd.name, cd.category, cd.base_date.isoformat(),
                    int(cd.repeat_yearly), cd.milestone_rule, int(cd.never_expire),
                    cd.notes, cd.color, cd.sort_order,
                ),
            )
            cd.id = cur.lastrowid
        else:
            cur.execute(
                "UPDATE countdown SET name=?, category=?, base_date=?, repeat_yearly=?, "
                "milestone_rule=?, never_expire=?, notes=?, color=?, sort_order=?, "
                "updated_at=datetime('now','localtime') WHERE id=?",
                (
                    cd.name, cd.category, cd.base_date.isoformat(),
                    int(cd.repeat_yearly), cd.milestone_rule, int(cd.never_expire),
                    cd.notes, cd.color, cd.sort_order, cd.id,
                ),
            )


def delete_countdown(conn: sqlite3.Connection, cd_id: int) -> None:
    with cursor(conn) as cur:
        cur.execute("DELETE FROM countdown WHERE id = ?", (cd_id,))
