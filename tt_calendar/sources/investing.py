"""英为财情（Investing.com）经济日历数据源。

API 已通过逆向分析确认（Cloudflare 强校验，普通 HTTP 客户端无法直连）：

    GET https://cn.investing.com/economic-calendar/Service/getCalendarFilteredData
        ?country[]=5&country[]=37&...
        &importance=2&importance=3
        &dateFrom=MM/dd/yyyy&dateTo=MM/dd/yyyy
        &timeZone=21&lang=zh

返回 JSON 数组，每条形如：
    {
      "id": "338",
      "title": "<a href='/economic-calendar/...'>美国 ISM 制造业 PMI</a>",
      "country": 5,
      "date": "Sep 01, 2026",
      "time": "10:00 AM",
      "actual": "48.7",
      "forecast": "49.5",
      "previous": "48.0",
      "importance": 3
    }
title 等字段可能含 HTML 包裹（链接/span 染色）；解析时统一去标签取纯文本。

数据按 country 分图层：layer_id = investing_<country_code>。
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import re
from datetime import date as date_t, datetime
from typing import Any

import httpx

from .. import config as cfg
from ..models import Event, ImportResult
from .base import Source

log = logging.getLogger(__name__)

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")

# CF 拦截特征（cf-ray 是 Cloudflare 请求 ID；headers 里 cf-mitigated 表示触发了挑战）
_CF_HINT_HEADERS: tuple[str, ...] = ("cf-ray", "cf-mitigated", "cf-cache-status")


class InvestingSource(Source):
    """英为财情经济日历导入源。

    每个 (country, importance) 组合单独拉取，事件落到对应图层 investing_<country_code>。
    """

    source_id: str = "investing"
    display_name: str = "英为财情-投资日历"
    needs_internet: bool = True
    needs_credentials: bool = False  # 严格说需要 CF cookie，但不算账号凭据

    def __init__(self) -> None:
        super().__init__()
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self, cookies: dict[str, str] | None = None) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                headers=cfg.INVESTING_HEADERS,
                timeout=cfg.INVESTING_TIMEOUT_SECONDS,
                follow_redirects=True,
            )
        if cookies:
            # 每次 fetch 调用可注入从浏览器导出的 CF 绕过 cookie
            self._client.cookies.clear()
            for k, v in cookies.items():
                self._client.cookies.set(k, v)
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def fetch(
        self,
        start: date_t,
        end: date_t,
        countries: list[str] | None = None,
        importance: list[int] | None = None,
        cookies: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> tuple[list[Event], ImportResult]:
        """拉取指定国家在 [start, end] 的事件。

        Args:
            start/end: 日期范围（包含两端）。
            countries: 国家 ID 列表（字符串形式 "5" / "37"）；None 表示全部默认启用国家。
            importance: importance 等级列表（1/2/3）；None 取 cfg 默认 (2, 3)。
            cookies: CF 绕过 cookie 字典（从浏览器导出）；None 表示裸请求。
        """

        if countries is None:
            countries = [
                code for code, info in cfg.INVESTING_COUNTRIES.items()
                if info.get("enabled", True)
            ]
        if importance is None:
            importance = list(cfg.INVESTING_IMPORTANCE_LEVELS)

        client = await self._get_client(cookies=cookies)
        all_events: list[Event] = []
        result = ImportResult(source=self.source_id, layer_id="investing_*")

        # 把所有 (country, importance) 组合并行请求
        sem = asyncio.Semaphore(4)
        tasks = [
            self._fetch_one(client, sem, start, end, country, imp)
            for country in countries
            for imp in importance
        ]
        outcomes = await asyncio.gather(*tasks)

        per_country: dict[str, int] = {}
        errors: list[str] = []
        cf_blocked = False
        for country, events, err, is_cf in outcomes:
            per_country[country] = per_country.get(country, 0) + len(events)
            all_events.extend(events)
            if is_cf:
                cf_blocked = True
            if err:
                errors.append(f"{country}: {err}")

        result.fetched = len(all_events)
        result.inserted = len(all_events)  # 真正写入由 db.upsert_event 统计
        if cf_blocked:
            # 把"被 CF 拦"做成友好提示写进 error，前端会显示
            result.error = (
                "Cloudflare 拦截（HTTP 403 + cf-ray）。请在桌面端用 Edge 打开 "
                "https://cn.investing.com/economic-calendar 通过人机验证后，"
                "把浏览器 cookie 导出为 data/investing_cookies.json，"
                "应用内点「立即更新」即会带上 cookie 重新拉取。"
            )
        elif errors:
            result.error = "; ".join(errors)[:300]

        log.info(
            "investing fetch done: %d events across %d countries; counts=%s",
            len(all_events),
            len(countries),
            per_country,
        )
        return all_events, result

    async def _fetch_one(
        self,
        client: httpx.AsyncClient,
        sem: asyncio.Semaphore,
        start: date_t,
        end: date_t,
        country: str,
        importance: int,
    ) -> tuple[str, list[Event], str | None, bool]:
        params: list[tuple[str, str]] = [
            ("country[]", country),
            ("importance", str(importance)),
            ("dateFrom", start.strftime("%m/%d/%Y")),
            ("dateTo", end.strftime("%m/%d/%Y")),
            ("timeZone", str(cfg.INVESTING_TIMEZONE_ID)),
            ("lang", "zh"),
        ]
        url = cfg.INVESTING_CALENDAR_ENDPOINT
        layer_id = cfg.LayerID.INVESTING_PREFIX + country
        try:
            async with sem:
                resp = await client.get(url, params=params)
            cf_blocked = _is_cf_block(resp)
            if resp.status_code != 200:
                return country, [], f"HTTP {resp.status_code}", cf_blocked
            data = resp.json()
            if data is False or data == "false" or data == "":
                return country, [], None, False  # 该组合无数据，不算错误
            if not isinstance(data, list):
                return country, [], f"unexpected response: {str(data)[:80]}", cf_blocked
            events = [_parse_item(item, layer_id, country) for item in data]
            events = [e for e in events if e is not None]
            return country, events, None, cf_blocked
        except Exception as e:
            log.warning("investing fetch %s importance=%s failed: %s", country, importance, e)
            return country, [], str(e), False


# ---------------------------------------------------------------------------
# 解析
# ---------------------------------------------------------------------------


def _strip_tags(s: str) -> str:
    """去掉简单 HTML 标签并 collapse 空白。"""
    if not s:
        return ""
    text = _TAG_RE.sub(" ", s)
    text = html.unescape(text)
    text = _WS_RE.sub(" ", text).strip()
    return text


def _is_cf_block(resp: httpx.Response) -> bool:
    """判断响应是否为 Cloudflare 拦截（403 + cf-* 头）。"""
    if resp.status_code in (403, 503):
        h = {k.lower() for k in resp.headers.keys()}
        if any(name in h for name in _CF_HINT_HEADERS):
            return True
    return False


def _parse_date(date_str: str, time_str: str) -> date_t | None:
    """合并 date + time 字段解析成 date_t。

    investing.com 通常 date='Sep 01, 2026' time='10:00 AM'（GMT+8）。
    time 为空/All Day 时只取 date 部分。
    """
    if not date_str:
        return None
    s = str(date_str).strip()
    fmts = ["%b %d, %Y", "%Y-%m-%d", "%m/%d/%Y"]
    for fmt in fmts:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s).date()
    except Exception:
        return None


def _vs_forecast(actual: str | None, forecast: str | None, previous: str | None) -> str:
    """根据 actual / forecast / previous 推导 vs 预期。

    - actual 缺失或 "—" / "" → 待公布
    - 否则尝试按浮点比大小；不可比较 → 符合
    """
    if not actual or actual.strip() in ("", "—", "-"):
        return "待公布"
    a = _to_number(actual)
    f = _to_number(forecast) if forecast else None
    if a is None or f is None:
        return "符合"
    if a > f:
        return "超预期"
    if a < f:
        return "不及"
    return "符合"


def _to_number(v: str) -> float | None:
    if v is None:
        return None
    s = str(v).strip().replace(",", "").replace("%", "")
    # 处理 "1.5K" / "2.3M" / "-8.330M" 这种尾缀
    m = re.match(r"^(-?\d+(?:\.\d+)?)\s*([KkMmBb])?$", s)
    if not m:
        return None
    val = float(m.group(1))
    unit = (m.group(2) or "").upper()
    if unit == "K":
        val *= 1_000
    elif unit == "M":
        val *= 1_000_000
    elif unit == "B":
        val *= 1_000_000_000
    return val


def _parse_item(item: dict[str, Any], layer_id: str, country: str) -> Event | None:
    """把一条原始 investing.com item 转成 Event。"""
    try:
        title_html = str(item.get("title") or "")
        title = _strip_tags(title_html)
        if not title:
            return None
        d = _parse_date(str(item.get("date") or ""), str(item.get("time") or ""))
        if d is None:
            return None

        time_str = _strip_tags(str(item.get("time") or ""))
        actual = _strip_tags(str(item.get("actual") or ""))
        forecast = _strip_tags(str(item.get("forecast") or ""))
        previous = _strip_tags(str(item.get("previous") or ""))

        importance_raw = item.get("importance")
        try:
            importance_int = int(importance_raw) if importance_raw is not None else 0
        except (ValueError, TypeError):
            importance_int = 0

        vs = _vs_forecast(actual or None, forecast or None, previous or None)

        country_info = cfg.INVESTING_COUNTRIES.get(country, {})
        country_name = str(country_info.get("name") or f"country_{country}")
        currency = str(country_info.get("currency") or "")
        color = str(country_info.get("color") or "#3D6BFB")

        ev_id = str(item.get("id") or "")
        source_ref = (
            f"{country}:{ev_id}" if ev_id
            else f"{country}:{title}:{d.isoformat()}:{time_str}"
        )

        extra: dict[str, Any] = {
            "country": country_name,
            "country_code": country,
            "currency": currency,
            "importance": importance_int,
            "vs_forecast": vs,
        }
        if time_str:
            extra["time"] = time_str
        if actual:
            extra["actual"] = actual
        if forecast:
            extra["forecast"] = forecast
        if previous:
            extra["previous"] = previous

        return Event(
            layer_id=layer_id,
            source="investing",
            date=d,
            title=title,
            description=None,
            color=color,
            source_ref=source_ref,
            extra=extra,
            sort_key=0,
        )
    except Exception as e:
        log.warning("failed to parse investing item %s: %s", item, e)
        return None


# ---------------------------------------------------------------------------
# Cookie 文件读取（桌面应用让用户从浏览器导出）
# ---------------------------------------------------------------------------


def load_cookies_file(path: str) -> dict[str, str]:
    """从 data/investing_cookies.json 读 cookie 字典。

    支持格式：
      {"name": "value", ...}
      或 Netscape cookies.txt（每行 `domain\tflag\tpath\tsecure\texpiry\tname\tvalue`）

    返回 {name: value} 字典。
    """
    try:
        raw = open(path, "r", encoding="utf-8").read()
    except OSError as e:
        raise FileNotFoundError(f"无法读取 cookie 文件 {path}: {e}") from e

    # 先尝试 JSON
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            return {str(k): str(v) for k, v in obj.items()}
    except json.JSONDecodeError:
        pass

    # 回落到 Netscape cookies.txt
    out: dict[str, str] = {}
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or s.startswith("//"):
            continue
        parts = s.split("\t")
        if len(parts) < 7:
            continue
        name = parts[5]
        value = parts[6]
        if name and value is not None:
            out[name] = value
    return out


__all__ = [
    "InvestingSource",
    "load_cookies_file",
]