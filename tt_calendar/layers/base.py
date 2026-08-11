"""图层（Layer）抽象与内置实现。

每个图层负责为给定日期贡献视觉元素（背景色、色点、徽章、文字标签）。
图层是纯函数式的：接收 LayerContext（预取数据），返回 CellContribution。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_t
from typing import Iterable

from ..models import Event, LayerConfig, ScheduleEntry


@dataclass
class CellContribution:
    """单个图层对某个日期格的视觉贡献。"""

    background: str | None = None          # 整格背景色（图层负责选）
    dots: list[str] = field(default_factory=list)         # 右上角色点（hex 颜色）
    labels: list[str] = field(default_factory=list)       # 格子内的短文字行
    badges: list[str] = field(default_factory=list)       # 角标短文字（'班'/'休'）
    tooltips: list[str] = field(default_factory=list)     # 悬停提示
    suppress_other_labels: bool = False                    # 是否压制其他图层的 labels


@dataclass
class LayerContext:
    """渲染上下文：包含当前可见窗口内的全部数据。"""

    # events_by_date: 该日所有事件（按图层来源都包含）
    events_by_date: dict[date_t, list[Event]]
    # schedule_by_date: AM/PM/EV 三段日程
    schedule_by_date: dict[date_t, ScheduleEntry]
    # coloring_by_date: 充实度 0..4
    coloring_by_date: dict[date_t, int]
    # important_gradient: 重要日期渐变背景 {'YYYY-MM-DD': hex}
    important_gradient: dict[str, str]
    # 今天
    today: date_t
    # 启用的图层 id 集合
    enabled_layer_ids: set[str]


class Layer:
    """图层基类。子类实现 contribute() 返回该图层的视觉贡献。"""

    layer_id: str = ""
    display_name: str = ""
    color: str | None = None

    def __init__(self, config: LayerConfig) -> None:
        self.config = config
        self.layer_id = config.layer_id
        self.display_name = config.display_name
        self.color = config.color
        self.enabled = config.enabled

    def contribute(self, d: date_t, ctx: LayerContext) -> CellContribution:
        """子类必须实现。"""

        raise NotImplementedError


def merge_contributions(contribs: Iterable[CellContribution]) -> CellContribution:
    """合并多个图层的贡献（按 priority 顺序，前者压制后者）。"""

    merged = CellContribution()
    suppressed = False
    for c in contribs:
        if suppressed:
            break
        if c.background and not merged.background:
            merged.background = c.background
        merged.dots.extend(c.dots)
        merged.badges.extend(c.badges)
        merged.tooltips.extend(c.tooltips)
        merged.labels.extend(c.labels)
        if c.suppress_other_labels:
            suppressed = True
    return merged
