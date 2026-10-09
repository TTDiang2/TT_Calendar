"""跨站请求防护（Origin 守卫）。

TrustedHost 校验 Host 头，但跨站请求的 Host 本来就是 127.0.0.1:8765（浏览器按
URL 填），所以它一路放行；CORS 也挡不住——它只约束 JS 能否读响应，不阻止请求
发出。于是任意网页都能对无 body 的 POST 端点发起「简单请求」（不触发预检），
其中 POST /api/sync/now 会用进程内持有的可写 GitHub PAT 把全部个人数据推到
远端仓库。

本文件同时钉住反面：合法客户端必须仍能连上。误伤 Tauri/Pake 的代价是应用
完全打不开后端，比攻击面更难发现。
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import deps  # noqa: E402
from backend import main as backend_main  # noqa: E402
from tt_calendar import db  # noqa: E402
from tt_calendar.sync.schema import ensure_sync_schema  # noqa: E402

# 无 body 的 POST：浏览器视为简单请求，不触发预检，是 CSRF 的经典入口。
# 这份清单必须与路由表保持一致——test_every_bodyless_post_is_covered_by_this_test
# 会拿 OpenAPI 逐个比对，漏了就会失败。审查报告原先列了 4 个，实际是 5 个：
# 漏了 /subscriptions/{sub_id}/refresh。
BODYLESS_POSTS = [
    "/api/sync/now",
    "/api/sync/test",
    "/api/subscriptions/refresh-due",
    "/api/subscriptions/{sub_id}/refresh",
    "/api/settings/todo-busy/recompute",
]

EVIL_ORIGINS = [
    "https://evil.example.com",
    "http://attacker.test",
    "http://127.0.0.1.evil.com",   # 前缀欺骗
    "http://localhost:8765.evil.com",
    "null",                        # sandboxed iframe / file:// 页面
]


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    conn = sqlite3.connect(tmp_path / "t.db", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    ensure_sync_schema(conn)
    backend_main.app.dependency_overrides[deps.get_db] = lambda: conn
    try:
        yield TestClient(backend_main.app)
    finally:
        backend_main.app.dependency_overrides.clear()
        conn.close()


def _host() -> dict:
    """Host 必须合法——否则请求会先被 TrustedHostMiddleware 拦掉，
    测的就不是 Origin 守卫了。"""
    return {"Host": "127.0.0.1:8765"}


@pytest.mark.parametrize("path", BODYLESS_POSTS)
@pytest.mark.parametrize("origin", EVIL_ORIGINS)
def test_cross_site_post_rejected(client: TestClient, path: str, origin: str) -> None:
    r = client.post(path, headers={**_host(), "Origin": origin})
    assert r.status_code == 403, f"{path} @ {origin} 应被拒，实际 {r.status_code}"


@pytest.mark.parametrize("origin", [
    "tauri://localhost",        # Tauri 2 Windows
    "http://tauri.localhost",   # Tauri 生产 origin
    "https://tauri.localhost",
    "http://127.0.0.1:8765",    # Pake 版：页面与 API 同源
    "http://localhost:8765",
    "http://localhost:5173",    # vite dev
    "http://127.0.0.1:5173",
])
def test_legitimate_origins_allowed(client: TestClient, origin: str) -> None:
    """误伤合法客户端的代价是应用打不开后端，比攻击面更难发现。"""
    r = client.post("/api/settings/todo-busy/recompute",
                    headers={**_host(), "Origin": origin})
    assert r.status_code == 200, f"{origin} 应放行，实际 {r.status_code}: {r.text}"


def test_no_origin_header_allowed(client: TestClient) -> None:
    """无 Origin 必须放行：launcher 健康探针、curl、python-httpx 都不带它。

    浏览器对 POST 与 fetch 一定会附 Origin，故缺失即非浏览器发起的跨站请求。
    """
    r = client.post("/api/settings/todo-busy/recompute", headers=_host())
    assert r.status_code == 200, r.text
    assert client.get("/health", headers=_host()).status_code == 200


def test_guard_also_covers_reads(client: TestClient) -> None:
    """跨站读取同样拒绝——CORS 只挡「读响应」，这里挡「发请求」。"""
    r = client.get("/api/todo", headers={**_host(), "Origin": "https://evil.example.com"})
    assert r.status_code == 403


def test_cors_and_guard_share_one_allowlist() -> None:
    """两份名单若各自维护，迟早漂移——那时 CORS 放行而守卫拒绝（或反之），
    表现为「本地好好的，打包后突然全 403」这类极难定位的问题。"""
    from backend.main import ALLOWED_ORIGINS, app

    cors = next(m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware")
    assert set(cors.kwargs["allow_origins"]) == set(ALLOWED_ORIGINS), \
        "CORS 与 Origin 守卫的白名单不一致"


def test_every_bodyless_post_is_covered_by_this_test() -> None:
    """守卫本文件若漏掉某个无 body 的 POST 类端点，就等于没测到它。

    用 OpenAPI 而非正则扫源码判定「简单请求」：POST 且操作不含 requestBody，
    才可能被浏览器无预检地发出。正则去猜函数签名既脆弱又会误判（`ev: Event`
    这类 Pydantic 参数并不叫 body，却同样是请求体）。
    """
    spec = backend_main.app.openapi()
    bodyless = {
        path
        for path, ops in spec["paths"].items()
        for method, op in ops.items()
        if method == "post" and "requestBody" not in op
    }
    uncovered = bodyless - set(BODYLESS_POSTS)
    assert not uncovered, f"这些无 body 的 POST 端点未被跨站测试覆盖：{uncovered}"
