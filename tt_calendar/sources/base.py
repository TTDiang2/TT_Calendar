"""数据导入源（Source）抽象与实现。

每个 Source 子类负责从一个外部数据源（集思录、iCal、CSV 等）拉取事件，
转成统一的 Event 列表交给 db 层 upsert。新增数据源只需：
1. 写一个 Source 子类，实现 fetch()
2. 在 sources/__init__.py 注册
3. UI 自动出现在导入对话框中
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import date as date_t

from ..models import Event, ImportResult


class Source(ABC):
    """导入源基类。"""

    source_id: str = ""         # 唯一 ID（如 'jisilu'）
    display_name: str = ""      # UI 显示名
    needs_internet: bool = True
    needs_credentials: bool = False

    def __init__(self) -> None:
        if not self.source_id:
            raise ValueError(f"{type(self).__name__} 必须定义 source_id")

    @abstractmethod
    async def fetch(
        self,
        start: date_t,
        end: date_t,
        **kwargs,
    ) -> tuple[list[Event], ImportResult]:
        """拉取 [start, end] 区间内的事件。

        返回 (events, result)。events 待 db 层 upsert；result 包含统计/错误信息。
        """

        raise NotImplementedError
