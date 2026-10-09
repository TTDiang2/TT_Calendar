"""本地 API 的 Host 校验（F-003）。

本服务是无认证的本地 sidecar API，绑127.0.0.1，且进程内持有可写 GitHub PAT 的
操作能力。若不校验 Host 头，恶意网页可以用 DNS rebinding 把自己的域名解析到
127.0.0.1，此后同源即可读写全部个人数据、并把同步目标仓库改到攻击者名下。

注意 CORS **挡不住**这个：CORS 只约束浏览器 JS 能否读取响应，不阻止请求发出。
真正生效的是 TrustedHostMiddleware——它在 Host 不在白名单时直接 400。

这些用例同时是「白名单没有把正常客户端挡在门外」的回归防线：加得太紧会让应用
自己打不开后端，这比 rebinding 更容易发生且更难排查。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import main as backend_main  # noqa: E402


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(backend_main.app)


def _health(client: TestClient, host: str):
    return client.get("/health", headers={"Host": host})


@pytest.mark.parametrize("host", [
    "127.0.0.1:8765",
    "localhost:8765",
    "127.0.0.1",
    "localhost",
    "tauri.localhost",
    "testserver",
])
def test_allowed_hosts_pass(client: TestClient, host: str) -> None:
    """正常客户端必须能连上——白名单过紧会把应用自己挡在门外。"""
    r = _health(client, host)
    assert r.status_code == 200, f"{host} 应被放行，实际 {r.status_code}"


@pytest.mark.parametrize("host", [
    "evil.com",
    "attacker.example.com",
    "127.0.0.1.evil.com",      # 前缀欺骗
    "evil.com:8765",
])
def test_rebinding_hosts_rejected(client: TestClient, host: str) -> None:
    """非白名单 Host 一律拒绝——DNS rebinding 的最后一道防线。"""
    r = _health(client, host)
    assert r.status_code == 400, f"{host} 应被 400 拒绝，实际 {r.status_code}"


def test_data_endpoints_also_protected(client: TestClient) -> None:
    """不止/health：数据端点同样受Host 校验保护。"""
    r = client.get("/api/todo", headers={"Host": "evil.com"})
    assert r.status_code == 400


def test_trustedhost_middleware_is_registered() -> None:
    """确认中间件真的挂上了（而非只在本测试里生效）。"""
    names = {m.cls.__name__ for m in backend_main.app.user_middleware}
    assert "TrustedHostMiddleware" in names, f"未注册，当前中间件：{names}"