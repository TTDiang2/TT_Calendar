"""端点冒烟：把「从未被任何测试调用过」的路径纳入覆盖。

此前 61 个端点里有 23 个没有任何 HTTP 层测试——不是坏了没人发现，而是坏了也
没人发现。其中三条最危险的路径此前零覆盖：
- POST /api/import/{source_id}  触发插件抓取远端
- /api/subscriptions/*            订阅全生命周期
- POST /api/todo/import/csv      唯一处理外部文件的端点

这里为每个补一条冒烟：断言状态码与响应关键形状，不追求覆盖每条分支——目的是把
「完全没跑过」变成「跑过且形状正确」，让改动它们时CI 有反应。
"""

from __future__ import annotations

import io
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

HOST = {"Host": "127.0.0.1:8765"}


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    conn = sqlite3.connect(tmp_path / "t.db", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    ensure_sync_schema(conn)
    db.ensure_default_layer_configs(conn)
    db.ensure_todo_layer(conn)
    db.ensure_todo_done_layer(conn)
    backend_main.app.dependency_overrides[deps.get_db] = lambda: conn
    try:
        yield TestClient(backend_main.app)
    finally:
        backend_main.app.dependency_overrides.clear()
        conn.close()




# ------------------------------------------------------------------ 视图


def test_year_view_shape(client: TestClient) -> None:
    r = client.get("/api/view/year/2026", headers=HOST)
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["months"]) == 12, "年视图应返回 12 个月"
    assert sum(len(m["days"]) for m in data["months"]) >= 365


# ------------------------------------------------------------------ 日程


def test_put_legacy_three_slot_schedule(client: TestClient) -> None:
    """三段式日程的后端端点仍在（前端已无入口），至少保证它没坏。"""
    r = client.put("/api/schedule/2026-09-10",
                   json={"date": "2026-09-10", "am": "开会", "pm": None, "ev": None},
                   headers=HOST)
    assert r.status_code == 200, r.text


# ------------------------------------------------------------------ 标记


def test_delete_mark(client: TestClient) -> None:
    assert client.post("/api/marks", headers=HOST,
                       json={"layer_id": "coloring", "date": "2026-09-10",
                             "level": 2}).status_code == 200
    r = client.delete("/api/marks/coloring/2026-09-10", headers=HOST)
    assert r.status_code == 200, r.text


# ------------------------------------------------------------------ 图层


def test_layer_config_update(client: TestClient) -> None:
    r = client.put("/api/layers/coloring/config", headers=HOST,
                   json={"min_importance": 2})
    assert r.status_code == 200, r.text
    assert r.json()["layer_id"] == "coloring"


def test_layer_config_unknown_layer_is_404(client: TestClient) -> None:
    r = client.put("/api/layers/nope/config", headers=HOST, json={"enabled": True})
    assert r.status_code == 404, r.text


def test_sub_actions_rejected_for_builtin_layer(client: TestClient) -> None:
    """内置图层不声明子动作规则，应给出可读说明而非空列表或 500。"""
    r = client.get("/api/layers/coloring/sub-actions", headers=HOST)
    assert r.status_code == 400, r.text
    assert "子动作" in r.json()["detail"]


# ------------------------------------------------------------------ 改期


def test_move_day_endpoint(client: TestClient) -> None:
    r = client.post("/api/move-day", headers=HOST,
                    json={"src": "2026-08-10", "dst": "2026-08-12"})
    assert r.status_code == 200, r.text
    assert set(r.json()) >= {"moved_events", "moved_schedule"}


# ------------------------------------------------------------------ 同步


def test_sync_status_endpoint(client: TestClient) -> None:
    r = client.get("/api/sync/status", headers=HOST)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), dict)


def test_sync_now_without_config_reports_error(client: TestClient) -> None:
    """未配置同步时应给出可读错误，而不是 500。"""
    r = client.post("/api/sync/now", headers=HOST)
    assert r.status_code in (400, 409, 422), f"实际 {r.status_code}: {r.text}"
    assert "同步" in r.text or "PAT" in r.text or "仓库" in r.text


def test_sync_test_without_config(client: TestClient) -> None:
    r = client.post("/api/sync/test", headers=HOST)
    assert r.status_code == 200, r.text
    assert "ok" in r.json()


def test_sync_resolve_rejects_unknown_mode(client: TestClient) -> None:
    r = client.post("/api/sync/resolve", headers=HOST, json={"mode": "瞎写"})
    assert r.status_code in (400, 422), f"实际 {r.status_code}"


def test_sync_config_rejects_bad_repo(client: TestClient) -> None:
    """同步目标仓库的白名单在这条写路径上同样生效。"""
    r = client.put("/api/sync/config", headers=HOST,
                   json={"repo": "../../etc/passwd", "branch": "main"})
    assert r.status_code == 400, r.text


# ------------------------------------------------------------------ 统计


def test_stats_summary_shape(client: TestClient) -> None:
    r = client.get("/api/stats/summary", headers=HOST)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), dict)


def test_todo_stats_shape(client: TestClient) -> None:
    r = client.get("/api/todo/stats", headers=HOST)
    assert r.status_code == 200, r.text
    body = r.json()
    assert {"total", "incomplete", "completed"} <= set(body), body


# ------------------------------------------------------------------ 数据源


def test_sources_listing(client: TestClient) -> None:
    r = client.get("/api/sources", headers=HOST)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


def test_import_unknown_source_degrades_gracefully(client: TestClient) -> None:
    """未知 source_id 不抛错，而是回一个带 error 的空结果。

    这里刻意断言「不抛错」：导入是用户点一下就会触发的动作，若因配置里残留一个
    已卸载的插件 id 就 500，用户只能干瞪眼。绝不触发真实网络抓取。
    """
    r = client.post("/api/import/no_such_source_xyz", headers=HOST,
                    json={"start": "2026-09-01", "end": "2026-09-02"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inserted"] == 0
    assert "no_such_source_xyz" in body["error"], body


# ------------------------------------------------------------------ 订阅


def test_subscription_lifecycle(client: TestClient) -> None:
    created = client.post("/api/subscriptions", headers=HOST, json={
        "display_name": "自建订阅", "url": "https://example.invalid/feed",
        "rules_text": "包含 会议", "auto_update": False,
    })
    assert created.status_code in (200, 201), created.text
    sub_id = created.json().get("id") or created.json().get("source_id")

    listed = client.get("/api/subscriptions", headers=HOST)
    assert listed.status_code == 200
    assert isinstance(listed.json(), list)

    patched = client.patch(f"/api/subscriptions/{sub_id}", headers=HOST,
                           json={"auto_update": True})
    assert patched.status_code == 200, patched.text

    assert client.delete(f"/api/subscriptions/{sub_id}", headers=HOST).status_code == 200
    assert client.delete(f"/api/subscriptions/{sub_id}", headers=HOST).status_code == 404


def test_refresh_due_subscriptions(client: TestClient) -> None:
    r = client.post("/api/subscriptions/refresh-due", headers=HOST)
    assert r.status_code == 200, r.text
    assert "refreshed" in r.json()


# ------------------------------------------------------------------ 待办


def test_todo_reorder(client: TestClient) -> None:
    for tid, title in (("t1", "a"), ("t2", "b")):
        assert client.post("/api/todo", headers=HOST, json={
            "id": tid, "list_id": "L1", "title": title,
        }).status_code == 200

    r = client.put("/api/todo/reorder", headers=HOST,
                   json={"ordered_ids": ["t2", "t1"]})
    assert r.status_code == 200, r.text
    assert [t["id"] for t in client.get("/api/todo", headers=HOST).json()] == ["t2", "t1"]


def test_csv_import_reports_row_errors(client: TestClient) -> None:
    """CSV 是唯一处理外部文件的入口：既要能导入，也要能报告行级错误。"""
    csv_body = (
        "id,body,due_date,importance,list_name,status,title\r\n"
        ",,2026-09-01,normal,默认,notStarted,来自CSV\r\n"
        ",,垃圾日期,normal,默认,notStarted,缺ID的行\r\n"
    )
    r = client.post("/api/todo/import/csv", headers=HOST,
                    files={"file": ("todos.csv", io.BytesIO(csv_body.encode()),
                                    "text/csv")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inserted"] >= 1, f"应至少导入一行：{body}"
    # 坏 due_date 是容错处理而非整行失败——但必须逐行报告，用户才知道哪行没生效
    assert any("due_date" in e for e in body["errors"]), body
    assert any("垃圾日期" in e for e in body["errors"]), \
        f"报错应指出是哪个值：{body['errors']}"


def test_csv_import_rejects_bad_header(client: TestClient) -> None:
    """表头不符必须明确报错，而不是把整列当数据硬灌。"""
    r = client.post("/api/todo/import/csv", headers=HOST,
                    files={"file": ("x.csv", io.BytesIO(b"a,b\r\n1,2\r\n"),
                                    "text/csv")})
    assert r.status_code == 400, r.text
    assert "表头" in r.json()["detail"]


def test_csv_import_empty_file(client: TestClient) -> None:
    r = client.post("/api/todo/import/csv", headers=HOST,
                    files={"file": ("empty.csv", io.BytesIO(b""), "text/csv")})
    assert r.status_code in (200, 400), f"实际 {r.status_code}: {r.text}"
