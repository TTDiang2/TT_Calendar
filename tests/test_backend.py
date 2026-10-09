"""后端 API 冒烟 + CRUD 回归。

原文件已是 TestClient（进程内、不起真实 server），但函数叫 main() 而非 test_*，
pytest 收集不到，于是「跑 API」的覆盖长期为零；而且它没覆盖写路径——读接口
只有 print，写接口根本没碰过。

另有两个必须修掉的毛病：
- 走的是 get_db 默认依赖，也就是真实生产库 data/calendar.db；测试不该碰用户数据。
- 断言稀薄：多数分支只 print，删错了也不会红。
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
def client(tmp_path: Path) -> TestClient:
    """每个用例一份独立库：绝不让测试落到用户的 data/calendar.db 上。"""
    conn = sqlite3.connect(tmp_path / "t.db", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    ensure_sync_schema(conn)
    db.ensure_default_layer_configs(conn)
    backend_main.app.dependency_overrides[deps.get_db] = lambda: conn
    try:
        yield TestClient(backend_main.app)
    finally:
        backend_main.app.dependency_overrides.clear()
        conn.close()


# ------------------------------------------------------------------ 读


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


@pytest.mark.parametrize("path,expected_days", [
    # 月视图按 6 周网格返回 42 天，不是按当月天数——前端要的是固定高度的网格
    ("/api/view/month/2026/8", 42),
    ("/api/view/week/2026-08-04", 7),
    ("/api/view/day/2026-08-04", 1),
])
def test_view_endpoints_shape(client: TestClient, path: str, expected_days: int) -> None:
    r = client.get(path)
    assert r.status_code == 200, r.text
    days = r.json()["days"]
    assert len(days) == expected_days, f"{path} 应返回 {expected_days} 天，实际 {len(days)}"
    for d in days:
        assert {"date", "is_today", "events_by_layer"} <= set(d), f"缺字段：{sorted(d)}"


def test_month_view_has_layers(client: TestClient) -> None:
    layers = client.get("/api/view/month/2026/8").json()["layers"]
    assert layers, "月视图应带出图层清单，前端靠它渲染侧栏"


def test_layers_listed(client: TestClient) -> None:
    r = client.get("/api/layers")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_countdown_and_search_shapes(client: TestClient) -> None:
    """倒数日无数据时返回带 empty 状态的 dict（不是空 list），搜索才是 list。"""
    countdown = client.get("/api/countdown")
    assert countdown.status_code == 200
    assert "text" in countdown.json(), countdown.text
    search = client.get("/api/search", params={"q": "CNV"})
    assert search.status_code == 200
    assert isinstance(search.json(), list)


# ------------------------------------------------------------------ CRUD


def _event_payload(title: str = "e1") -> dict:
    return {"layer_id": "custom_x", "source": "manual", "date": "2026-08-10",
            "title": title, "color": "#FF0000"}


def test_create_read_update_delete_event(client: TestClient) -> None:
    """完整写路径。原先这里一个写接口都没碰过。"""
    created = client.post("/api/events", json=_event_payload())
    assert created.status_code == 200, created.text

    day = client.get("/api/view/day/2026-08-10").json()["days"][0]
    titles = [e["title"] for layer in day["events_by_layer"].values() for e in layer]
    assert "e1" in titles, f"创建后应能读到，实际 {titles}"

    updated = client.put("/api/events/1", json=_event_payload("e1-改"))
    assert updated.status_code == 200, updated.text

    day = client.get("/api/view/day/2026-08-10").json()["days"][0]
    titles = [e["title"] for layer in day["events_by_layer"].values() for e in layer]
    assert "e1-改" in titles, f"更新未生效，实际 {titles}"
    assert "e1" not in titles, "旧标题应被覆盖而非并存"

    assert client.delete("/api/events/1").status_code == 200
    day = client.get("/api/view/day/2026-08-10").json()["days"][0]
    titles = [e["title"] for layer in day["events_by_layer"].values() for e in layer]
    assert titles == [], f"删除未生效，实际 {titles}"


def test_coloring_roundtrip(client: TestClient) -> None:
    assert client.put("/api/coloring/2026-08-11", json={"level": 3}).status_code == 200
    day = client.get("/api/view/day/2026-08-11").json()["days"][0]
    assert day["coloring_level"] == 3, f"涂色未生效：{day['coloring_level']}"

    assert client.delete("/api/coloring/2026-08-11").status_code == 200
    day = client.get("/api/view/day/2026-08-11").json()["days"][0]
    assert day["coloring_level"] is None


def test_todo_list_create_and_reorder(client: TestClient) -> None:
    """写路径的第二条线：清单与排序。"""
    created = client.post("/api/todo/lists", json={"display_name": "工作"})
    assert created.status_code == 200, created.text
    lists = client.get("/api/todo/lists").json()
    assert any(x["display_name"] == "工作" for x in lists), lists

    ids = [x["id"] for x in lists]
    assert client.put("/api/todo/lists/reorder",
                      json={"ordered_ids": list(reversed(ids))}).status_code == 200
    assert [x["id"] for x in client.get("/api/todo/lists").json()] == list(reversed(ids))