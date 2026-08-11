"""图层（Layer）模块入口。

提供 build_default_layers() 工厂：根据 layer_config 表构造全部图层实例。
"""

from __future__ import annotations

from .base import CellContribution, Layer, LayerContext, merge_contributions
from .builtin import (
    ColoringLayer,
    HolidayLayer,
    ImportantLayer,
    JisiluLayer,
    ScheduleLayer,
)
from ..models import LayerConfig

__all__ = [
    "CellContribution",
    "Layer",
    "LayerContext",
    "merge_contributions",
    "ColoringLayer",
    "HolidayLayer",
    "ImportantLayer",
    "JisiluLayer",
    "ScheduleLayer",
    "build_default_layers",
    "build_layer",
]


def build_layer(config: LayerConfig) -> Layer:
    """根据 layer_id 模式构造图层实例。"""

    lid = config.layer_id

    # 集思录子图层（jisilu_<qtype>）
    if lid.startswith("jisilu_"):
        return JisiluLayer(config)

    factory = {
        "schedule":  ScheduleLayer,
        "important": ImportantLayer,
        "coloring":  ColoringLayer,
        "holiday":   HolidayLayer,
    }
    cls = factory.get(lid)
    if cls is None:
        # 未知图层：用一个不贡献任何东西的占位
        return Layer(config)
    return cls(config)


def build_default_layers(configs: list[LayerConfig]) -> list[Layer]:
    """根据 layer_config 列表构造图层实例列表（按 sort_order 排序）。"""

    sorted_cfgs = sorted(configs, key=lambda c: (c.sort_order, c.layer_id))
    return [build_layer(c) for c in sorted_cfgs]
