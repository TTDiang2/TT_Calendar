"""数据导入源（Source）抽象与实现。

每个 Source 子类负责从一个外部数据源（集思录、英为财情、任何社区插件）拉取事件，
转成统一的 Event 列表交给 db 层 upsert。

**订阅插件协议（v2，2026-09）**：一个可被社区共享的订阅插件 = 一个 Source 子类。
核心代码只认识协议，不认识具体源：

    class MySource(Source):
        source_id = "my_source"            # 全局唯一
        display_name = "我的日历"           # UI 显示名
        # 可选声明
        layer_specs()                      # 需要哪些图层（id/名/色/默认开关）
        ensure_layers(conn)                # 图层播种（默认按 layer_specs 通用执行）
        refresh_past_days / refresh_future_days  # 自动刷新窗口
        field_specs()                      # 事件卡片字段 UI 规格（阶段二 schema）

        async def fetch(start, end, **kw) -> (events, result)

新增源后：
1. 内置源在 sources/__init__.py 显式注册；
2. 第三方源放 PROJECT_ROOT/plugins/*.py（含 Source 子类）即可被发现；
3. UI / 订阅 / 刷新 / 图层播种全部自动适配，无需改核心代码。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date as date_t
from typing import Any, Iterable

from ..models import Event, ImportResult


@dataclass
class LayerSpec:
    """源声明的图层定义（播种用）。layer_id 必须是完整 id。"""

    layer_id: str
    display_name: str
    color: str = "#9CA3AF"
    enabled: bool = True
    sort_order: int = 11
    kind: str = "dot"
    group: str = ""
    config: dict[str, Any] = field(default_factory=dict)


class Source(ABC):
    """导入源基类（订阅插件协议）。"""

    source_id: str = ""         # 唯一 ID（如 'jisilu' / 'investing'）
    display_name: str = ""      # UI 显示名（订阅卡片、图层分组）
    group: str = ""             # 图层侧栏分组名；空 = 用 display_name
    needs_internet: bool = True
    needs_credentials: bool = False
    # 自动刷新窗口（天）：start = max(today - past, last_synced)，end = today + future
    refresh_past_days: int = 2
    refresh_future_days: int = 14

    def __init__(self) -> None:
        if not self.source_id:
            raise ValueError(f"{type(self).__name__} 必须定义 source_id")

    # ------------------------------------------------------------------
    # 图层声明与播种
    # ------------------------------------------------------------------

    def layer_specs(self) -> list[LayerSpec]:
        """声明本源需要的图层。默认无（源可覆盖）。"""
        return []

    def ensure_layers(self, conn: Any) -> None:
        """把声明图层幂等播种进 layer_config。

        默认实现：缺失才插；display_name/color/group 与声明不一致时更新
        （源改名升级场景），但绝不覆盖用户手动设置的 enabled。
        特殊迁移需求（如 ID 体系更换）由源覆盖此方法。
        """
        from .. import db

        group = self.group or self.display_name
        for spec in self.layer_specs():
            row = conn.execute(
                "SELECT display_name FROM layer_config WHERE layer_id=?",
                (spec.layer_id,),
            ).fetchone()
            if not row:
                db.upsert_layer_config(
                    conn,
                    db.LayerConfig(
                        layer_id=spec.layer_id,
                        display_name=spec.display_name,
                        enabled=spec.enabled,
                        color=spec.color,
                        sort_order=spec.sort_order,
                        kind=spec.kind,
                        group=group,
                        config=spec.config,
                    ),
                )
            elif row["display_name"] != spec.display_name:
                conn.execute(
                    "UPDATE layer_config SET display_name=?, color=?, group_name=?, "
                    "sort_order=?, kind=? WHERE layer_id=?",
                    (spec.display_name, spec.color, group, spec.sort_order, spec.kind,
                     spec.layer_id),
                )

    # ------------------------------------------------------------------
    # 事件字段 UI 规格（阶段二：前端 schema 渲染）
    # ------------------------------------------------------------------

    def field_specs(self) -> dict[str, Any] | None:
        """声明事件卡片如何渲染 extra 字段；None = 前端只显示标题/描述。

        规格结构（由前端 SourceFields 消费）：
        {
          "meta": [{"key": "time"}, {"key": "currency"}, {"key": "period"}],      # 首行小字序列
          "importance": {"key": "importance", "max": 3},                          # 星级（可选）
          "columns": [{"key": "actual", "label": "今值"}, ...],                   # 多列表格（可选）
          "badges": {"key": "vs_forecast", "map": {"超预期": {"label": "▲ 超预期", "tone": "good"}, ...}},
        }
        tone: good / bad / info / muted（前端映射配色）
        """
        return None

    # ------------------------------------------------------------------
    # 拉取
    # ------------------------------------------------------------------

    @abstractmethod
    async def fetch(
        self,
        start: date_t,
        end: date_t,
        **kwargs: Any,
    ) -> tuple[list[Event], ImportResult]:
        """拉取 [start, end] 区间内的事件。

        返回 (events, result)。events 待 db 层 upsert；result 包含统计/错误信息。
        源的网络凭据（cookie/token）由源自己负责读取，刷新器不感知。
        """

        raise NotImplementedError

    async def close(self) -> None:
        """释放网络资源。无则无需覆盖。"""

        return None


def collect_sources(module: Any) -> list[type[Source]]:
    """收集模块内定义的 Source 子类（跳过基类与抽象类）。"""

    out: list[type[Source]] = []
    for name in dir(module):
        obj = getattr(module, name)
        if isinstance(obj, type) and issubclass(obj, Source) and obj is not Source:
            if getattr(obj, "__abstractmethods__", None):
                continue
            if obj.source_id:
                out.append(obj)
    return out


def layer_group_name(source: Source) -> str:
    return source.group or source.display_name
