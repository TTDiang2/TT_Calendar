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
from bs4 import BeautifulSoup

from .. import config as cfg
from ..models import Event, ImportResult
from .base import Source

log = logging.getLogger(__name__)

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_HTML_TD_RE = re.compile(r"<[^>]+>")

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
            events = self._parse_response(resp, layer_id, country, importance)
            return country, events, None, cf_blocked
        except Exception as e:
            log.warning("investing fetch %s importance=%s failed: %s", country, importance, e)
            return country, [], str(e), False

    def _parse_response(
        self,
        resp: httpx.Response,
        layer_id: str,
        country: str,
        importance: int,
    ) -> list[Event]:
        """Investing.com 的 JSON Service 端点在不同站/配置下返回两种形态：
        1. 顶层 JSON 列表（早期投资日历的纯 API 形态）
        2. {"data": "<HTML 片段>"} 包装（当前 cn.investing.com 主站返回）
        都处理一下。一次性记下响应形态便于以后 debug。
        """
        try:
            data = resp.json()
        except Exception as e:
            log.warning("investing: response not JSON (%s): %r", e, resp.text[:200])
            return []

        if isinstance(data, list):
            log.debug("investing: top-level list shape, %d items", len(data))
            return [e for e in (_parse_item(it, layer_id, country) for it in data) if e]

        if isinstance(data, dict):
            inner = data.get("data")
            if isinstance(inner, list):
                log.debug("investing: dict-wrapped list, %d items", len(inner))
                return [e for e in (_parse_item(it, layer_id, country) for it in inner) if e]
            if isinstance(inner, str) and inner.strip():
                log.debug("investing: dict-wrapped HTML, %d chars", len(inner))
                return _parse_html_table(inner, layer_id, country, importance)

        log.warning("investing: unexpected response shape, top-level type=%s, sample=%r",
                    type(data).__name__, str(data)[:200])
        return []


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


# ---------------------------------------------------------------------------
# HTML 形态解析（用于 {"data": "<HTML 片段>"} 包装）
# ---------------------------------------------------------------------------

# cn.investing.com 事件行在返回的 HTML 片段里的常见选择器（按可靠性排序）
_HTML_ROW_SELECTORS = (
    "tr.js-event-item",
    "tr[data-event_attr_id]",
    "tr[class*='js-event']",
    "tr[class*='event']",
)
# 单格内文本/字段的常见选择器
_HTML_FIELD_TD = ("td", "th")


def _parse_html_table(
    html_fragment: str,
    layer_id: str,
    country: str,
    importance: int,
) -> list[Event]:
    """从 Service 端点 data 字段的 HTML 片段里解析事件行。
    选择器冗余覆盖不同的字段命名（Investing 历史上换过结构）。
    """
    try:
        soup = BeautifulSoup(html_fragment, "html.parser")
    except Exception as e:
        log.warning("investing: BS4 parse failed: %s", e)
        return []

    rows = []
    for sel in _HTML_ROW_SELECTORS:
        rows = soup.select(sel)
        if rows:
            break
    if not rows:
        log.warning("investing: no event rows found in HTML (len=%d)", len(html_fragment))
        return []

    country_info = cfg.INVESTING_COUNTRIES.get(country, {})
    country_name = str(country_info.get("name") or f"country_{country}")
    color = str(country_info.get("color") or "#3D6BFB")
    currency = str(country_info.get("currency") or "")

    out: list[Event] = []
    for tr in rows:
        try:
            ev = _parse_html_row(tr, layer_id, country, country_name, currency, color, importance)
            if ev:
                out.append(ev)
        except Exception as e:
            log.warning("investing: HTML row parse failed: %s", e)
    return out


def _parse_html_row(
    tr: Any,
    layer_id: str,
    country: str,
    country_name: str,
    currency: str,
    color: str,
    importance: int,
) -> Event | None:
    """从一行 tr 提取一条事件。HTML 形态字段命名不稳定，按 td 下标 + class 双轨取。"""
    tds = tr.find_all(_HTML_FIELD_TD)
    if len(tds) < 4:
        return None

    # 常见列结构: [时间, 货币/国家, 重要性, 事件名, 实际, 预报, 前值]
    # 退而其次: [时间, 重要性, 事件名, 实际, 预报, 前值]
    time_str = ""
    title = ""
    actual = forecast = previous = ""
    if len(tds) >= 7:
        time_str = tds[0].get_text(" ", strip=True)
        title = tds[3].get_text(" ", strip=True)
        actual = tds[4].get_text(" ", strip=True)
        forecast = tds[5].get_text(" ", strip=True)
        previous = tds[6].get_text(" ", strip=True)
    else:
        time_str = tds[0].get_text(" ", strip=True)
        title = tds[2].get_text(" ", strip=True)
        if len(tds) >= 6:
            actual = tds[3].get_text(" ", strip=True)
            forecast = tds[4].get_text(" ", strip=True)
            previous = tds[5].get_text(" ", strip=True)

    if not title:
        return None

    # 事件日期：行可能有 data-event-datetime 或父 theDay 头；为简化取 start..end 区间后从 time 推
    d = _date_from_html_row(tr, tds)
    if d is None:
        return None

    ev_id = tr.get("data-event_attr_id") or tr.get("event_attr_id") or tr.get("id") or ""

    vs = _vs_forecast(actual or None, forecast or None, previous or None)

    extra: dict[str, Any] = {
        "country": country_name,
        "country_code": country,
        "currency": currency,
        "importance": importance,
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

    source_ref = f"{country}:{ev_id}" if ev_id else f"{country}:{title}:{d.isoformat()}:{time_str}"

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


def _date_from_html_row(tr: Any, tds: list[Any]) -> date_t | None:
    """从一行 tr（或其 tds）推断事件日期。优先用 data-* 属性，回落 tds 文本。"""
    # 1) 显式日期属性
    for attr in ("data-event-datetime", "data-date", "data-start", "data-time-utc"):
        v = tr.get(attr)
        if v:
            try:
                if "T" in v:
                    return datetime.fromisoformat(v.replace("Z", "+00:00")).date()
                return datetime.strptime(v, "%Y-%m-%d").date()
            except Exception:
                pass
    # 2) 退而其次：找父 theDay 头（cn.investing.com HTML 里有 <tr class="theDay">日期头）
    parent = tr.parent
    if parent:
        for sib in parent.find_all("tr", recursive=False):
            if "theDay" in (sib.get("class") or []):
                day_text = sib.get_text(" ", strip=True)
                return _parse_day_header(day_text)
    # 3) 实在不行：今天的日期
    return date_t.today()


def _parse_day_header(s: str) -> date_t | None:
    """theDay 行文本形如 'Sep 1, 2026' 或 '2026年9月1日'。"""
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%Y年%m月%d日"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    return None


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