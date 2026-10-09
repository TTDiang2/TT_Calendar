"""多日日程的跨天展开语义。

原脚本起真实 uvicorn 子进程跑这些断言，因此pytest 收集不到、CI 也从不执行；
而这段逻辑恰恰最微妙：一条 9/10–9/12 的日程要在月视图里展开成三条，但三条的
`date` 都必须仍是首日（那是 DB 行的真实日期，编辑/删除按它回写），「今天是第
几天」改由 span_index 表达。一旦这里退化成按天改写 date，编辑就会打到错误的行。

改用进程内 TestClient：不必占端口、不会与其他测试抢 8012、且真正进入门禁。
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

MULTI = {"date": "2026-09-10", "end_date": "2026-09-12", "start_time": "09:00",
         "end_time": "18:00", "title": "多日会议", "color": "#3D6BFB",
         "category": "work", "sort_order": 0}
SINGLE = {"date": "2026-09-15", "end_date": None, "start_time": None,
          "end_time": None, "title": "单日", "color": None,
          "category": "other", "sort_order": 0}
SPAN_DAYS = ("2026-09-10", "2026-09-11", "2026-09-12")


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


def _create(client: TestClient, payload: dict) -> int:
    r = client.post("/api/schedule-items", json={**payload, "id": None})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _days(client: TestClient) -> dict[str, dict]:
    r = client.get("/api/view/month/2026/9")
    assert r.status_code == 200, r.text
    return {d["date"]: d for d in r.json()["days"]}


def _on(days: dict[str, dict], day: str, item_id: int) -> dict | None:
    return next((it for it in days[day]["schedule_items"] if it["id"] == item_id), None)


@pytest.fixture
def item_id(client: TestClient) -> int:
    return _create(client, MULTI)


def test_create_persists_end_date(client: TestClient) -> None:
    r = client.post("/api/schedule-items", json={**MULTI, "id": None})
    assert r.status_code == 200, r.text
    assert r.json()["end_date"] == "2026-09-12", r.json()


def test_multiday_expands_onto_every_day(client: TestClient, item_id: int) -> None:
    days = _days(client)
    missing = [d for d in SPAN_DAYS if not _on(days, d, item_id)]
    assert not missing, f"跨天日程未出现在：{missing}"


def test_span_markers(client: TestClient, item_id: int) -> None:
    days = _days(client)
    for day in SPAN_DAYS:
        it = _on(days, day, item_id)
        assert it["is_multi_day"] is True, f"{day}: is_multi_day 应为 True"
        assert it["span_total"] == 3, f"{day}: span_total 应为 3"
        assert it["span_start"] == "2026-09-10" and it["span_end"] == "2026-09-12"


def test_span_index_counts_1_2_3(client: TestClient, item_id: int) -> None:
    days = _days(client)
    assert _on(days, "2026-09-10", item_id)["span_index"] == 1, "首日 span_index 应为 1"
    assert _on(days, "2026-09-11", item_id)["span_index"] == 2, "中间日应为 2"
    assert _on(days, "2026-09-12", item_id)["span_index"] == 3, "末日应为 3"


def test_expanded_entries_keep_first_day_as_date(client: TestClient, item_id: int) -> None:
    """展开出的三条 date 必须都等于首日——那是 DB 行的真实日期，编辑/删除按它回写。"""
    days = _days(client)
    for day in SPAN_DAYS:
        it = _on(days, day, item_id)
        assert it["date"] == "2026-09-10", f"{day}: date 应恒为首日，实际 {it['date']}"
        assert it["end_date"] == "2026-09-12"


def test_single_day_item_has_no_span_metadata(client: TestClient) -> None:
    """单日日程行为不得被跨天逻辑污染。"""
    single_id = _create(client, SINGLE)
    it = _on(_days(client), "2026-09-15", single_id)
    assert it is not None
    assert not it.get("is_multi_day"), "单日日程不应带 is_multi_day"
    assert "span_index" not in it, "单日日程不应带 span_index"


def test_shrink_to_single_day_removes_other_days(client: TestClient, item_id: int) -> None:
    r = client.put(f"/api/schedule-items/{item_id}",
                   json={**MULTI, "id": item_id, "end_date": None})
    assert r.status_code == 200, r.text
    assert r.json()["end_date"] is None

    days = _days(client)
    assert _on(days, "2026-09-10", item_id), "缩成单日后应仍在首日"
    assert not _on(days, "2026-09-11", item_id), "缩成单日后中间日不应残留"
    assert not _on(days, "2026-09-12", item_id), "缩成单日后末日不应残留"


def test_day_query_hits_cross_day_entry(client: TestClient, item_id: int) -> None:
    """按天查询接口对跨天条目也要命中（取区间中间一天）。"""
    r = client.get("/api/schedule-items/2026-09-11")
    assert r.status_code == 200, r.text
    assert any(it["id"] == item_id for it in r.json()), "按天查询未命中跨天条目"


def test_delete_leaves_no_residue(client: TestClient, item_id: int) -> None:
    assert client.delete(f"/api/schedule-items/{item_id}").status_code == 200
    days = _days(client)
    residue = [d for d in SPAN_DAYS if _on(days, d, item_id)]
    assert not residue, f"删除后仍有残留：{residue}"