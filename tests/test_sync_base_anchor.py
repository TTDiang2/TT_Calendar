"""同步 base 锚点的时序回归（F-002）。

base 的语义是「上次同步完成时的数据形态」。如果 push 失败却仍然落base，
base 就领先于远端；下一轮三方合并会把那批「本地以为已同步、远端其实没有」的
变更判成 `brow == lrow`（无需推送），于是永远补不上——UI 只显示一条 warning，
用户的数据在另一台设备上静默消失。

这类 bug 结构上不可能被纯函数合并测试抓到：merge 本身是对的，错的是调用它
之后对 base 的处理。所以这里直接锁 sync_now 的时序。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tt_calendar.sync import engine as E  # noqa: E402
from tt_calendar.sync.providers import ProviderError  # noqa: E402


class _FakeRemote:
    def __init__(self, data: dict, tombstones: dict | None = None) -> None:
        self.data = data
        self.tombstones = tombstones or {}


class _FakeProvider:
    """记录 push 次数、可按需让 push 失败的假 Provider。"""

    def __init__(self, fail_with: str | None = None) -> None:
        self.fail_with = fail_with
        self.push_calls = 0

    def fetch(self) -> _FakeRemote:
        return _FakeRemote({"a": [{"v": 1}]})

    # encode_files 沿用真实实现：它只做 JSON 序列化，无副作用，桩掉反而容易
    # 遮蔽真实的数据形态（tombstones 是 dict 而非 list 这类）。

    def push(self, files, msg) -> str:
        self.push_calls += 1
        if self.fail_with:
            raise ProviderError(self.fail_with)
        return "https://example.test/commit/abc"


@pytest.fixture
def wired(monkeypatch):
    """打桩 engine 的外部依赖，并记录每次 _save_base / _save_status 调用。"""
    prov = _FakeProvider()
    saved: list[tuple] = []
    status: list[dict] = []

    monkeypatch.setattr(E, "_provider", lambda conn: prov, raising=False)
    monkeypatch.setattr(E, "_has_base", lambda: True, raising=False)
    monkeypatch.setattr(E, "_load_base", lambda: ({"a": [{"v": 0}]}, {}), raising=False)
    monkeypatch.setattr(E, "_save_base",
                        lambda data, tombs: saved.append((data, tombs)), raising=False)
    monkeypatch.setattr(E, "_save_status", lambda conn, st: status.append(st), raising=False)
    monkeypatch.setattr(E.S, "export_data", lambda conn: {"a": [{"v": 2}]}, raising=False)
    monkeypatch.setattr(E.S, "export_tombstones", lambda conn: {}, raising=False)
    monkeypatch.setattr(E.S, "import_plan", lambda conn, *a: None, raising=False)
    monkeypatch.setattr(E.S, "prune_tombstones", lambda conn: None, raising=False)

    # 合并结果固定为「有变更要推」，推上去的内容是 {"a":[{"v":2}]}
    # 注意 tombstones 是 dict（与 merge.py:97 及 providers.encode_files 的
    # .items() 一致），不是 list——写错会在 encode_files 里炸成形态不匹配。
    monkeypatch.setattr(E.M, "merge", lambda *a, **k: {
        "upsert": [], "deletes": [], "tombstones": {},
        "data": {"a": [{"v": 2}]}, "report": {"pulled": 0, "pushed": 1},
    }, raising=False)

    class _Conn:
        def commit(self):
            pass

    yield _Conn(), prov, saved, status


def test_push_failure_does_not_advance_base(wired):
    """push 失败时 base 必须保持不变——否则下一轮会把这批变更判成无需推送。"""
    conn, prov, saved, status = wired
    prov.fail_with = "网络不可达"

    out = E.sync_now(conn)

    assert prov.push_calls == 1
    assert out["result"] == "partial", "push 失败必须报 partial，不能报 ok"
    assert out.get("warning"), "必须留 warning 说明本地已合并但远端未更新"
    assert saved == [], "push 失败时绝不能落 base——这正是静默丢数据的根因"
    assert status and status[-1]["ok"] is False, "状态里也应标记失败"


def test_concurrent_conflict_retries_then_raises_without_saving_base(wired):
    """并发冲突重试逻辑不受影响：两次冲突后抛 SyncError，且全程不落 base。"""
    conn, prov, saved, _ = wired
    prov.fail_with = "并发冲突"

    with pytest.raises(E.SyncError):
        E.sync_now(conn)

    assert prov.push_calls == 2, "并发冲突应重试一次"
    assert saved == [], "重试耗尽后仍不应落 base"


def test_successful_push_advances_base(wired):
    """正常路径仍要落 base——否则会退化成「每次都全量重推」。"""
    conn, prov, saved, _ = wired

    out = E.sync_now(conn)

    assert out["result"] == "ok"
    assert len(saved) == 1, "push 成功后必须落 base"
    assert saved[0][0] == {"a": [{"v": 2}]}