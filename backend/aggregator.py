"""视图聚合逻辑：把 DB 数据组装成前端渲染所需的 JSON。

复用现有 tt_calendar 业务层（db / layers / gradient / chinese_calendar）。
对应 docs/MIGRATION_PLAN.md §6.1 的月/周/日聚合响应结构。
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Iterable

import chinese_calendar as cc

from tt_calendar import db
from tt_calendar.config import LayerID
from tt_calendar.models import Event, ScheduleEntry
from tt_calendar.sources.base import sub_filter_pattern
from tt_calendar.utils.date_utils import month_grid, month_range
from tt_calendar.utils.lunar_utils import lunar_display


def _sub_filter_of(layer_cfg: dict | None) -> tuple[str, re.Pattern[str]] | None:
    """读取图层声明的子动作规则；未声明/非法则 None。解析实现在协议层。"""
    return sub_filter_pattern(layer_cfg)


def _sub_action_of(pattern: re.Pattern[str], title: str) -> str | None:
    """按图层声明的正则从标题提取子动作；不匹配则 None。"""
    m = pattern.match(title or "")
    return m.group(1) if m else None


def apply_subscription_switch(conn, layers: list) -> tuple[list, set]:
    """订阅级开关：关闭订阅 → 其名下图层整组退出聚合与导航。

    约定（同 Sidebar）：订阅 display_name 与其图层的 group 名一致。
    返回 (过滤后的图层列表, 被剔除的 layer_id 集合)。
    """
    disabled_names = {s.display_name for s in db.fetch_subscriptions(conn) if not s.enabled}
    if not disabled_names:
        return layers, set()
    removed_ids = {l.layer_id for l in layers if l.group and l.group in disabled_names}
    if not removed_ids:
        return layers, removed_ids
    return [l for l in layers if l.layer_id not in removed_ids], removed_ids


def _event_passes_layer_filter(
    ev: Event,
    layer_cfg: dict | None,
) -> bool:
    """判断 event 是否通过 layer 的 sub_qtypes / min_importance 过滤。

    layer_cfg 为 None 或不含相关键 → 不过滤（向后兼容，全显示）。
    sub_qtypes 格式：[{qtype: str, sub_action: str | null}, ...]
      - sub_action 为 null 表示该 qtype 下所有子动作都通过
      - sub_action 为 str 表示只有该 (qtype, sub_action) 精确匹配才通过
    min_importance（int）：>0 时仅显示 extra.importance >= min 的事件
      （investing 插件按重要性星级过滤；0 或缺失键 = 不过滤）。
    两个过滤相互独立、AND 组合。
    """
    if not layer_cfg:
        return True
    min_imp = layer_cfg.get("min_importance")
    if min_imp:
        try:
            min_imp = int(min_imp)
        except (TypeError, ValueError):
            min_imp = 0
        if min_imp > 0:
            imp = (ev.extra or {}).get("importance")
            try:
                imp = int(imp) if imp is not None else 0
            except (TypeError, ValueError):
                imp = 0
            if imp < min_imp:
                return False
    sq = layer_cfg.get("sub_qtypes") or []
    if not sq:
        return True
    sf = _sub_filter_of(layer_cfg)
    if sf is None:
        return True
    group_key, pattern = sf
    ev_group = (ev.extra or {}).get(group_key)
    if not ev_group:
        # 事件不属于任何子动作分组（如手工建的日程）→ 不受该层控制
        return True
    ev_sa = _sub_action_of(pattern, ev.title)
    for rule in sq:
        # 规则项的 "qtype" 是历史落库字段名，语义上等于本层声明的 group_key
        if rule.get("qtype") != ev_group:
            continue
        rule_sa = rule.get("sub_action")
        if rule_sa is None or rule_sa == "":
            return True
        if rule_sa == ev_sa:
            return True
    return False


def _holiday_of(d: date) -> dict | None:
    """用 chinese_calendar 判定节假日 + 调休补班。"""

    try:
        on_h, name = cc.get_holiday_detail(d)
    except Exception:
        return None
    out: dict = {}
    if on_h and name:
        out["name"] = name
    if cc.is_workday(d) and d.weekday() >= 5:
        out["is_workday_made_up"] = True
    return out or None


# 设置面板用三档「高/中/低」当权重键，Todo 模型却用另一套词汇：
# importance 是 low|normal|high，complexity 是 simple|medium|hard。两套词汇没有
# 任何映射，直接 comp.get(t.complexity) 永远 miss 并回落到 medium 权重——于是
# hard 与 simple 算出来完全一样，用户调「复杂度」对评分毫无作用（死键）。
# importance 侧只是侥幸正确：normal 恰好回落到 medium 键。
# 这里显式对齐，让设置真正生效。
_IMPORTANCE_KEY = {"low": "low", "normal": "medium", "high": "high"}
_COMPLEXITY_KEY = {"simple": "low", "medium": "medium", "hard": "high"}


def compute_todo_busy_level(
    d: date,
    todos: list,
    cfg: dict,
    mode: str = "predict",
) -> int | None:
    """按 config 权重把当日 todo 折算成 0..4 档；无 todo 返回 None。

    mode='predict': todos 已经是「未完成 todo」+ due/planned 命中当日
    mode='done': todos 已经是「completed_at 命中当日」的所有 todo（含完成时 due 哪天无所谓）
    """
    if not todos:
        return None
    w = cfg["weights"]
    imp = w["importance"]
    comp = w["complexity"]
    score = 0.0
    for t in todos:
        # fetch_todos_between 把同一条 todo 同时挂到 due_date 和 planned_date 两个日期
        # → 累加是设计意图（用户特意标两个日期就是想强调那天）
        if t.due_date == d:
            score += w["due_date"]
        if t.planned_date == d:
            score += w["planned_date"]
        score += (imp.get(_IMPORTANCE_KEY.get(t.importance, "medium"), 1)
                  * comp.get(_COMPLEXITY_KEY.get(t.complexity, "medium"), 1))
    thresholds = cfg["thresholds"]
    level = 0
    for i in range(4, -1, -1):
        if score >= thresholds[i]:
            level = i
            break
    return level if score >= thresholds[0] else None





    """用 chinese_calendar 判定节假日 + 调休补班。"""

    try:
        on_h, name = cc.get_holiday_detail(d)
    except Exception:
        return None
    out: dict = {}
    if on_h and name:
        out["name"] = name
    if cc.is_workday(d) and d.weekday() >= 5:
        out["is_workday_made_up"] = True
    return out or None


def _custom_layer_color(
    d: date,
    ev_by_layer: dict,
    todos: list,
    custom_layers: list,
    marks_by_date: dict | None = None,
) -> tuple[str, str] | None:
    """计算自定义涂色图层对某天的染色。

    custom_layers: [(layer_id, config)]，config 含 mode/color/palette/tag。
    marks_by_date: {date: [Mark, ...]}，涂色标记（打卡/完成度）独立存储，不进 events。
    返回 (color, label) 或 None。优先级：mark 标记 > 旧版 events 事件 > tag 关联。
    """

    marks_by_id = {m.layer_id: m for m in (marks_by_date.get(d, []) if marks_by_date else [])}
    for lid, cfg_dict in custom_layers:
        mode = (cfg_dict or {}).get("mode", "solid")
        mark = marks_by_id.get(lid) if marks_by_id else None
        if mark:
            if mode == "graded" and mark.level is not None:
                palette = (cfg_dict or {}).get("palette") or []
                if 0 <= mark.level < len(palette):
                    return str(palette[mark.level]), (cfg_dict or {}).get("label") or lid
                return None, None
            color = (cfg_dict or {}).get("color")
            return (str(color) if color else None), (cfg_dict or {}).get("label") or lid
        # 旧版兼容：涂色图层以前存 events，迁移前的数据仍可显示
        events = [e for e in ev_by_layer.get(d, {}).get(lid, [])]
        if events:
            if mode == "graded":
                level = (events[0].extra or {}).get("level")
                palette = (cfg_dict or {}).get("palette") or []
                if isinstance(level, int) and 0 <= level < len(palette):
                    return str(palette[level]), (cfg_dict or {}).get("label") or lid
                return None, None
            color = (cfg_dict or {}).get("color")
            return (str(color) if color else None), (cfg_dict or {}).get("label") or lid
        if mode == "tag":
            tag = (cfg_dict or {}).get("tag")
            if tag and any(tag in (t.tags or []) for t in todos):
                color = (cfg_dict or {}).get("color")
                return (str(color) if color else None), (cfg_dict or {}).get("label") or lid
    return None, None


def _expand_schedule_spans(
    items: list, start: date, end: date
) -> dict:
    """把多日日程展开到区间内每一天。

    多日日程在库里只有一行（date=起始日, end_date=结束日），但日历的每个格子都要看得见，
    所以这里按天复制引用：{date: [item, ...]}，并裁剪到 [start, end]（视图窗口外不展开）。
    展开后的 item 仍是同一个对象，「今天是第几天」这类信息在 _build_day 里按具体日期计算，
    不写进对象，避免同一个 span 的不同天互相污染。
    """

    by_date: dict = defaultdict(list)
    for item in items:
        first = max(item.date, start)
        last = min(item.end_date or item.date, end)
        cur = first
        while cur <= last:
            by_date[cur].append(item)
            cur += timedelta(days=1)
    return by_date


def _build_day(
    d: date,
    events_by_date: dict,
    schedule: dict,
    schedule_items_by_date: dict,
    coloring: dict,
    gradient: dict,
    todos_by_date: dict,
    today: date,
    view_year: int,
    view_month: int,
    custom_bg: tuple[str, str] | None = None,
    day_busy: dict | None = None,
    marks_by_date: dict | None = None,
    custom_layer_cfg: list | None = None,
    layer_names: dict | None = None,
) -> dict:
    """组装单日数据。view_year/month 用于判 other_month（月视图淡化前后月）。
    day_busy: {date: (predict_level, done_level)} 快照，视图层不做实时计算。
    marks_by_date: {date: [Mark]}，涂色标记（打卡/完成度），独立于 events。
    custom_layer_cfg: [(layer_id, config)]，自定义涂色图层配置（带 mode/palette/label）。
    layer_names: {layer_id: display_name}，给前端显示图层名称。
    """

    ev_by_layer: dict[str, list] = {}
    for lid, evs in events_by_date.get(d, {}).items():
        ev_by_layer[lid] = [e.model_dump(mode="json") for e in evs]

    sched = schedule.get(d)
    h = _holiday_of(d)
    gkey = f"{d.year}-{d.month:02d}-{d.day:02d}"
    day_todos = todos_by_date.get(d, [])
    todos_json = [t.model_dump(mode="json") for t in day_todos]
    items = []
    for i in schedule_items_by_date.get(d, []):
        row = i.model_dump(mode="json")
        if i.is_multi_day:
            # 跨天元信息按「今天在这个 span 里的位置」计算：首日显示标题，后续天画延续条
            row["is_multi_day"] = True
            row["span_start"] = i.date.isoformat()
            row["span_end"] = i.end_date.isoformat()  # type: ignore[union-attr]
            row["span_index"] = (d - i.date).days + 1
            row["span_total"] = i.span_days
        items.append(row)
    busy = day_busy.get(d) if day_busy else None
    predict_level = busy[0] if busy else None
    done_level = busy[1] if busy else None

    # 当日涂色标记：展开为 {layer_id, display_name, level, color, mode} 供前端涂色条展示
    day_marks = marks_by_date.get(d, []) if marks_by_date else []
    cfg_by_id = {lid: (cfg or {}) for lid, cfg in (custom_layer_cfg or [])}
    layer_names = layer_names or {}
    marks_out: list[dict] = []
    for m in day_marks:
        cfg = cfg_by_id.get(m.layer_id, {})
        mode = cfg.get("mode", "solid")
        if mode == "graded" and m.level is not None:
            palette = cfg.get("palette") or []
            color = palette[m.level] if 0 <= m.level < len(palette) else None
        else:
            color = cfg.get("color")
        marks_out.append({
            "layer_id": m.layer_id,
            "display_name": layer_names.get(m.layer_id) or cfg.get("label") or m.layer_id,
            "level": m.level,
            "color": color,
            "mode": mode,
        })

    out = {
        "date": d.isoformat(),
        "is_today": d == today,
        "is_weekend": d.weekday() >= 5,
        "is_other_month": d.year != view_year or d.month != view_month,
        "events_by_layer": ev_by_layer,
        "schedule": sched.model_dump(mode="json") if sched else None,
        "schedule_items": items,
        "coloring_level": coloring.get(d),
        "holiday": h,
        "lunar": lunar_display(d),
        "gradient_bg": gradient.get(gkey),
        "todos": todos_json,
        "predict_level": predict_level,
        "done_level": done_level,
        "marks": marks_out,
    }
    if custom_bg and custom_bg[0]:
        out["custom_bg"] = {"color": custom_bg[0], "label": custom_bg[1]}
    return out


def build_view(
    conn,
    view_year: int,
    view_month: int,
    days: Iterable[date],
) -> dict:
    """通用聚合：按给定的 days 列表组装视图响应。

    数据窗口 = days 范围 ± 31 天（拉邻月事件，渐变用 anchor 所在月）。
    """

    days_list = list(days)
    start = min(days_list) - timedelta(days=31)
    end = max(days_list) + timedelta(days=31)
    today = date.today()

    events = db.fetch_events_between(conn, start, end)
    schedule = db.fetch_schedule_between(conn, start, end)
    coloring = db.fetch_coloring_between(conn, start, end)
    todos_by_date = db.fetch_todos_between(conn, start, end)
    schedule_items = db.fetch_schedule_items_between(conn, start, end)
    marks_by_date = db.fetch_marks_between(conn, start, end)
    schedule_items_by_date: dict = _expand_schedule_spans(schedule_items, start, end)

    layers = db.fetch_layer_configs(conn)
    layers, removed_sub_layer_ids = apply_subscription_switch(conn, layers)
    layer_cfg_by_id = {l.layer_id: l.config or {} for l in layers}
    layer_names = {l.layer_id: l.display_name for l in layers}
    # 涂色图层：custom_* + built-in coloring（mark 渲染需要 lookup color/palette）
    color_layer_cfgs = [
        (l.layer_id, l.config or {})
        for l in layers
        if l.enabled and (l.kind == "color" or not l.kind)
    ]
    custom_layers = [
        (l.layer_id, l.config or {})
        for l in layers
        if l.layer_id.startswith("custom_")
        and l.enabled
        and (l.kind == "color" or not l.kind)
    ]
    day_busy = db.fetch_day_busy_between(conn, start, end)

    events_by_date: dict = defaultdict(lambda: defaultdict(list))
    for ev in events:
        if ev.layer_id in removed_sub_layer_ids:
            continue
        if not _event_passes_layer_filter(ev, layer_cfg_by_id.get(ev.layer_id)):
            continue
        events_by_date[ev.date][ev.layer_id].append(ev)

    important = [e.date for e in events if e.layer_id == LayerID.IMPORTANT]
    # 倒数日挂钩重要日期染色：未来 countdown 的 next_date 当天也染目标色
    for cd in db.fetch_countdowns(conn):
        nxt, _, passed, _lk = _next_occurrence(cd.base_date, cd.repeat_yearly, cd.milestone_rule, today,
                                          getattr(cd, "repeat_type", "solar"))
        if not passed:
            important.append(nxt)
    m_start, m_end = month_range(view_year, view_month)
    # 当天染目标色（不再渐变）：只有重要日期/倒数日当天有 gradient_bg
    gradient = {
        f"{d.year}-{d.month:02d}-{d.day:02d}": "#FF4D4D"
        for d in important if m_start <= d <= m_end
    }

    return {
        "year": view_year,
        "month": view_month,
        "layers": [l.model_dump(mode="json") for l in layers],
        "days": [
            _build_day(
                d, events_by_date, schedule, schedule_items_by_date, coloring, gradient,
                todos_by_date, today, view_year, view_month,
                custom_bg=_custom_layer_color(d, events_by_date, todos_by_date.get(d, []), custom_layers, marks_by_date),
                day_busy=day_busy,
                marks_by_date=marks_by_date,
                custom_layer_cfg=color_layer_cfgs,
                layer_names=layer_names,
            )
            for d in days_list
        ],
    }


def month_days(year: int, month: int) -> list[date]:
    """6×7=42 天，周一为首日。"""

    return [d for week in month_grid(year, month) for d in week]


def week_days(anchor: date) -> list[date]:
    """anchor 所在周的周一..周日 7 天。"""

    start = anchor - timedelta(days=anchor.weekday())
    return [start + timedelta(days=i) for i in range(7)]


def build_year_view(conn, year: int) -> dict:
    """年视图：聚合全年 12 个月的迷你月历。

    每个月的 days 复用 build_view（渐变跨月已由 build_view 的 ±31 天窗口覆盖）。
    """

    months = []
    for m in range(1, 13):
        days = month_days(year, m)
        view = build_view(conn, year, m, days)
        months.append({"month": m, "days": view["days"]})

    layers = db.fetch_layer_configs(conn)
    layers, _ = apply_subscription_switch(conn, layers)
    return {
        "year": year,
        "layers": [l.model_dump(mode="json") for l in layers],
        "months": months,
    }


def build_countdown(conn) -> str:
    today = date.today()
    items = build_countdown_list(conn)
    upcoming = [i for i in items if not i["passed"]]
    if upcoming:
        nearest = upcoming[0]
        if nearest["is_today"]:
            return f"🎉 今天是「{nearest['display']}」"
        return f"距离「{nearest['display']}」还有 {nearest['days_left']} 天"
    if items:
        latest = items[-1]
        return f"「{latest['display']}」已过 {-latest['days_left']} 天"
    return "暂无倒数日"


def build_countdown_banner(conn) -> dict:
    """侧栏倒计时横幅的结构化形态（20261004 i18n：中文串改前端按语言组装）。

    kind: today=今天是 / until=距离 N 天 / passed=已过 N 天 / empty=无倒数日。
    name 是用户数据原样；旧 text 字段（中文拼串）保留于路由层做兼容。
    """
    items = build_countdown_list(conn)
    upcoming = [i for i in items if not i["passed"]]
    if upcoming:
        nearest = upcoming[0]
        if nearest["is_today"]:
            return {"kind": "today", "name": nearest["name"], "days": 0}
        return {"kind": "until", "name": nearest["name"], "days": nearest["days_left"]}
    if items:
        latest = items[-1]
        return {"kind": "passed", "name": latest["name"], "days": -latest["days_left"]}
    return {"kind": "empty", "name": None, "days": None}


def _next_occurrence(
    base: date,
    repeat_yearly: bool,
    milestone_rule: str | None,
    today: date,
    repeat_type: str = "solar",
) -> tuple[date, str, bool]:
    """计算倒数日的下一个发生日期。

    返回 (next_date, display_text, passed)：
    - repeat_yearly=True：每年重置（生日/节日），下次 = 今年或明年的同月日；
      repeat_type='lunar' 时按农历月日重复（春节=正月初一，公历日期年年不同）
    - milestone_rule 非空：从 base 推算里程碑（如 100/365/520 天），取最近的下一个
    - 两者都配置：周年 + 里程碑都算，取距离今天最近的那个
    - 都没有：一次性事件，next=base（可能已过）
    """

    candidates: list[tuple[date, str]] = []


    if repeat_yearly:
        if repeat_type == "lunar":
            from tt_calendar.utils.lunar_utils import next_lunar_occurrence

            yearly = next_lunar_occurrence(base, today)
            candidates.append((yearly, "今年" if yearly.year == today.year else "农历周年"))
        else:
            for offset in range(0, 40):
                y = today.year + offset
                try:
                    yearly = base.replace(year=y)
                except ValueError:  # 2/29 → 平年 2/28
                    yearly = base.replace(year=y, day=28)
                if yearly >= today:
                    n = (y - base.year)
                    candidates.append((yearly, f"{n} 周年" if n else "今年"))
                    break

    if milestone_rule:
        for raw in milestone_rule.split(","):
            raw = raw.strip()
            if not raw.isdigit():
                continue
            days = int(raw)
            target = base + timedelta(days=days)
            if target >= today:
                candidates.append((target, f"{days} 天"))

    if not candidates:
        return base, "", (base < today), None

    best = min(candidates, key=lambda c: (c[0] - today).days)
    # label_kind：标签的结构化形态（i18n 前端按语言组装；zh 的 next_label 保留兼容）
    kind_map = {"今年": ("this_year", None), "农历周年": ("lunar_anniv", None)}
    kind, n = kind_map.get(best[1], ("years" if "周年" in best[1] else "days",
                                      int(best[1].split()[0]) if " " in best[1] else None))
    return best[0], best[1], False, {"kind": kind, "n": n}


def build_countdown_list(conn) -> list[dict]:
    """全部倒数日（独立 countdown 表），动态计算下一次发生日期。

    每条含 {id, name, category, base_date, repeat_yearly, milestone_rule,
    never_expire, notes, color, next_date, next_label, display, days_left,
    is_today, passed}。display = 名称 + 周年/里程碑标签（如「和姐姐在一起 2 周年」）。
    """

    today = date.today()
    rows = db.fetch_countdowns(conn)
    out = []
    for cd in rows:
        next_date, label, passed, label_kind = _next_occurrence(
            cd.base_date, cd.repeat_yearly, cd.milestone_rule, today,
            getattr(cd, "repeat_type", "solar"),
        )
        days_left = (next_date - today).days
        # 只有纪念日类或配了里程碑的才在标题后缀「1 周年 / 400 天」；生日/节日/重要事件只显示名称
        show_label = label and (cd.category == "纪念日" or bool(cd.milestone_rule))
        display = f"{cd.name} {label}".strip() if show_label else cd.name
        out.append({
            "id": cd.id,
            "name": cd.name,
            "category": cd.category,
            "base_date": cd.base_date.isoformat(),
            "repeat_yearly": cd.repeat_yearly,
            "repeat_type": getattr(cd, "repeat_type", "solar"),
            "milestone_rule": cd.milestone_rule,
            "never_expire": cd.never_expire,
            "notes": cd.notes,
            "color": cd.color,
            "next_date": next_date.isoformat(),
            "next_label": label if show_label else "",
            "label_kind": label_kind if show_label else None,
            "display": display,
            "days_left": days_left,
            "is_today": days_left == 0,
            "passed": passed,
        })
    out.sort(key=lambda r: (r["passed"], abs(r["days_left"])))
    return out
