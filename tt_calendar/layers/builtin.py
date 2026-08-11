"""内置图层实现：日程 / 重要日期 / 充实度染色 / 公共节假日 / 集思录。"""

from __future__ import annotations

import chinese_calendar as _cc
from datetime import date as date_t

from .. import config as cfg
from ..models import Event
from ..utils.text_utils import first_line, strip_brackets
from .base import CellContribution, Layer, LayerContext


# ---------------------------------------------------------------------------
# 日程图层（AM/PM/EV 三段）
# ---------------------------------------------------------------------------


class ScheduleLayer(Layer):
    """把 schedule 表里的 AM/PM/EV 显示为格子内的短文字行。"""

    def contribute(self, d: date_t, ctx: LayerContext) -> CellContribution:
        entry = ctx.schedule_by_date.get(d)
        if entry is None:
            return CellContribution()
        labels: list[str] = []
        if entry.am:
            labels.append(f"上: {entry.am}")
        if entry.pm:
            labels.append(f"下: {entry.pm}")
        if entry.ev:
            labels.append(f"晚: {entry.ev}")
        if not labels:
            return CellContribution()
        return CellContribution(
            dots=[self.color or "#3D6BFB"],
            labels=labels,
            tooltips=[f"日程: {entry.am or ''} / {entry.pm or ''} / {entry.ev or ''}"],
        )


# ---------------------------------------------------------------------------
# 重要日期图层（渐变背景 + 当日事件）
# ---------------------------------------------------------------------------


class ImportantLayer(Layer):
    """渐变背景（来自预计算的 gradient_map）+ 事件标题。"""

    def contribute(self, d: date_t, ctx: LayerContext) -> CellContribution:
        contrib = CellContribution()
        key = f"{d.year}-{d.month:02d}-{d.day:02d}"
        bg = ctx.important_gradient.get(key)
        if bg and bg != "#FFFFFF":
            contrib.background = bg

        events = [e for e in ctx.events_by_date.get(d, []) if e.layer_id == "important"]
        if not events:
            return contrib

        # 当日事件：作为 labels（按 sort_key 排序）
        events_sorted = sorted(events, key=lambda e: e.sort_key)
        for ev in events_sorted:
            contrib.labels.append(ev.title)
            if ev.description:
                contrib.tooltips.append(f"{ev.title}\n{ev.description}")
            else:
                contrib.tooltips.append(ev.title)
            # 当日是 base 事件（offset==0）：在角上显示一个明显色点
            if ev.extra.get("offset", 0) == 0:
                contrib.dots.append(ev.color or "#FF4D4D")
            else:
                # 自动纪念日：用浅色点
                contrib.dots.append("#FFB0B0")
        return contrib


# ---------------------------------------------------------------------------
# 充实度染色图层
# ---------------------------------------------------------------------------


class ColoringLayer(Layer):
    """背景色 = 5 档绿色之一。"""

    def contribute(self, d: date_t, ctx: LayerContext) -> CellContribution:
        level = ctx.coloring_by_date.get(d)
        if level is None:
            return CellContribution()
        if not 0 <= level < len(cfg.COLORING_LEVELS):
            return CellContribution()
        color = str(cfg.COLORING_LEVELS[level]["color"])
        return CellContribution(
            background=color,
            tooltips=[f"充实度: {cfg.COLORING_LEVELS[level]['label']}"],
        )


# ---------------------------------------------------------------------------
# 公共节假日图层（中国法定节假日 + 调休）
# ---------------------------------------------------------------------------


class HolidayLayer(Layer):
    """使用 chinese_calendar 库判定节假日与调休。"""

    def __init__(self, config) -> None:
        super().__init__(config)
        # 中文名缓存，避免重复计算
        self._name_cache: dict[date_t, str | None] = {}

    def _holiday_name(self, d: date_t) -> str | None:
        if d in self._name_cache:
            return self._name_cache[d]
        name: str | None = None
        try:
            on_holiday, name = _cc.get_holiday_detail(d)
            if not on_holiday:
                name = None
        except NotImplementedError:
            # chinese_calendar 数据未覆盖该日期
            name = None
        except Exception:
            name = None
        self._name_cache[d] = name
        return name

    def _is_workday_made_up(self, d: date_t) -> bool:
        """是否为调休上班日（周末补班）。"""

        try:
            return _cc.is_workday(d) and d.weekday() >= 5
        except Exception:
            return False

    def contribute(self, d: date_t, ctx: LayerContext) -> CellContribution:
        contrib = CellContribution()
        name = self._holiday_name(d)
        made_up = self._is_workday_made_up(d)

        if name:
            contrib.labels.append(f"🏮 {name}")
            contrib.dots.append(self.color or "#8E24AA")
            contrib.tooltips.append(f"节假日: {name}")
        if made_up:
            contrib.badges.append("班")
            contrib.tooltips.append("调休补班日")
        return contrib


# ---------------------------------------------------------------------------
# 集思录图层（每个 qtype 一个实例）
# ---------------------------------------------------------------------------


class JisiluLayer(Layer):
    """集思录单类型事件图层。

    layer_id 形如 'jisilu_CNV'。从 ctx.events_by_date 取出该 layer 的事件，
    显示为色点 + 数量徽章。当日事件多时仅展示前 N 个标题。
    """

    MAX_LABELS_PER_DAY: int = 2  # 当日最多显示几个事件名（避免格子里太挤）

    def contribute(self, d: date_t, ctx: LayerContext) -> CellContribution:
        events = [e for e in ctx.events_by_date.get(d, []) if e.layer_id == self.layer_id]
        if not events:
            return CellContribution()
        contrib = CellContribution()
        color = self.color or "#FFB300"
        contrib.dots.append(color)

        # 按事件类型（title 前的【...】）分组
        types_seen: dict[str, int] = {}
        for ev in events:
            t, _ = strip_brackets(ev.title)
            types_seen[t] = types_seen.get(t, 0) + 1

        # 显示前 N 个事件简略（去掉【...】，便于排版）
        for ev in events[: self.MAX_LABELS_PER_DAY]:
            _, body = strip_brackets(ev.title)
            if body:
                contrib.labels.append(body[:14])
            else:
                contrib.labels.append(ev.title[:14])

        if len(events) > self.MAX_LABELS_PER_DAY:
            contrib.badges.append(f"+{len(events) - self.MAX_LABELS_PER_DAY}")

        # 悬停 tooltip
        for ev in events:
            contrib.tooltips.append(ev.title)

        return contrib
