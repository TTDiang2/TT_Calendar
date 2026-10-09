"""写端点的输入边界。

背景有三处，都是「静默走偏」而非显式报错：

1. 路由层的裸 `ValueError`（`parse_date` 对畸形日期）此前一律变成 500，把
   「客户端传错了」误报成服务端故障。
2. `PUT /settings/todo-busy` 原签名是 `body: dict`，任意键都会被塞进配置落库；
   颜色字段还能塞非十六进制串，最终作为 CSS 值渲染。
3. `PUT /settings/todo-reminder` 用 `bool(body["enabled"])`，JSON 客户端传
   `"false"` 会因非空字符串恒真而把提醒打开——与意图正好相反。

同时也钉住「校验不能过严」：合法输入必须仍然通过，否则功能等于损坏。
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


# --------------------------------------------------------------------------
# 畸形日期：500 -> 400
# --------------------------------------------------------------------------

@pytest.mark.parametrize("path", [
    "/api/coloring/garbage",
    "/api/coloring/2026-13-45",
    "/api/coloring/20260101",
])
def test_malformed_date_returns_400_not_500(client: TestClient, path: str) -> None:
    """客户端传错是 400；此前一律 500，会把真实的服务端异常淹没在噪声里。"""
    r = client.put(path, json={"level": 1})
    assert r.status_code == 400, f"{path} 应返回 400，实际 {r.status_code}"


def test_valid_date_still_accepted(client: TestClient) -> None:
    """过严的校验等于功能损坏——合法日期必须仍然成功。"""
    r = client.put("/api/coloring/2026-09-10", json={"level": 2})
    assert r.status_code == 200, r.text
    assert client.put("/api/coloring/2026-09-10", json={"level": 0}).status_code == 200


# --------------------------------------------------------------------------
# coloring level：0..4 硬约束
# --------------------------------------------------------------------------

@pytest.mark.parametrize("level", [0, 1, 2, 3, 4])
def test_coloring_levels_accepted(client: TestClient, level: int) -> None:
    assert client.put("/api/coloring/2026-09-11", json={"level": level}).status_code == 200


@pytest.mark.parametrize("level", [-1, 5, 99, 1.5])
def test_coloring_levels_rejected(client: TestClient, level: float) -> None:
    """越界会取到 COLORING_COLORS[undefined] 并把非法值写进库。"""
    r = client.put("/api/coloring/2026-09-12", json={"level": level})
    assert r.status_code == 422, f"level={level} 应被拒，实际 {r.status_code}"


# --------------------------------------------------------------------------
# marks：字段边界
# --------------------------------------------------------------------------

@pytest.mark.parametrize("payload", [
    {"layer_id": "", "date": "2026-09-10"},                  # layer_id 空
    {"layer_id": "x" * 65, "date": "2026-09-10"},            # layer_id 超长
    {"layer_id": "coloring", "date": ""},                     # date 空
    {"layer_id": "coloring", "date": "x" * 33},              # date 超长
    {"layer_id": "coloring", "date": "2026-09-10", "level": -1},
    {"layer_id": "coloring", "date": "2026-09-10", "level": 5},
    {"layer_id": "coloring", "date": "2026-09-10", "note": "x" * 501},
])
def test_marks_invalid_payloads_rejected(client: TestClient, payload: dict) -> None:
    assert client.post("/api/marks", json=payload).status_code == 422, payload


def test_marks_valid_payload_accepted(client: TestClient) -> None:
    """level=None（solid 打勾）与 0..4（graded）都要放行。"""
    assert client.post("/api/marks", json={"layer_id": "coloring", "date": "2026-09-10"}).status_code == 200
    for lvl in range(5):
        assert client.post("/api/marks", json={
            "layer_id": "coloring", "date": "2026-09-10", "level": lvl,
        }).status_code == 200


# --------------------------------------------------------------------------
# todo-busy：拒绝未知键 + 深层合并 + 严格形状
# --------------------------------------------------------------------------

def test_busy_rejects_unknown_keys(client: TestClient) -> None:
    """原先 body: dict 会把任意键塞进配置并落库。"""
    r = client.put("/api/settings/todo-busy", json={"__evil__": "payload"})
    assert r.status_code == 422, f"未知键应被拒，实际 {r.status_code}: {r.text}"
    assert "__evil__" not in client.get("/api/settings/todo-busy").json()


@pytest.mark.parametrize("colors", [
    ["red"] * 5,                                        # 非十六进制：CSS 注入面
    ["#FFF"] * 5,                                        # 位数不足
    ["#FEF3C7", "#FDE68A", "#FBBF24"],                    # 不足 5 档
    ["#FEF3C7", "#FDE68A", "#FBBF24", "#F59E0B", "#B45309", "#FFFFFF"],
])
def test_busy_rejects_bad_colors(client: TestClient, colors: list[str]) -> None:
    # 长度违规由 Pydantic 请求校验拦下（422），非法格式由合并后校验拦下（400）；
    # 两层都拒绝，故不断言具体状态码，只钉住「不被接受」。
    r = client.put("/api/settings/todo-busy", json={"predict_colors": colors})
    assert r.status_code in (400, 422), f"应拒颜色 {colors}，实际 {r.status_code}"


def test_busy_rejects_non_ascending_thresholds(client: TestClient) -> None:
    """下游从 i=4 倒序找第一个 score>=thresholds[i]，升序是语义前提。"""
    r = client.put("/api/settings/todo-busy", json={"thresholds": [25, 15, 8, 3, 0]})
    assert r.status_code == 400, f"降序 thresholds 应被拒，实际 {r.status_code}"


def test_busy_partial_weights_deep_merge(client: TestClient) -> None:
    """部分更新不能把整个 weights 换掉——下游按 w['due_date'] 等直接下标取值。"""
    r = client.put("/api/settings/todo-busy", json={
        "weights": {"importance": {"high": 9}},
    })
    assert r.status_code == 200, r.text
    cfg = client.get("/api/settings/todo-busy").json()
    assert cfg["weights"]["importance"]["high"] == 9
    # 未提及的兄弟节点必须保留默认值
    assert cfg["weights"]["importance"]["medium"] == 2
    assert cfg["weights"]["due_date"] == 5
    assert cfg["weights"]["planned_date"] == 3
    assert cfg["weights"]["complexity"]["low"] == 1


def test_busy_full_replacement_still_works(client: TestClient) -> None:
    """整份提交是前端的常规用法，必须仍然可用。"""
    full = {
        "weights": {
            "due_date": 6, "planned_date": 4,
            "importance": {"high": 4, "medium": 2, "low": 1},
            "complexity": {"high": 2, "medium": 1.5, "low": 1},
        },
        "thresholds": [0, 4, 9, 16, 26],
        "predict_colors": ["#111111", "#222222", "#333333", "#444444", "#555555"],
        "done_colors": ["#666666", "#777777", "#888888", "#999999", "#AAAAAA"],
    }
    r = client.put("/api/settings/todo-busy", json=full)
    assert r.status_code == 200, r.text
    assert client.get("/api/settings/todo-busy").json() == full


def test_busy_empty_body_keeps_defaults(client: TestClient) -> None:
    r = client.put("/api/settings/todo-busy", json={})
    assert r.status_code == 200
    assert client.get("/api/settings/todo-busy").json() == db.DEFAULT_TODO_BUSY_CONFIG


# --------------------------------------------------------------------------
# todo-reminder：布尔强制转换缺陷 + time 格式
# --------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("false", False),
    ("true", True),
    (0, False),
    (1, True),
])
def test_reminder_enabled_is_strict_bool(client: TestClient, raw, expected) -> None:
    """原先 bool("false") 为 True，会把提醒意外打开——与调用方意图相反。"""
    r = client.put("/api/settings/todo-reminder", json={"enabled": raw})
    assert r.status_code in (200, 422), r.text
    if r.status_code == 200:
        assert client.get("/api/settings/todo-reminder").json()["enabled"] is expected


@pytest.mark.parametrize("t", ["16:00", "00:00", "23:59", "9:05"])
def test_reminder_time_accepted(client: TestClient, t: str) -> None:
    assert client.put("/api/settings/todo-reminder", json={"time": t}).status_code == 200


@pytest.mark.parametrize("t", ["24:00", "16:60", "1600", "abc", "16:00:00", "", "16;00"])
def test_reminder_time_rejected(client: TestClient, t: str) -> None:
    assert client.put("/api/settings/todo-reminder", json={"time": t}).status_code == 422, t


def test_reminder_rejects_unknown_keys(client: TestClient) -> None:
    r = client.put("/api/settings/todo-reminder", json={"enabled": True, "evil": 1})
    assert r.status_code == 422
