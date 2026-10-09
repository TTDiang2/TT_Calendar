"""同步目标仓库/分支的输入校验（F-003 的第二半）。

`repo` 决定个人数据被推到哪个远端，而 sidecar 进程持有可写 PAT 的操作能力。
若接受任意字符串，攻击者（或误粘贴的 URL、带路径的仓库名）就能把数据写进
非预期仓库——而 Tauri 打包后CSRF Origin 恒为 null，Origin 校验也拦不住。

这些用例同时是「校验不能过严」的反向防线：真实仓库/分支名必须仍然通过。
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


@pytest.fixture
def client(tmp_path: Path):
    conn = sqlite3.connect(tmp_path / "t.db", check_same_thread=False)
    conn.row_factory = sqlite3.Row  # db.init_db 内部按列名取值，缺省会 TypeError
    db.init_db(conn)
    ensure_sync_schema(conn)
    backend_main.app.dependency_overrides[deps.get_db] = lambda: conn
    try:
        yield TestClient(backend_main.app)
    finally:
        backend_main.app.dependency_overrides.clear()
        conn.close()


def _put(client: TestClient, **body):
    return client.put("/api/sync/config", json={"repo": "o/r", "branch": "main", **body})


@pytest.mark.parametrize("repo", [
    "TTDiang2/TT_Calendar",
    "owner/repo.name",
    "a-b_c.d/e-f_g.h",
    "owner123/repo456",
])
def test_valid_repos_accepted(client: TestClient, repo: str) -> None:
    """真实形态的仓库名必须放行——过严的校验等于功能损坏。"""
    r = _put(client, repo=repo)
    assert r.status_code == 200, f"{repo} 应被接受，实际 {r.status_code}: {r.text}"


@pytest.mark.parametrize("repo", [
    "",                              # 空
    "owner",                         # 缺斜杠
    "/repo",                         # 缺 owner
    "owner/",                        # 缺 repo
    "https://github.com/owner/repo", # 误粘贴 URL
    "git@github.com:owner/repo.git", # 误粘贴 SSH 远程地址
    "owner/repo/extra",              # 多段路径
    "../../etc/passwd",              # 路径穿越
    "owner/repo\nX-Injected: 1",     # 换行注入头
    "owner/repo\n",                  # 仅末尾换行：Python 的 $ 会放过它，\Z 不会
    "owner/re po",                   # 空格
])
def test_invalid_repos_rejected(client: TestClient, repo: str) -> None:
    r = _put(client, repo=repo)
    assert r.status_code == 400, f"{repo!r} 应被 400 拒绝，实际 {r.status_code}"


@pytest.mark.parametrize("branch", [
    "main", "release/2.0", "feature_x", "v1.2.3",
])
def test_valid_branches_accepted(client: TestClient, branch: str) -> None:
    r = _put(client, branch=branch)
    assert r.status_code == 200, f"{branch!r} 应被接受，实际 {r.status_code}: {r.text}"


@pytest.mark.parametrize("branch", [
    "../../etc",
    "a..b",
    "/leading",
    "trailing/",
    "main branch",
    "main;rm -rf /",
])
def test_invalid_branches_rejected(client: TestClient, branch: str) -> None:
    r = _put(client, branch=branch)
    assert r.status_code == 400, f"{branch!r} 应被 400 拒绝，实际 {r.status_code}"


def test_empty_branch_falls_back_to_main(client: TestClient) -> None:
    """空分支回落main 是既有行为，不能被新校验误伤。"""
    r = _put(client, branch="")
    assert r.status_code == 200
    assert client.get("/api/sync/config").json()["branch"] == "main"


def test_invalid_repo_is_rejected_before_touching_db(client: TestClient) -> None:
    """校验必须发生在写库之前——否则非法值已经落盘，只是被后续覆盖。"""
    r = _put(client, repo="../../etc/passwd", token="ghp_fake")
    assert r.status_code == 400
    cfg = client.get("/api/sync/config").json()
    assert cfg["repo"] != "../../etc/passwd", "非法 repo 不应被写入配置"
    assert not cfg["has_token"], "非法请求不应写入 token"