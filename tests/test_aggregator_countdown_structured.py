"""P2.5 回归：_next_occurrence 四元组改动后，全部调用点（含月视图染色钩子）不炸；
/api/countdown 结构化 banner 与兼容 text 并存。DB 隔离到 tmp_path。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient


def test_view_month_and_countdown_banner(tmp_path, monkeypatch):
    # DB_PATH 是请求时读取的模块常量 → patch 后 get_db 落到空库；再补 schema
    import tt_calendar.config as cfg
    import backend.deps as deps

    monkeypatch.setattr(cfg, "DB_PATH", tmp_path / "calendar.db")
    conn = deps.connect_db()
    conn.close()

    client = TestClient(app := __import__("backend.main", fromlist=["app"]).app)

    # 造一条年重复倒数日（2020-10-12 → 下一次 2026-10-12，n 周年标签）
    r = client.post("/api/countdown", json={
        "name": "姐姐生日", "category": "生日", "base_date": "2020-10-12",
        "repeat_yearly": True, "never_expire": True,
    })
    assert r.status_code == 200, r.text

    # 月视图：倒数日染色钩子路径（曾是 too-many-values 500 的根因）
    r = client.get("/api/view/month/2026/10")
    assert r.status_code == 200, r.text

    # 横幅：结构化 banner 与兼容 text 并存
    d = client.get("/api/countdown").json()
    assert d["banner"]["kind"] in ("today", "until") and d["banner"]["name"] == "姐姐生日"
    assert "距离" in d["text"] or "今天是" in d["text"]

    # 列表：label_kind 结构化（生日类无里程碑 → None）
    items = client.get("/api/countdown/list").json()
    row = next(x for x in items if x["name"] == "姐姐生日")
    assert row["label_kind"] is None or set(row["label_kind"]) <= {"kind", "n"}
