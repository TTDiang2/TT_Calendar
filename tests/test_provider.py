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

    if path.endswith("/git/ref/heads/main"):
        if EMPTY_REPO:
            return httpx.Response(404, json={"message": "Not Found"})
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
    if path.endswith("/git/refs") and method == "POST":
        return httpx.Response(201, json={"ref": "refs/heads/main"})
    if "/git/refs/heads/main" in path and method == "PATCH":
        if PUSH_CONFLICT:
            return httpx.Response(422, json={"message": "Update is not a fast forward"})
        return httpx.Response(200, json={})
    if path.endswith("/repos/TTDiang2/tt-calendar-data"):
        return httpx.Response(200, json={"visibility": "private", "default_branch": "main"})
    return httpx.Response(404, json={"message": f"unexpected {method} {path}"})


calls: list = []
EMPTY_REPO = False
PUSH_CONFLICT = False


def make_provider():
    return GitHubProvider("TTDiang2/tt-calendar-data", "github_pat_x",
                          transport=httpx.MockTransport(handler))


def test_empty_repo_fetch_returns_none():
    global EMPTY_REPO
    EMPTY_REPO = True
    assert make_provider().fetch() is None


def test_empty_repo_push_creates_ref():
    global EMPTY_REPO, calls
    EMPTY_REPO = True
    calls = []
    files = encode_files({"todo": [{"id": "t1"}]}, {}, "pc1")
    url = make_provider().push(files, "init", None)
    assert url.endswith("/commit/newcommit")
    # 空仓库必须 POST /git/refs 创建分支，而不是 PATCH
    assert ("POST", "/repos/TTDiang2/tt-calendar-data/git/refs") in calls
    assert not any(m == "PATCH" and p.endswith("/git/refs/heads/main")
                   for m, p in calls)


def test_normal_fetch_reads_files():
    global EMPTY_REPO
    EMPTY_REPO = False
    snap = make_provider().fetch()
    assert snap is not None
    assert snap.data == {"todo": [{"id": "t1"}]}
    assert snap.tree_sha == "treesha"


def test_push_conflict_raises():
    global PUSH_CONFLICT, EMPTY_REPO
    PUSH_CONFLICT = True
    EMPTY_REPO = False
    try:
        make_provider().push({"data/x.json": "{}"}, "m", None)
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
