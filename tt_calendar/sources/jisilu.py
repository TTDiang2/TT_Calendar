"""集思录投资日历数据源。

API 已通过 Playwright 抓真实请求确认：
    GET https://www.jisilu.cn/data/calendar/get_calendar_data/
        ?qtype=<TYPE>&start=<unix秒>&end=<unix秒>&_=<unix毫秒>

返回 JSON: [{id, code, title, start, description, url, color}, ...]
无需登录，但需要带 User-Agent / Referer 等 headers。
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import date as date_t, datetime
from typing import Any

import httpx

from .. import config as cfg
from ..models import Event, ImportResult
from ..utils.date_utils import try_parse_date
from ..utils.text_utils import html_to_plain
from .base import Source

log = logging.getLogger(__name__)


class JisiluSource(Source):
    """集思录导入源。

    每个 qtype 单独拉取，事件落到对应图层 jisilu_<qtype>。
    """

    source_id: str = "jisilu"
    display_name: str = "集思录投资日历"
    needs_internet: bool = True
    needs_credentials: bool = False

    def __init__(self) -> None:
        super().__init__()
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                headers=cfg.JISILU_HEADERS,
                timeout=cfg.JISILU_TIMEOUT_SECONDS,
                follow_redirects=True,
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def fetch(
        self,
        start: date_t,
        end: date_t,
        qtypes: list[str] | None = None,
        **kwargs: Any,
    ) -> tuple[list[Event], ImportResult]:
        """拉取指定 qtypes 在 [start, end] 的事件。

        Args:
            start/end: 日期范围。
            qtypes: 要拉的类型列表；None 表示全部默认启用的。
        """

        if qtypes is None:
            qtypes = [
                qt
                for qt, info in cfg.JISILU_QTYPES.items()
                if info.get("enabled", True)
            ]

        client = await self._get_client()
        all_events: list[Event] = []
        result = ImportResult(source=self.source_id, layer_id="jisilu_*")

        # unix 时间戳
        start_ts = int(datetime.combine(start, datetime.min.time()).timestamp())
        end_ts = int(datetime.combine(end, datetime.min.time()).timestamp()) + 86399
        ms = int(time.time() * 1000)

        # 并发拉取，但限制并发数（避免触发反爬）
        sem = asyncio.Semaphore(4)

        async def fetch_one(qtype: str) -> tuple[str, list[Event], str | None]:
            params = {
                "qtype": qtype,
                "start": str(start_ts),
                "end": str(end_ts),
                "_": str(ms),
            }
            url = cfg.JISILU_CALENDAR_API
            layer_id = cfg.LayerID.JISILU_PREFIX + qtype
            try:
                async with sem:
                    resp = await client.get(url, params=params)
                if resp.status_code != 200:
                    return qtype, [], f"HTTP {resp.status_code}"
                data = resp.json()
                # API 失败时返回字面 'false'
                if data is False or data == "false":
                    return qtype, [], None  # 该 qtype 无数据，不算错误
                if not isinstance(data, list):
                    return qtype, [], f"unexpected response: {str(data)[:80]}"
                events = [_parse_item(item, layer_id, qtype) for item in data]
                events = [e for e in events if e is not None]
                return qtype, events, None
            except Exception as e:
                log.warning("jisilu fetch %s failed: %s", qtype, e)
                return qtype, [], str(e)

        tasks = [fetch_one(qt) for qt in qtypes]
        outcomes = await asyncio.gather(*tasks)

        per_qtype_counts: dict[str, int] = {}
        errors: list[str] = []
        for qt, events, err in outcomes:
            per_qtype_counts[qt] = len(events)
            all_events.extend(events)
            if err:
                errors.append(f"{qt}: {err}")

        result.fetched = len(all_events)
        result.inserted = len(all_events)  # 占位，真正 insert/update 由 db.upsert_event 统计
        if errors:
            result.error = "; ".join(errors)[:300]

        log.info(
            "jisilu fetch done: %d events across %d qtypes; counts=%s",
            len(all_events),
            len(qtypes),
            per_qtype_counts,
        )
        return all_events, result


def _parse_item(item: dict[str, Any], layer_id: str, qtype: str) -> Event | None:
    """把集思录一条原始 item 转成 Event。"""

    try:
        raw_start = item.get("start") or ""
        d = try_parse_date(str(raw_start))
        if d is None:
            return None
        title = str(item.get("title") or "").strip()
        if not title:
            return None
        description_html = str(item.get("description") or "")
        description = html_to_plain(description_html)
        color = item.get("color")
        if color:
            color = str(color)
        # 外部源唯一 ID：qtype + jisilu id
        source_ref = f"{qtype}:{item.get('id', '')}"
        extra: dict[str, Any] = {"qtype": qtype}
        if item.get("code"):
            extra["code"] = str(item["code"])
        if item.get("url"):
            extra["url"] = "https://www.jisilu.cn" + str(item["url"])
        return Event(
            layer_id=layer_id,
            source="jisilu",
            date=d,
            title=title,
            description=description or None,
            color=color,
            source_ref=source_ref,
            extra=extra,
            sort_key=0,
        )
    except Exception as e:
        log.warning("failed to parse jisilu item %s: %s", item, e)
        return None
