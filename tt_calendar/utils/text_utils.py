"""文本工具：HTML 清洗、截断、首行提取。"""

from __future__ import annotations

import re
from html import unescape

from bs4 import BeautifulSoup


_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def html_to_plain(html: str | None) -> str:
    """HTML 转 plain text：换行保留为 \\n。"""

    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    # <br> 转 \n
    for br in soup.find_all("br"):
        br.replace_with("\n")
    text = soup.get_text()
    text = unescape(text)
    text = _WS_RE.sub(" ", text).strip()
    return text


def first_line(text: str | None, max_len: int = 40) -> str:
    """取第一行，按 max_len 截断。"""

    if not text:
        return ""
    first = text.split("\n", 1)[0].strip()
    if len(first) > max_len:
        return first[: max_len - 1] + "…"
    return first


def truncate(text: str | None, max_len: int) -> str:
    """按 max_len 截断加省略号。"""

    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def strip_brackets(title: str) -> tuple[str, str]:
    """把开头的【...】分离出来，返回 (括号内, 剩余)。

    例如 '【下修股东会】山鹰转债' -> ('下修股东会', '山鹰转债')。
    没有括号时返回 ('', 原文)。
    """

    if not title:
        return "", ""
    t = title.strip()
    if t.startswith("【"):
        end = t.find("】")
        if end > 0:
            return t[1:end], t[end + 1 :].strip()
    return "", t
