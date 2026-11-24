"""Gitee 同步通道（单文件 gzip 快照 + contents API）。

打桩点仍然是传输层：`httpx.MockTransport` 按 URL 分支返回真实形状的响应，
provider 内部的编解码、CAS（sha）、错误翻译全部走生产代码。

这些用例守的是三件容易悄悄坏掉的事：
1. 快照编解码必须与 `encode_files` 的多文件格式互认（换后端不丢表）
2. 更新必须带 sha（否则两端并发会互相覆盖，且不报错）
3. 409/422 必须翻译成「并发冲突」——engine 靠这个字符串决定重试
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar.sync import providers as P  # noqa: E402

SNAP_PATH = "/api/v5/repos/me/cal/contents/" + P.GITEE_SNAPSHOT_PATH


def _files() -> dict[str, str]:
    return {
        "manifest.json": json.dumps({"schema_version": 1, "device": "pc"}),
        "data/todo.json": json.dumps({"rows": [{"id": "t1", "title": "写方案"}]}),
        "data/tombstones.json": json.dumps({"todo|t9": "2026-11-01 10:00:00"}),
    }


def _provider(handler) -> P.GiteeProvider:
    return P.GiteeProvider("me/cal", "tok-test", "main",
                           transport=httpx.MockTransport(handler))


# ---------------------------------------------------------------- 编解码


def test_blob_roundtrip_preserves_all_tables():
    files = _files()
    assert P.decode_blob(P.encode_blob(files)) == files


def test_blob_accepts_plain_json_without_gzip():
    raw = json.dumps({"format": 1, "files": _files()}).encode("utf-8")
    assert P.decode_blob(raw) == _files()


def test_blob_rejects_foreign_content():
    # 被别的程序写坏时给明确错误，而不是把空 dict 当快照导入（会静默清库）
    with pytest.raises(P.ProviderError, match="远端快照"):
        P.decode_blob(b"not json at all")


def test_files_to_snapshot_splits_tombstones():
    snap = P.files_to_snapshot(_files(), "sha1")
    assert snap.data == {"todo": [{"id": "t1", "title": "写方案"}]}
    assert snap.tombstones == {("todo", "t9"): "2026-11-01 10:00:00"}
    assert snap.tree_sha == "sha1"


# ---------------------------------------------------------------- fetch


def test_fetch_returns_none_when_snapshot_absent():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/repos/me/cal"):
            return httpx.Response(200, json={"full_name": "me/cal"})
        return httpx.Response(404, json={"message": "Not Found"})

    assert _provider(handler).fetch() is None


def test_fetch_returns_none_when_contents_replies_200_empty_array():
    """Gitee 实测：文件不存在时 `/contents/<path>` 回 `200 []` 而不是 404。

    早先只判 404，于是空仓库永远拿不到 None，一路掉进 raw 接口报
    「下载快照失败：path」——首次同步（init upload）根本发不出去。
    """
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        if request.url.path.endswith("/repos/me/cal"):
            return httpx.Response(200, json={"full_name": "me/cal"})
        return httpx.Response(200, json=[])

    assert _provider(handler).fetch() is None
    assert not any("/raw/" in p for p in seen), "不该再去请求 raw"



def test_fetch_decodes_snapshot():
    blob = P.encode_blob(_files())

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/repos/me/cal"):
            return httpx.Response(200, json={"full_name": "me/cal"})
        return httpx.Response(200, json={
            "sha": "abc123",
            "content": base64.b64encode(blob).decode("ascii"),
        })

    snap = _provider(handler).fetch()
    assert snap is not None
    assert snap.tree_sha == "abc123"
    assert [r["title"] for r in snap.data["todo"]] == ["写方案"]


def test_fetch_falls_back_to_raw_when_content_is_blank():
    """contents 对 >1MB 正文返回空 content，必须退到 raw 接口。"""
    blob = P.encode_blob(_files())

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/repos/me/cal"):
            return httpx.Response(200, json={"full_name": "me/cal"})
        if "/raw/" in request.url.path:
            return httpx.Response(200, content=blob)
        return httpx.Response(200, json={"sha": "big", "content": ""})

    snap = _provider(handler).fetch()
    assert snap is not None and snap.tree_sha == "big"
    assert "todo" in snap.data


# ---------------------------------------------------------------- push


def test_push_creates_file_when_absent():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(404, json={"message": "Not Found"})
        seen["method"] = request.method
        seen["body"] = json.loads(request.content)
        return httpx.Response(201, json={"commit": {"sha": "c-new"}})

    url = _provider(handler).push(_files(), "sync: init")
    assert url == "https://gitee.com/me/cal/commit/c-new"
    assert seen["method"] == "POST"
    assert "sha" not in seen["body"]
    payload = P.decode_blob(base64.b64decode(seen["body"]["content"]))
    assert payload == _files()


def test_push_updates_with_sha_as_compare_and_swap():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"sha": "old-sha", "content": ""})
        seen["method"] = request.method
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"commit": {"sha": "c2"}})

    _provider(handler).push(_files(), "sync: update")
    assert seen["method"] == "PUT"
    assert seen["body"]["sha"] == "old-sha"


def test_push_maps_409_to_concurrency_conflict():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"sha": "old", "content": ""})
        return httpx.Response(409, json={"message": "sha mismatch"})

    with pytest.raises(P.ProviderError, match="并发冲突"):
        _provider(handler).push(_files(), "sync: update")


def test_push_maps_422_to_concurrency_conflict():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"sha": "old", "content": ""})
        return httpx.Response(422, json={"message": "invalid sha"})

    with pytest.raises(P.ProviderError, match="并发冲突"):
        _provider(handler).push(_files(), "sync: update")


# ---------------------------------------------------------------- 鉴权


def test_401_is_translated_to_actionable_message():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "Unauthorized"})

    with pytest.raises(P.ProviderError, match="私人令牌"):
        _provider(handler).fetch()


def test_token_travels_in_query_not_url_path():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["query"] = dict(request.url.params)
        if request.url.path.endswith("/repos/me/cal"):
            return httpx.Response(200, json={"full_name": "me/cal"})
        return httpx.Response(404, json={})

    assert _provider(handler).fetch() is None
    assert seen["query"].get("access_token") == "tok-test"


def test_push_retries_with_form_encoding_on_bare_400():
    """部分 Gitee 网关忽略 JSON body，回 400 且不带 message。

    这时必须换成表单编码再发一次，否则用户看到的是「上传快照失败：HTTP 400」
    这种无从下手的错误。
    """
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(404, json={})
        seen.append(request.headers.get("content-type", ""))
        if len(seen) == 1:
            return httpx.Response(400)
        return httpx.Response(201, json={"commit": {"sha": "c9"}})

    url = _provider(handler).push(_files(), "sync: init")
    assert url.endswith("/commit/c9")
    assert len(seen) == 2
    assert seen[0].startswith("application/json")
    assert seen[1].startswith("application/x-www-form-urlencoded")
