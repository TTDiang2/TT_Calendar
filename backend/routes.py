"""所有 HTTP 端点：视图聚合 / CRUD / 搜索 / 图层 / 倒计时 / 导入。"""

from __future__ import annotations

import csv
import io
import re
import uuid
from datetime import date as date_t, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from tt_calendar import db
from tt_calendar.config import LayerID
from tt_calendar.models import ColoringEntry, Event, LayerConfig, Mark, ScheduleEntry, ScheduleItem, Todo, TodoList
from tt_calendar.sources import get_source
from tt_calendar.sources.jisilu import JisiluSource
from tt_calendar.utils.date_utils import parse_date, shift_month

from backend import aggregator
from backend.deps import get_db
from tt_calendar.sync import engine as sync_engine
from tt_calendar.sync.providers import GitHubProvider

router = APIRouter()


# ---------------------------------------------------------------------------
# 视图聚合
# ---------------------------------------------------------------------------


@router.get("/view/month/{year}/{month}")
def get_month_view(year: int, month: int, conn=Depends(get_db)):
    days = aggregator.month_days(year, month)
    return aggregator.build_view(conn, year, month, days)


@router.get("/view/year/{year}")
def get_year_view(year: int, conn=Depends(get_db)):
    return aggregator.build_year_view(conn, year)


@router.get("/view/week/{start_date}")
def get_week_view(start_date: str, conn=Depends(get_db)):
    anchor = parse_date(start_date)
    days = aggregator.week_days(anchor)
    return aggregator.build_view(conn, anchor.year, anchor.month, days)


@router.get("/view/day/{d}")
def get_day_view(d: str, conn=Depends(get_db)):
    anchor = parse_date(d)
    return aggregator.build_view(conn, anchor.year, anchor.month, [anchor])


# ---------------------------------------------------------------------------
# 事件 CRUD
# ---------------------------------------------------------------------------


@router.post("/events")
def create_event(ev: Event, conn=Depends(get_db)):
    db.upsert_event(conn, ev)
    conn.commit()
    return ev


@router.put("/events/{event_id}")
def update_event(event_id: int, ev: Event, conn=Depends(get_db)):
    ev.id = event_id
    db.upsert_event(conn, ev)
    conn.commit()
    return ev


@router.delete("/events/{event_id}")
def delete_event(event_id: int, conn=Depends(get_db)):
    db.delete_event(conn, event_id)
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# 日程
# ---------------------------------------------------------------------------


@router.put("/schedule/{d}")
def upsert_schedule(d: str, entry: ScheduleEntry, conn=Depends(get_db)):
    entry.date = parse_date(d)
    if not any([entry.am, entry.pm, entry.ev]):
        db.delete_schedule(conn, entry.date)
    else:
        db.upsert_schedule(conn, entry)
    conn.commit()
    return entry


@router.get("/schedule-items/{d}")
def list_schedule_items(d: str, conn=Depends(get_db)):
    anchor = parse_date(d)
    items = db.fetch_schedule_items_between(conn, anchor, anchor)
    return [i.model_dump(mode="json") for i in items]


@router.post("/schedule-items")
def create_schedule_item(item: ScheduleItem, conn=Depends(get_db)):
    saved = db.upsert_schedule_item(conn, item)
    conn.commit()
    return saved.model_dump(mode="json")


@router.put("/schedule-items/{item_id}")
def update_schedule_item(item_id: int, item: ScheduleItem, conn=Depends(get_db)):
    item.id = item_id
    saved = db.upsert_schedule_item(conn, item)
    conn.commit()
    return saved.model_dump(mode="json")


@router.delete("/schedule-items/{item_id}")
def delete_schedule_item(item_id: int, conn=Depends(get_db)):
    db.delete_schedule_item(conn, item_id)
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# 充实度
# ---------------------------------------------------------------------------


class ColoringBody(BaseModel):
    level: int


@router.put("/coloring/{d}")
def upsert_coloring(d: str, body: ColoringBody, conn=Depends(get_db)):
    entry = ColoringEntry(date=parse_date(d), level=body.level)
    db.upsert_coloring(conn, entry)
    conn.commit()
    return {"ok": True}


@router.delete("/coloring/{d}")
def delete_coloring(d: str, conn=Depends(get_db)):
    db.delete_coloring(conn, parse_date(d))
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# 涂色标记（打卡 / 自定义完成度）
# ---------------------------------------------------------------------------


class MarkBody(BaseModel):
    layer_id: str
    date: str
    level: Optional[int] = None
    note: Optional[str] = None


@router.post("/marks")
def upsert_mark(body: MarkBody, conn=Depends(get_db)):
    mark = Mark(
        layer_id=body.layer_id,
        date=parse_date(body.date),
        level=body.level,
        note=body.note,
    )
    db.upsert_mark(conn, mark)
    conn.commit()
    return {"ok": True}


@router.delete("/marks/{layer_id}/{date}")
def delete_mark(layer_id: str, date: str, conn=Depends(get_db)):
    db.delete_mark(conn, layer_id, parse_date(date))
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# 图层
# ---------------------------------------------------------------------------


class LayerToggleBody(BaseModel):
    enabled: bool


class LayerSubActionRule(BaseModel):
    qtype: str
    sub_action: str | None = None  # null = 该 qtype 下所有子动作


class LayerConfigBody(BaseModel):
    enabled: bool | None = None
    sub_qtypes: list[LayerSubActionRule] | None = None  # null/[] = 不过滤


@router.get("/layers")
def list_layers(conn=Depends(get_db)):
    return [l.model_dump(mode="json") for l in db.fetch_layer_configs(conn)]


@router.put("/layers/{layer_id}")
def update_layer(layer_id: str, body: LayerToggleBody, conn=Depends(get_db)):
    for l in db.fetch_layer_configs(conn):
        if l.layer_id == layer_id:
            l.enabled = body.enabled
            db.upsert_layer_config(conn, l)
            conn.commit()
            return l.model_dump(mode="json")
    raise HTTPException(404, f"layer {layer_id} not found")


@router.put("/layers/{layer_id}/config")
def update_layer_config(layer_id: str, body: LayerConfigBody, conn=Depends(get_db)):
    for l in db.fetch_layer_configs(conn):
        if l.layer_id == layer_id:
            if body.enabled is not None:
                l.enabled = body.enabled
            if body.sub_qtypes is not None:
                cfg = dict(l.config or {})
                if body.sub_qtypes:
                    cfg["sub_qtypes"] = [r.model_dump(exclude_none=True) for r in body.sub_qtypes]
                else:
                    cfg.pop("sub_qtypes", None)
                l.config = cfg
            db.upsert_layer_config(conn, l)
            conn.commit()
            return l.model_dump(mode="json")
    raise HTTPException(404, f"layer {layer_id} not found")


@router.get("/layers/{layer_id}/sub-actions")
def list_layer_sub_actions(layer_id: str, conn=Depends(get_db)):
    """扫描 DB 中该图层（jisilu_ 前缀）下出现过的 (qtype, sub_action) 组合，供设置页勾选用。"""
    if not layer_id.startswith("jisilu_"):
        raise HTTPException(400, "只支持 jisilu_ 图层")
    qtype = layer_id[len("jisilu_"):]
    rows = conn.execute(
        "SELECT title FROM events WHERE layer_id = ?",
        (layer_id,),
    ).fetchall()
    pairs: set[tuple[str, str]] = set()
    for (t,) in rows:
        m = re.match(r"^【(.+?)】", t or "")
        if m:
            pairs.add((qtype, m.group(1)))
    # 没事件时给一个空集合，让前端知道没数据
    return [{"qtype": q, "sub_action": s} for q, s in sorted(pairs)]


class CreateLayerBody(BaseModel):
    display_name: str
    color: str | None = None
    kind: str = "color"
    group: str | None = None
    config: dict = {}


@router.post("/layers")
def create_layer(body: CreateLayerBody, conn=Depends(get_db)):
    layer_id = f"custom_{uuid.uuid4().hex[:12]}"
    layer = LayerConfig(
        layer_id=layer_id,
        display_name=body.display_name,
        enabled=True,
        color=body.color,
        sort_order=10,
        kind=body.kind,
        group=body.group,
        config=body.config,
    )
    db.upsert_layer_config(conn, layer)
    conn.commit()
    return layer.model_dump(mode="json")


@router.delete("/layers/{layer_id}")
def delete_layer(layer_id: str, conn=Depends(get_db)):
    layer = next((l for l in db.fetch_layer_configs(conn) if l.layer_id == layer_id), None)
    if layer is None:
        raise HTTPException(404, f"layer {layer_id} not found")
    if not layer_id.startswith("custom_"):
        raise HTTPException(400, "内置图层不可删除")
    db.delete_layer_config(conn, layer_id)
    conn.execute("DELETE FROM events WHERE layer_id = ?", (layer_id,))
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# 拖拽改期
# ---------------------------------------------------------------------------


class MoveDayBody(BaseModel):
    src: str
    dst: str


@router.post("/move-day")
def move_day(body: MoveDayBody, conn=Depends(get_db)):
    src = parse_date(body.src)
    dst = parse_date(body.dst)
    moved_events, moved_schedule = db.move_day_content(conn, src, dst)
    conn.commit()
    return {"moved_events": moved_events, "moved_schedule": moved_schedule}


# ---------------------------------------------------------------------------
# 搜索
# ---------------------------------------------------------------------------


@router.get("/search")
def search(q: str = Query(..., min_length=1), conn=Depends(get_db)):
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT * FROM events WHERE title LIKE ? OR description LIKE ? "
        "ORDER BY date DESC LIMIT 100",
        (f"%{q}%", f"%{q}%"),
    ).fetchall()
    from tt_calendar.db import _row_to_event
    return [e.model_dump(mode="json") for e in (_row_to_event(r) for r in rows)]


# ---------------------------------------------------------------------------
# 倒数日（独立 countdown 表）
# ---------------------------------------------------------------------------


@router.get("/countdown")
def countdown(conn=Depends(get_db)):
    return {"text": aggregator.build_countdown(conn)}


@router.get("/countdown/list")
def countdown_list(conn=Depends(get_db)):
    return aggregator.build_countdown_list(conn)


class CountdownIn(BaseModel):
    name: str
    category: str = "其他"
    base_date: str
    repeat_yearly: bool = False
    repeat_type: str = "solar"      # solar | lunar
    milestone_rule: Optional[str] = None
    never_expire: bool = False
    notes: Optional[str] = None
    color: Optional[str] = None
    sort_order: int = 0


@router.post("/countdown")
def create_countdown(body: CountdownIn, conn=Depends(get_db)):
    cd = _countdown_from_in(body)
    db.upsert_countdown(conn, cd)
    db.sync_countdown_events(conn)
    conn.commit()
    return _countdown_to_json(conn, cd)


@router.put("/countdown/{cd_id}")
def update_countdown(cd_id: int, body: CountdownIn, conn=Depends(get_db)):
    existing = conn.execute("SELECT id FROM countdown WHERE id = ?", (cd_id,)).fetchone()
    if not existing:
        raise HTTPException(404, "countdown not found")
    cd = _countdown_from_in(body)
    cd.id = cd_id
    db.upsert_countdown(conn, cd)
    db.sync_countdown_events(conn)
    conn.commit()
    return _countdown_to_json(conn, cd)


@router.delete("/countdown/{cd_id}")
def delete_countdown(cd_id: int, conn=Depends(get_db)):
    db.delete_countdown(conn, cd_id)
    db.sync_countdown_events(conn)
    conn.commit()
    return {"ok": True}


def _countdown_from_in(body: CountdownIn):
    from tt_calendar.models import Countdown

    return Countdown(
        name=body.name.strip(),
        category=body.category.strip() or "其他",
        base_date=parse_date(body.base_date),
        repeat_yearly=body.repeat_yearly,
        repeat_type=body.repeat_type if body.repeat_type in ("solar", "lunar") else "solar",
        milestone_rule=(body.milestone_rule or "").strip() or None,
        never_expire=body.never_expire,
        notes=body.notes,
        color=body.color,
        sort_order=body.sort_order,
    )


def _countdown_to_json(conn, cd):
    target_id = cd.id
    for item in aggregator.build_countdown_list(conn):
        if item["id"] == target_id:
            return item
    return cd.model_dump(mode="json")


# ---------------------------------------------------------------------------
# 设置：待办忙度算法配置
# ---------------------------------------------------------------------------


@router.get("/settings/todo-busy")
def get_todo_busy_config(conn=Depends(get_db)):
    return db.get_todo_busy_config(conn)


@router.put("/settings/todo-busy")
def put_todo_busy_config(body: dict, conn=Depends(get_db)):
    cfg = db.DEFAULT_TODO_BUSY_CONFIG | body
    db.set_todo_busy_config(conn, cfg)
    conn.commit()
    return cfg


@router.post("/settings/todo-busy/recompute")
def recompute_day_busy_all(conn=Depends(get_db)):
    """调参后全量重算 day_busy：扫所有 todo 的受影响日期，逐个重算 predict + done。"""
    return {"days_written": _recompute_day_busy(conn)}


# ---------------------------------------------------------------------------
# 设置：每日提醒配置
# ---------------------------------------------------------------------------


@router.get("/settings/todo-reminder")
def get_todo_reminder_config(conn=Depends(get_db)):
    return db.get_todo_reminder_config(conn)


@router.put("/settings/todo-reminder")
def put_todo_reminder_config(body: dict, conn=Depends(get_db)):
    cfg = db.get_todo_reminder_config(conn)
    if "enabled" in body:
        cfg["enabled"] = bool(body["enabled"])
    if "time" in body and isinstance(body["time"], str):
        cfg["time"] = body["time"]
    db.set_todo_reminder_config(conn, cfg)
    conn.commit()
    return db.get_todo_reminder_config(conn)


def _recompute_day_busy(conn) -> int:
    cfg = db.get_todo_busy_config(conn)
    rows = conn.execute(
        "SELECT id, due_date, planned_date, completed_at FROM todo "
        "WHERE due_date IS NOT NULL OR planned_date IS NOT NULL OR completed_at IS NOT NULL"
    ).fetchall()
    dates: set[date_t] = set()
    for r in rows:
        for col in ("due_date", "planned_date"):
            if r[col]:
                try: dates.add(parse_date(r[col]))
                except Exception: pass
        if r["completed_at"]:
            try: dates.add(datetime.fromisoformat(r["completed_at"]).date())
            except Exception: pass
    written = 0
    for d in dates:
        predict_todos = [t for t in db.fetch_todos_between(conn, d, d).get(d, [])
                         if t.status != "completed"]
        done_todos = db.fetch_todos_completed_on(conn, d)
        predict_level = aggregator.compute_todo_busy_level(d, predict_todos, cfg, mode="predict")
        done_level = aggregator.compute_todo_busy_level(d, done_todos, cfg, mode="done")
        db.upsert_day_busy(conn, d, predict_level, done_level)
        written += 1
    return written


# ---------------------------------------------------------------------------
# 多端同步
# ---------------------------------------------------------------------------


@router.get("/sync/status")
def sync_status(conn=Depends(get_db)):
    st = sync_engine.last_status(conn)
    return {"configured": sync_engine.is_configured(conn), **st}


@router.get("/sync/config")
def sync_get_config(conn=Depends(get_db)):
    cfg = sync_engine.get_sync_config(conn)
    return {"repo": cfg["repo"], "branch": cfg["branch"],
            "auto_on_start": cfg["auto_on_start"],
            "sync_on_close": cfg["sync_on_close"],
            "has_token": bool(cfg["token_dpapi"])}


@router.put("/sync/config")
def sync_put_config(body: dict, conn=Depends(get_db)):
    sync_engine.save_sync_config(
        conn, body.get("repo", ""), body.get("branch", "main") or "main",
        body.get("token"), bool(body.get("auto_on_start", True)),
        bool(body.get("sync_on_close", True)))
    return {"ok": True}


@router.post("/sync/test")
def sync_test(conn=Depends(get_db)):
    try:
        return sync_engine.test_connection(conn)
    except sync_engine.SyncError as e:
        return {"ok": False, "detail": str(e)}


@router.post("/sync/now")
def sync_now(conn=Depends(get_db)):
    try:
        return sync_engine.sync_now(conn, on_imported=_recompute_day_busy)
    except sync_engine.NeedsDecision as e:
        raise HTTPException(409, detail={"needs_decision": True,
                                         "remote_rows": e.remote_pulled})
    except (sync_engine.SyncError, OSError) as e:
        raise HTTPException(400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        # 未预期异常若穿透出去，500 由最外层中间件生成、不带 CORS 头，
        # 前端只能看到 "Failed to fetch"。必须就地转成 HTTPException。
        raise HTTPException(500, detail=f"同步内部错误：{e!r}")


@router.post("/sync/resolve")
def sync_resolve(body: dict, conn=Depends(get_db)):
    try:
        return sync_engine.resolve_first_bind(
            conn, body.get("mode", ""), on_imported=_recompute_day_busy)
    except (sync_engine.SyncError, OSError) as e:
        raise HTTPException(400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, detail=f"同步内部错误：{e!r}")


# ---------------------------------------------------------------------------
# 统计
# ---------------------------------------------------------------------------


@router.get("/stats/summary")
def stats_summary(conn=Depends(get_db)):
    """统计面板聚合：四象限散点（未完成待办）+ 逐日完成 + 分布。"""

    todos = db.fetch_todos(conn, status_filter="all", sort="due_importance")
    today = date_t.today()
    incomplete = []
    for t in todos:
        if t.status == "completed":
            continue
        d = t.due_date
        incomplete.append({
            "id": t.id,
            "title": t.title,
            "list_id": t.list_id,
            "importance": t.importance,
            "due_date": d.isoformat() if d else None,
            "days_to_due": (d - today).days if d else None,
        })

    lists = {l.id: l.display_name for l in db.fetch_todo_lists(conn)}
    return {
        "quadrant": incomplete,
        "daily_done": db.daily_completed(conn, 90),
        "stats": db.count_todos(conn),
        "list_names": lists,
    }


# ---------------------------------------------------------------------------
# 集思录导入
# ---------------------------------------------------------------------------


class ImportBody(BaseModel):
    start: str
    end: str
    qtypes: Optional[list[str]] = None


@router.post("/import/jisilu")
async def import_jisilu(body: ImportBody, conn=Depends(get_db)):
    source = None
    try:
        source = get_source("jisilu")
        if source is None or not isinstance(source, JisiluSource):
            return {"inserted": 0, "error": "jisilu source unavailable"}
        start = parse_date(body.start)
        end = parse_date(body.end)
        events, result = await source.fetch(start, end, qtypes=body.qtypes)
        enabled_ids = {l.layer_id for l in db.fetch_layer_configs(conn) if l.enabled}
        inserted = 0
        for ev in events:
            if ev.layer_id not in enabled_ids:
                continue
            db.upsert_event(conn, ev)
            inserted += 1
        conn.commit()
        await source.close()
        return {"inserted": inserted, "error": result.error}
    except Exception as e:
        if source:
            await source.close()
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# 订阅（外部日历数据源；适配规范见 docs/SUBSCRIPTION_SPEC.md）
# ---------------------------------------------------------------------------


async def _fetch_jisilu_range(conn, start: date_t, end: date_t) -> tuple[int, str | None]:
    """集思录抓取核心（区间 → 写 events，按图层开关过滤）。"""
    source = None
    try:
        source = get_source("jisilu")
        if source is None or not isinstance(source, JisiluSource):
            return 0, "jisilu source unavailable"
        events, result = await source.fetch(start, end)
        enabled_ids = {l.layer_id for l in db.fetch_layer_configs(conn) if l.enabled}
        inserted = 0
        for ev in events:
            if ev.layer_id not in enabled_ids:
                continue
            db.upsert_event(conn, ev)
            inserted += 1
        conn.commit()
        return inserted, result.error
    finally:
        if source:
            await source.close()


def _refresh_one_subscription(conn, sub) -> dict:
    """按 source_key 分发刷新。未知的 source_key = 待适配，返回需要提示。"""
    if sub.source_key == "jisilu":
        start = date_t.today() - timedelta(days=180)
        if sub.last_synced_at:
            try:
                start = max(start, datetime.fromisoformat(sub.last_synced_at).date())
            except Exception:
                pass
        end = date_t.today() + timedelta(days=90)
        try:
            inserted, err = asyncio_run(_fetch_jisilu_range(conn, start, end))
        except Exception as e:
            db.touch_subscription_synced(conn, sub.id, "error", str(e))
            conn.commit()
            return {"id": sub.id, "ok": False, "error": str(e)}
        if err:
            db.touch_subscription_synced(conn, sub.id, "error", err)
            conn.commit()
            return {"id": sub.id, "ok": False, "error": err, "inserted": inserted}
        db.touch_subscription_synced(conn, sub.id, "active")
        conn.commit()
        return {"id": sub.id, "ok": True, "inserted": inserted}
    return {"id": sub.id, "ok": False, "error": "pending_adaptation"}


def asyncio_run(coro):
    import asyncio as _asyncio
    try:
        loop = _asyncio.get_running_loop()
    except RuntimeError:
        return _asyncio.run(coro)
    import concurrent.futures as _cf
    with _cf.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(_asyncio.run, coro).result()


class SubscriptionIn(BaseModel):
    display_name: str
    url: str = ""
    rules_text: str = ""
    auto_update: bool = True


class SubscriptionPatch(BaseModel):
    display_name: Optional[str] = None
    enabled: Optional[bool] = None
    auto_update: Optional[bool] = None


@router.get("/subscriptions")
def list_subscriptions(conn=Depends(get_db)):
    out = []
    for s in db.fetch_subscriptions(conn):
        d = s.model_dump(mode="json")
        cfg = {}
        if s.config_json:
            try:
                cfg = __import__("json").loads(s.config_json)
            except Exception:
                pass
        d["last_error"] = cfg.get("last_error")
        out.append(d)
    return out


@router.post("/subscriptions")
def create_subscription(body: SubscriptionIn, conn=Depends(get_db)):
    from tt_calendar.models import Subscription

    name = body.display_name.strip()
    if not name:
        raise HTTPException(400, "标题不能为空")
    sub = Subscription(
        id=str(uuid.uuid4()),
        display_name=name,
        source_key=f"custom:{uuid.uuid4().hex[:8]}",
        url=body.url.strip() or None,
        rules_text=body.rules_text.strip() or None,
        auto_update=body.auto_update,
        status="pending",
    )
    db.upsert_subscription(conn, sub)
    conn.commit()
    return sub.model_dump(mode="json")


@router.patch("/subscriptions/{sub_id}")
def patch_subscription(sub_id: str, body: SubscriptionPatch, conn=Depends(get_db)):
    sub = db.get_subscription(conn, sub_id)
    if not sub:
        raise HTTPException(404, "订阅不存在")
    if body.display_name is not None:
        sub.display_name = body.display_name.strip() or sub.display_name
    if body.enabled is not None:
        sub.enabled = body.enabled
    if body.auto_update is not None:
        sub.auto_update = body.auto_update
    db.upsert_subscription(conn, sub)
    conn.commit()
    return sub.model_dump(mode="json")


@router.delete("/subscriptions/{sub_id}")
def delete_subscription(sub_id: str, conn=Depends(get_db)):
    if sub_id == "builtin:jisilu":
        raise HTTPException(400, "内置订阅不可删除（可关闭）")
    if not db.get_subscription(conn, sub_id):
        raise HTTPException(404, "订阅不存在")
    db.delete_subscription(conn, sub_id)
    conn.commit()
    return {"ok": True}


@router.post("/subscriptions/{sub_id}/refresh")
def refresh_subscription(sub_id: str, conn=Depends(get_db)):
    sub = db.get_subscription(conn, sub_id)
    if not sub:
        raise HTTPException(404, "订阅不存在")
    if sub.status == "pending":
        raise HTTPException(400, "该订阅待 agent 适配，暂不能拉取（见 docs/SUBSCRIPTION_SPEC.md）")
    return _refresh_one_subscription(conn, sub)


@router.post("/subscriptions/refresh-due")
def refresh_due_subscriptions(conn=Depends(get_db)):
    """启动时批量刷新：enabled + auto_update + 今日未刷新过的订阅。"""
    from datetime import datetime as _dt

    today = _dt.now().strftime("%Y-%m-%d")
    results = []
    for sub in db.fetch_subscriptions(conn):
        if not (sub.enabled and sub.auto_update and sub.status == "active"):
            continue
        if sub.last_synced_at and sub.last_synced_at[:10] >= today:
            continue
        results.append(_refresh_one_subscription(conn, sub))
    return {"refreshed": results}


# ---------------------------------------------------------------------------
# Todo 列表
# ---------------------------------------------------------------------------


@router.get("/todo/lists")
def list_todo_lists(conn=Depends(get_db)):
    return [t.model_dump(mode="json") for t in db.fetch_todo_lists(conn)]


class TodoListIn(BaseModel):
    display_name: str
    sort_order: int = 0


@router.post("/todo/lists")
def create_todo_list(body: TodoListIn, conn=Depends(get_db)):
    tl = TodoList(id=str(uuid.uuid4()), display_name=body.display_name, sort_order=body.sort_order)
    db.upsert_todo_list(conn, tl)
    conn.commit()
    return tl.model_dump(mode="json")


class ReorderBody(BaseModel):
    ordered_ids: list[str]


@router.put("/todo/lists/reorder")
def reorder_todo_lists(body: ReorderBody, conn=Depends(get_db)):
    db.reorder_todo_lists(conn, body.ordered_ids)
    conn.commit()
    return {"ok": True}


@router.put("/todo/reorder")
def reorder_todos_api(body: ReorderBody, conn=Depends(get_db)):
    db.reorder_todos(conn, body.ordered_ids)
    conn.commit()
    return {"ok": True}


@router.put("/todo/lists/{list_id}")
def update_todo_list(list_id: str, body: TodoListIn, conn=Depends(get_db)):
    tl = TodoList(id=list_id, display_name=body.display_name, sort_order=body.sort_order)
    db.upsert_todo_list(conn, tl)
    conn.commit()
    return tl.model_dump(mode="json")


@router.delete("/todo/lists/{list_id}")
def delete_todo_list(list_id: str, conn=Depends(get_db)):
    db.delete_todo_list(conn, list_id)
    conn.commit()
    return {"ok": True}

# ---------------------------------------------------------------------------
# Todo 任务
# ---------------------------------------------------------------------------


@router.get("/todo")
def list_todos(
    list_id: Optional[str] = Query(None),
    status: str = Query("notStarted"),
    sort: str = Query("due_importance"),
    limit: Optional[int] = Query(None),
    completed_on: Optional[str] = Query(None),
    conn=Depends(get_db),
):
    if completed_on:
        d = parse_date(completed_on)
        return [t.model_dump(mode="json") for t in db.fetch_todos_completed_on(conn, d)]
    return [t.model_dump(mode="json") for t in db.fetch_todos(conn, list_id, status, sort, limit)]


@router.get("/todo/stats")
def todo_stats(list_id: Optional[str] = Query(None), conn=Depends(get_db)):
    return db.count_todos(conn, list_id)


class TodoIn(BaseModel):
    id: Optional[str] = None
    list_id: str
    title: str
    body: Optional[str] = None
    status: str = "notStarted"
    importance: str = "normal"
    due_date: Optional[str] = None
    planned_date: Optional[str] = None
    start_date: Optional[str] = None
    complexity: str = "medium"
    tags: Optional[list[str]] = None
    sort_order: int = 0


def _todo_from_in(body: TodoIn) -> Todo:
    tid = body.id or str(uuid.uuid4())
    completed_at = None
    if body.status == "completed":
        completed_at = datetime.now().isoformat()
    return Todo(
        id=tid,
        list_id=body.list_id,
        title=body.title,
        body=body.body,
        status=body.status,
        importance=body.importance,
        due_date=parse_date(body.due_date) if body.due_date else None,
        planned_date=parse_date(body.planned_date) if body.planned_date else None,
        start_date=parse_date(body.start_date) if body.start_date else None,
        complexity=body.complexity or "medium",
        tags=body.tags or None,
        completed_at=completed_at,
        sort_order=body.sort_order,
    )


def _completed_date(t: Todo | None) -> date_t | None:
    """提取 todo.completed_at 的 date 部分；为空或格式异常返回 None。
    db._row_to_todo 会把 completed_at 解析成 datetime 对象，_todo_from_in 则保留字符串，
    所以这里两种都要兼容。
    """
    if t is None or not t.completed_at:
        return None
    if isinstance(t.completed_at, datetime):
        return t.completed_at.date()
    try:
        return datetime.fromisoformat(t.completed_at).date()
    except Exception:
        return None


def _recompute_day_busy_for_todo(
    conn,
    todo_id: str,
    old: Todo | None,
    new: Todo | None,
) -> None:
    """todo CRUD 后增量刷新 day_busy 快照。

    受影响日期 = old 的 (due, planned, completed_date) ∪ new 的 (due, planned, completed_date)
    每个受影响日期都重算 predict_level + done_level 写回（不写就删除）。
    """
    cfg = db.get_todo_busy_config(conn)
    dates: set[date_t] = set()
    for t in (old, new):
        if t is None:
            continue
        if t.due_date: dates.add(t.due_date)
        if t.planned_date: dates.add(t.planned_date)
        cd = _completed_date(t)
        if cd: dates.add(cd)
    if not dates:
        return

    today = date_t.today()
    for d in dates:
        start = end = d
        predict_todos = [t for t in db.fetch_todos_between(conn, start, end).get(d, [])
                         if t.status != "completed"]
        done_todos = db.fetch_todos_completed_on(conn, d)
        predict_level = aggregator.compute_todo_busy_level(d, predict_todos, cfg, mode="predict")
        done_level = aggregator.compute_todo_busy_level(d, done_todos, cfg, mode="done")
        db.upsert_day_busy(conn, d, predict_level, done_level)


@router.post("/todo")
def create_todo(body: TodoIn, conn=Depends(get_db)):
    t = _todo_from_in(body)
    db.upsert_todo(conn, t)
    _recompute_day_busy_for_todo(conn, todo_id=t.id, old=None, new=t)
    conn.commit()
    return t.model_dump(mode="json")


@router.put("/todo/{todo_id}")
def update_todo(todo_id: str, body: TodoIn, conn=Depends(get_db)):
    existing = conn.execute("SELECT completed_at FROM todo WHERE id = ?", (todo_id,)).fetchone()
    old_todo = db.get_todo(conn, todo_id)
    t = _todo_from_in(body)
    t.id = todo_id
    # 保留已完成的 completed_at（避免每次 PUT 重置时间）
    if body.status == "completed" and existing and existing["completed_at"]:
        t.completed_at = datetime.fromisoformat(existing["completed_at"])
    db.upsert_todo(conn, t)
    _recompute_day_busy_for_todo(conn, todo_id=todo_id, old=old_todo, new=t)
    conn.commit()
    return t.model_dump(mode="json")


@router.delete("/todo/{todo_id}")
def delete_todo(todo_id: str, conn=Depends(get_db)):
    old_todo = db.get_todo(conn, todo_id)
    db.delete_todo(conn, todo_id)
    if old_todo is not None:
        _recompute_day_busy_for_todo(conn, todo_id=todo_id, old=old_todo, new=None)
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Todo CSV 导入
# ---------------------------------------------------------------------------


@router.post("/todo/import/csv")
def import_todos_csv(file: UploadFile = File(...), conn=Depends(get_db)):
    raw = file.file.read()
    text = None
    for enc in ("utf-8-sig", "utf-8", "gbk", "gb2312"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise HTTPException(400, "无法解码 CSV（试过 utf-8/gbk）")

    reader = csv.DictReader(io.StringIO(text))
    expected = {"title", "due_date", "importance", "status", "list_name", "body"}
    if reader.fieldnames is None or not expected.issubset(set(reader.fieldnames)):
        raise HTTPException(400, f"CSV 表头需含: {','.join(sorted(expected))}")
    # list_name → list_id 映射，按需自动创建
    list_cache: dict[str, str] = {}
    for tl in db.fetch_todo_lists(conn):
        list_cache[tl.display_name] = tl.id

    inserted = 0
    lists_created = 0
    errors: list[str] = []
    for i, row in enumerate(reader, start=2):  # 行号从 2 开始（1 是表头）
        title = (row.get("title") or "").strip()
        if not title:
            errors.append(f"第 {i} 行: title 为空，跳过")
            continue

        list_name = (row.get("list_name") or "已导入").strip() or "已导入"
        if list_name not in list_cache:
            tl = TodoList(id=str(uuid.uuid4()), display_name=list_name, sort_order=100 + lists_created)
            db.upsert_todo_list(conn, tl)
            list_cache[list_name] = tl.id
            lists_created += 1

        imp_raw = (row.get("importance") or "normal").strip().lower()
        importance = imp_raw if imp_raw in ("low", "normal", "high") else "normal"
        status_raw = (row.get("status") or "notStarted").strip().lower()
        status = status_raw if status_raw in ("notStarted", "inProgress", "completed", "waitingOnOthers", "deferred") else "notStarted"

        due_raw = (row.get("due_date") or "").strip()
        due_date = None
        if due_raw:
            try:
                due_date = parse_date(due_raw)
            except Exception:
                errors.append(f"第 {i} 行: due_date 格式错误 '{due_raw}'，按无到期日处理")

        completed_at = datetime.now().isoformat() if status == "completed" else None
        start_raw = (row.get("start_date") or "").strip()
        start_date = None
        if start_raw:
            try:
                start_date = parse_date(start_raw)
            except Exception:
                errors.append(f"第 {i} 行: start_date 格式错误 '{start_raw}'，按无开始日处理")

        complexity_raw = (row.get("complexity") or "medium").strip().lower()
        complexity = complexity_raw if complexity_raw in ("simple", "medium", "hard") else "medium"
        tags_raw = (row.get("tags") or "").strip()
        tags = [t.strip() for t in tags_raw.split(",") if t.strip()] or None

        t = Todo(
            id=str(uuid.uuid4()),
            list_id=list_cache[list_name],
            title=title,
            body=(row.get("body") or "").strip() or None,
            status=status,
            importance=importance,
            due_date=due_date,
            start_date=start_date,
            complexity=complexity,
            tags=tags,
            completed_at=completed_at,
        )
        db.upsert_todo(conn, t)
        inserted += 1

    conn.commit()
    return {"inserted": inserted, "lists_created": lists_created, "errors": errors}
