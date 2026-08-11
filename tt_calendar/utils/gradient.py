"""渐变颜色算法（保留旧版 Important 视图逻辑）。

事件日为深色，相邻事件之间从浅到深渐变，事件后一天回到浅色。
"""

from __future__ import annotations

from datetime import date as date_t, timedelta
from typing import Iterable


WHITE: str = "#FFFFFF"
RED: str = "#FF4D4D"


def lerp_color(a: str, b: str, t: float) -> str:
    """线性插值两个 hex 颜色。t in [0,1]。"""

    t = max(0.0, min(1.0, t))
    ra, ga, ba = int(a[1:3], 16), int(a[3:5], 16), int(a[5:7], 16)
    rb, gb, bb = int(b[1:3], 16), int(b[3:5], 16), int(b[5:7], 16)
    r = int(ra + (rb - ra) * t)
    g = int(ga + (gb - ga) * t)
    b_ = int(ba + (bb - ba) * t)
    return f"#{r:02x}{g:02x}{b_:02x}"


def build_gradient(
    event_dates: Iterable[date_t],
    month_start: date_t,
    month_end: date_t,
    peak_color: str = RED,
    cap_t: float = 0.9,
) -> dict[str, str]:
    """计算当月每一天的背景色。

    Args:
        event_dates: 所有事件日期（不限于当月，窗口越大渐变越准）。
        month_start / month_end: 当月起止。
        peak_color: 事件日颜色。
        cap_t: 非事件日最大渐变进度（避免被误认为事件日本身）。

    Returns:
        {'YYYY-MM-DD': '#rrggbb'} 仅含当月日期。
    """

    base_color = WHITE
    all_dates = sorted(set(event_dates))
    if not all_dates:
        return {}

    gradient: dict[str, str] = {}
    # 当月每天默认白
    num_days = (month_end - month_start).days + 1
    for i in range(num_days):
        d = month_start + timedelta(days=i)
        gradient[f"{d.year}-{d.month:02d}-{d.day:02d}"] = base_color

    # 事件日涂红
    event_set = set(all_dates)
    for d in event_set:
        if month_start <= d <= month_end:
            gradient[f"{d.year}-{d.month:02d}-{d.day:02d}"] = peak_color

    # 相邻事件之间渐变（取距离未来事件更近的颜色优先）
    weights: dict[str, float] = {}
    for i in range(len(all_dates) - 1):
        d_prev = all_dates[i]
        d_next = all_dates[i + 1]
        interval_len = (d_next - d_prev).days
        if interval_len <= 1:
            continue
        denom = max(interval_len - 2, 1)
        for offset in range(1, interval_len):
            d = d_prev + timedelta(days=offset)
            if d == d_next:
                continue
            if offset == 1:
                color = base_color
                weight = 0.0
            else:
                position = (offset - 1) / denom
                weight = position
                t = min(position, cap_t)
                color = lerp_color(base_color, peak_color, t)
            if month_start <= d <= month_end:
                key = f"{d.year}-{d.month:02d}-{d.day:02d}"
                # 该日本身是事件日则保持 peak
                if key in gradient and gradient[key] == peak_color and d in event_set:
                    continue
                if key not in weights or weight > weights[key]:
                    weights[key] = weight
                    gradient[key] = color

    return gradient
