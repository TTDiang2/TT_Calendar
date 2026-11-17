"""英为财情 session 选择：CF 绕过靠 TLS 指纹，不靠把浏览器 cookie 发给 API。"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

# plugins/*.py 是用户本地的可选扩展，干净 checkout 里不存在。
investing = pytest.importorskip("plugins.investing")


def test_cffi_is_used_even_without_cookies(monkeypatch) -> None:
    calls: list[tuple[str, dict | None]] = []

    class FakeCffi:
        def __init__(self, headers, timeout, cookies=None):
            calls.append(("cffi", cookies))

    class FakeHttpx:
        def __init__(self, headers, timeout):
            calls.append(("httpx", None))

    monkeypatch.setattr(investing, "_HAS_CFFI", True)
    monkeypatch.setattr(investing, "_CffiSession", FakeCffi)
    monkeypatch.setattr(investing, "_HttpxSession", FakeHttpx)

    source = investing.InvestingSource()
    assert isinstance(asyncio.run(source._get_session()), FakeCffi)
    assert calls[-1] == ("cffi", None)

    cookies = {"cf_clearance": "token"}
    assert isinstance(asyncio.run(source._get_session(cookies)), FakeCffi)
    assert calls[-1] == ("cffi", cookies)


def test_httpx_fallback_does_not_attach_cookies(monkeypatch) -> None:
    class FakeHttpx:
        def __init__(self, headers, timeout):
            self.headers = headers
            self.timeout = timeout

    monkeypatch.setattr(investing, "_HAS_CFFI", False)
    monkeypatch.setattr(investing, "_HttpxSession", FakeHttpx)

    source = investing.InvestingSource()
    session = asyncio.run(source._get_session({"cf_clearance": "token"}))
    assert isinstance(session, FakeHttpx)
    assert not hasattr(session, "cookies")


def test_cf_cookies_are_scoped_to_cn_site(monkeypatch) -> None:
    cookie_calls: list[tuple[str, str, str]] = []

    class FakeCookies:
        def set(self, name, value, domain):
            cookie_calls.append((name, value, domain))

    class FakeSession:
        def __init__(self, impersonate):
            assert impersonate == "chrome120"
            self.cookies = FakeCookies()
            self.headers = {}

    monkeypatch.setattr(
        investing,
        "_cffi_requests",
        SimpleNamespace(Session=FakeSession),
    )

    investing._CffiSession({}, 20, {"cf_clearance": "token", "__cf_bm": "bm"})

    assert cookie_calls == [
        ("cf_clearance", "token", "cn.investing.com"),
        ("__cf_bm", "bm", "cn.investing.com"),
    ]
