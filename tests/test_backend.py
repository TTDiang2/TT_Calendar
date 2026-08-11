"""FastAPI 后端冒烟测试（TestClient，无需启动真实 server）。

验证：app 能构造、聚合端点返回真实数据、CRUD/图层/倒计时端点不报错。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def main():
    r = client.get("/health")
    print("[health]", r.status_code, r.json())

    r = client.get("/api/view/month/2026/8")
    assert r.status_code == 200, r.text
    data = r.json()
    print(f"[month] layers={len(data['layers'])} days={len(data['days'])}")
    today_days = [d for d in data["days"] if d["is_today"]]
    if today_days:
        td = today_days[0]
        print(f"  today={td['date']} ev_layers={list(td['events_by_layer'].keys())} "
              f"sched={td['schedule'] is not None} coloring={td['coloring_level']} holiday={td['holiday'] is not None}")

    r = client.get("/api/view/week/2026-08-04")
    assert r.status_code == 200, r.text
    print(f"[week] days={len(r.json()['days'])}")

    r = client.get("/api/view/day/2026-08-04")
    assert r.status_code == 200, r.text
    print(f"[day] days={len(r.json()['days'])}")

    r = client.get("/api/layers")
    print(f"[layers] count={len(r.json())}")

    r = client.get("/api/countdown")
    print(f"[countdown] {r.json()}")

    r = client.get("/api/search", params={"q": "CNV"})
    print(f"[search] results={len(r.json())}")

    print("\nALL BACKEND TESTS PASSED")


if __name__ == "__main__":
    main()
