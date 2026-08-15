"""GitHubProvider 空仓库/正常仓库/错误路径单测（httpx.MockTransport，不发真实请求）。"""

import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tt_calendar.sync.providers import GitHubProvider, ProviderError, encode_files


def handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    method = request.method
    calls.append((method, path))

    if path.endswith("/contents/.tt-calendar-sync") and method == "PUT":
        BOOTSTRAPPED[0] = True
        return httpx.Response(201, json={"commit": {"sha": "initcommit"}})
    if path.endswith("/git/ref/heads/main"):
        if EMPTY_REPO and not BOOTSTRAPPED[0]:
            return httpx.Response(409, json={"message": "Git Repository is empty."})
        return httpx.Response(200, json={"object": {"sha": "headsha"}})
    if path.endswith("/git/commits/headsha"):
        return httpx.Response(200, json={"tree": {"sha": "treesha"}})
    if path.endswith("/git/trees/headsha"):
        return httpx.Response(200, json={"tree": [
            {"path": "data/todo.json", "type": "blob", "sha": "blob1"},
            {"path": "manifest.json", "type": "blob", "sha": "blobm"},
        ], "sha": "treesha"})
    if path.endswith("/git/blobs/blob1"):
        return httpx.Response(200, json={
            "content": __import__("base64").b64encode(
                json.dumps({"rows": [{"id": "t1"}]}).encode()).decode()})
    if path.endswith("/git/blobs/blobm"):
        return httpx.Response(200, json={"content": ""})
    if path.endswith("/git/blobs"):
        return httpx.Response(201, json={"sha": "newblob"})
    if path.endswith("/git/trees"):
        return httpx.Response(201, json={"sha": "newtree"})
    if path.endswith("/git/commits"):
        return httpx.Response(201, json={"sha": "newcommit"})
    if "/git/refs/heads/main" in path and method == "PATCH":
        if PUSH_CONFLICT:
            return httpx.Response(422, json={"message": "Update is not a fast forward"})
        return httpx.Response(200, json={})
    if path.endswith("/repos/TTDiang2/tt-calendar-data"):
        return httpx.Response(200, json={"visibility": "private", "default_branch": "main"})
    return httpx.Response(404, json={"message": f"unexpected {method} {path}"})


calls: list = []
EMPTY_REPO = False
BOOTSTRAPPED = [False]
PUSH_CONFLICT = False


def make_provider():
    return GitHubProvider("TTDiang2/tt-calendar-data", "github_pat_x",
                          transport=httpx.MockTransport(handler))


def test_empty_repo_fetch_returns_none():
    global EMPTY_REPO
    EMPTY_REPO = True
    assert make_provider().fetch() is None


def test_empty_repo_fetch_409_returns_none():
    # GitHub 对空仓库的 GET ref 返回 409 "Git Repository is empty."（不是 404），
    # 曾经 KeyError 炸成 500 → 前端 "Failed to fetch"
    def h(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/repos/TTDiang2/tt-calendar-data"):
            return httpx.Response(200, json={"visibility": "private"})
        if "/git/ref/heads/main" in request.url.path:
            return httpx.Response(409, json={"message": "Git Repository is empty.",
                                             "status": "409"})
        return httpx.Response(404, json={"message": "Not Found"})

    p = GitHubProvider("TTDiang2/tt-calendar-data", "github_pat_x",
                       transport=httpx.MockTransport(h))
    assert p.fetch() is None


def test_empty_repo_push_bootstraps():
    global EMPTY_REPO, calls, BOOTSTRAPPED
    EMPTY_REPO = True
    BOOTSTRAPPED[0] = False
    calls = []
    files = encode_files({"todo": [{"id": "t1"}]}, {}, "pc1")
    url = make_provider().push(files, "init")
    assert url.endswith("/commit/newcommit")
    # 空仓库必须先 PUT 占位文件制造第一个 commit，再 PATCH ref（而非 POST /git/refs）
    assert ("PUT", "/repos/TTDiang2/tt-calendar-data/contents/.tt-calendar-sync") in calls
    assert ("PATCH", "/repos/TTDiang2/tt-calendar-data/git/refs/heads/main") in calls
    assert not any(m == "POST" and p.endswith("/git/refs") for m, p in calls)


def test_normal_fetch_reads_files():
    global EMPTY_REPO, BOOTSTRAPPED
    EMPTY_REPO = False
    BOOTSTRAPPED[0] = False
    snap = make_provider().fetch()
    assert snap is not None
    assert snap.data == {"todo": [{"id": "t1"}]}
    assert snap.tree_sha == "treesha"


def test_push_conflict_raises():
    global PUSH_CONFLICT, EMPTY_REPO, BOOTSTRAPPED
    PUSH_CONFLICT = True
    EMPTY_REPO = False
    BOOTSTRAPPED[0] = False
    try:
        make_provider().push({"data/x.json": "{}"}, "m")
        assert False, "应抛 ProviderError"
    except ProviderError as e:
        assert "并发冲突" in str(e)
    finally:
        PUSH_CONFLICT = False


def test_repo_404_message():
    # mock 对所有请求都 404 → /user/repos 也 404 → 报"不存在或未授权任何仓库"
    p = GitHubProvider("TTDiang2/no-such-repo", "github_pat_x",
                       transport=httpx.MockTransport(
                           lambda req: httpx.Response(404, json={"message": "Not Found"})))
    r = p.test()
    assert r["ok"] is False
    assert "不存在" in r["detail"] or "未授权" in r["detail"]


def test_repo_404_shows_pat_visible_repos():
    # PAT 有效但只授权了别的仓库 → 报错列出 PAT 可见的仓库并指路
    def selective(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/user":
            return httpx.Response(200, json={"login": "TTDiang2"})
        if req.url.path == "/user/repos":
            return httpx.Response(200, json=[{"full_name": "TTDiang2/other-repo"}])
        return httpx.Response(404, json={"message": "Not Found"})

    p = GitHubProvider("TTDiang2/tt-calendar-data", "github_pat_x",
                       transport=httpx.MockTransport(selective))
    r = p.test()
    assert r["ok"] is False
    assert "other-repo" in r["detail"]
    assert "Repository access" in r["detail"]


def test_fetch_no_repo_access_clear_error():
    # fine-grained PAT 未授权该仓库时 /repos 也返回 404，必须报"无法访问"而非误判空仓库
    p = GitHubProvider("TTDiang2/tt-calendar-data", "github_pat_x",
                       transport=httpx.MockTransport(
                           lambda req: httpx.Response(404, json={"message": "Not Found"})))
    try:
        p.fetch()
        assert False, "应抛 ProviderError"
    except ProviderError as e:
        assert "无法访问仓库" in str(e)
        assert "Repository access" in str(e)


def test_bad_token_message():
    p = GitHubProvider("TTDiang2/tt-calendar-data", "github_pat_x",
                       transport=httpx.MockTransport(
                           lambda req: httpx.Response(401, json={"message": "Bad credentials"})))
    r = p.test()
    assert r["ok"] is False
    assert "401" in r["detail"]


def test_readonly_contents_fails_test_with_guidance():
    # 用户实际踩到的坑：Contents 只读时「测试连接」通过但同步失败，
    # test() 必须用写探针提前暴露（403 "Resource not accessible by PAT"）
    def h(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/user":
            return httpx.Response(200, json={"login": "TTDiang2"})
        if req.url.path.endswith("/repos/TTDiang2/tt-calendar-data"):
            return httpx.Response(200, json={"visibility": "private",
                                             "default_branch": "main"})
        if req.url.path.endswith("/git/blobs") and req.method == "POST":
            return httpx.Response(403, json={
                "message": "Resource not accessible by personal access token"})
        return httpx.Response(404, json={"message": "Not Found"})

    p = GitHubProvider("TTDiang2/tt-calendar-data", "github_pat_x",
                       transport=httpx.MockTransport(h))
    r = p.test()
    assert r["ok"] is False
    assert "Contents" in r["detail"]
    assert "Read and write" in r["detail"]


def test_readwrite_passes_and_reports():
    def h(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/user":
            return httpx.Response(200, json={"login": "TTDiang2"})
        if req.url.path.endswith("/repos/TTDiang2/tt-calendar-data"):
            return httpx.Response(200, json={"visibility": "private",
                                             "default_branch": "main"})
        if req.url.path.endswith("/git/blobs") and req.method == "POST":
            return httpx.Response(201, json={"sha": "x"})
        return httpx.Response(404, json={"message": "Not Found"})

    p = GitHubProvider("TTDiang2/tt-calendar-data", "github_pat_x",
                       transport=httpx.MockTransport(h))
    r = p.test()
    assert r["ok"] is True
    assert "读写权限" in r["detail"]
