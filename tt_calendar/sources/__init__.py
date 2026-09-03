"""数据导入源注册中心。

新增导入源时只需在这里注册即可。UI 自动列出。
"""

from __future__ import annotations

from typing import Iterable

from .base import Source
from .jisilu import JisiluSource
from .investing import InvestingSource

_REGISTRY: dict[str, type[Source]] = {
    "jisilu": JisiluSource,
    "investing": InvestingSource,
}


def list_sources() -> list[type[Source]]:
    return list(_REGISTRY.values())


def get_source(source_id: str) -> Source | None:
    cls = _REGISTRY.get(source_id)
    return cls() if cls else None


def register_source(source_id: str, cls: type[Source]) -> None:
    _REGISTRY[source_id] = cls
