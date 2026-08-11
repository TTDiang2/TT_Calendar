"""主题常量：各图层的默认显示颜色。

与 config.py 的 JISILU_QTYPES / TODO_LAYER_COLOR 一起构成完整的
图层配色表；本文件只负责 schedule/important/coloring/holiday 四个
基础图层的默认色（首启动写入 layer_config 表使用）。
"""

from __future__ import annotations

from typing import Final

# 默认图层颜色（与 layer_config 表的初始值保持一致）
LAYER_COLORS: Final[dict[str, str]] = {
    "schedule": "#3D6BFB",   # 日程 - 蓝色
    "important": "#EF5350",  # 重要日期 - 红色
    "coloring": "#388E3C",   # 充实度染色 - 绿色
    "holiday": "#8E24AA",    # 公共节假日 - 紫色
}
