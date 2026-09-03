"""HTTP 集成测试：多日日程跨天展开。

真实启动 uvicorn，走完整 API 链路验证：
  1. POST /api/schedule-items 创建 9/10-9/12 的多日日程
  2. GET /api/view/month/2026/9 → 10/11/12 三天都能看到该条目，且带 span 元信息
     （span_index=1/2/3，span_total=3，span_start/span_end 恒为整个区间）
  3. PUT 缩成单日 → 只在首日出现，无 span 标记
  4. GET /api/schedule-items/{d}（区间中的一天）→ 跨天条目也应命中
  5. DELETE 清理

用法: python tests/test_schedule_multiday_http.py
"""
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
PORT = 8012
BASE = f"http://127.0.0.1:{PORT}"


def main() -> int:
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", str(PORT), "--log-level", "warning"],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        ready = False
        for _ in range(40):
            time.sleep(0.4)
            try:
                if httpx.get(f"{BASE}/health", timeout=1).is_success:
                    ready = True
                    break
            except Exception:
                pass
        if not ready:
            out = proc.stdout.read().decode("utf-8", "ignore") if proc.stdout else ""
            print("server failed to start:")
            print(out[-2000:])
            return 1
        print(f"[server] ready on :{PORT}")

        item_id = None
        with httpx.Client(base_url=BASE, timeout=10) as c:
            # 1. 创建多日日程 2026-09-10 ~ 2026-09-12
            r = c.post("/api/schedule-items", json={
                "id": None, "date": "2026-09-10", "end_date": "2026-09-12",
                "start_time": "09:00", "end_time": "18:00",
                "title": "HTTP集成测试_多日会议", "color": "#3D6BFB",
                "category": "work", "sort_order": 0,
            })
            assert r.status_code == 200, f"create failed: {r.status_code} {r.text[:300]}"
            saved = r.json()
            item_id = saved["id"]
            assert saved["end_date"] == "2026-09-12", f"end_date not persisted: {saved}"
            print(f"[create] id={item_id} end_date={saved['end_date']}")

            # 2. 月视图：三天都应出现，且 span 元信息正确
            r = c.get("/api/view/month/2026/9")
            assert r.status_code == 200
            days = {d["date"]: d for d in r.json()["days"]}

            def find_on(ds: str):
                return next(
                    (it for it in days[ds]["schedule_items"] if it["id"] == item_id), None
                )

            d10, d11, d12 = find_on("2026-09-10"), find_on("2026-09-11"), find_on("2026-09-12")
            assert d10 and d11 and d12, (
                f"multiday item missing on some day: "
                f"10={bool(d10)} 11={bool(d11)} 12={bool(d12)}"
            )
            for label, it in (("09-10", d10), ("09-11", d11), ("09-12", d12)):
                assert it["is_multi_day"], f"{label}: is_multi_day should be True"
                assert it["span_total"] == 3, f"{label}: span_total 应为 3"
                assert it["span_start"] == "2026-09-10" and it["span_end"] == "2026-09-12"
            assert d10["span_index"] == 1, "首日 span_index 应为 1"
            assert d11["span_index"] == 2, "中间日 span_index 应为 2"
            assert d12["span_index"] == 3, "末日 span_index 应为 3"
            # 展开后的条目在所有天保持同一身份：date 恒为首日（DB 行的真实日期，
            # 编辑/删除按它回写），「今天是第几天」由 span_index 表达
            assert d11["date"] == "2026-09-10" and d11["end_date"] == "2026-09-12"
            print("[month] 09-10/11/12 三天展开 + span 标记全部正确")

            # 2b. 单日日程不受影响：09-15 建一条普通日程，无 span 标记
            r = c.post("/api/schedule-items", json={
                "id": None, "date": "2026-09-15", "end_date": None,
                "start_time": None, "end_time": None,
                "title": "HTTP集成测试_单日", "color": None,
                "category": "other", "sort_order": 0,
            })
            single_id = r.json()["id"]
            r = c.get("/api/view/month/2026/9")
            days = {d["date"]: d for d in r.json()["days"]}
            s15 = next(it for it in days["2026-09-15"]["schedule_items"] if it["id"] == single_id)
            assert not s15.get("is_multi_day") and "span_index" not in s15, "单日日程不应带 span 元信息"
            c.delete(f"/api/schedule-items/{single_id}")
            print("[single-day] 单日日程无 span 标记，行为未变")

            # 3. PUT 缩成单日 → 只在首日出现
            r = c.put(f"/api/schedule-items/{item_id}", json={
                "id": item_id, "date": "2026-09-10", "end_date": None,
                "start_time": "09:00", "end_time": "18:00",
                "title": "HTTP集成测试_多日会议", "color": "#3D6BFB",
                "category": "work", "sort_order": 0,
            })
            assert r.status_code == 200 and r.json()["end_date"] is None
            r = c.get("/api/view/month/2026/9")
            days = {d["date"]: d for d in r.json()["days"]}
            assert find_on("2026-09-10") and not find_on("2026-09-11") and not find_on("2026-09-12")
            print("[shrink] 缩成单日后只在首日出现")

            # 4. 恢复多日，验证按天查询接口对跨天条目也命中（取区间中间一天）
            r = c.put(f"/api/schedule-items/{item_id}", json={
                "id": item_id, "date": "2026-09-10", "end_date": "2026-09-12",
                "start_time": "09:00", "end_time": "18:00",
                "title": "HTTP集成测试_多日会议", "color": "#3D6BFB",
                "category": "work", "sort_order": 0,
            })
            assert r.status_code == 200
            r = c.get("/api/schedule-items/2026-09-11")
            assert r.status_code == 200
            assert any(it["id"] == item_id for it in r.json()), "按天查询未命中跨天条目"
            print("[day-query] 区间中间日按天查询命中跨天条目")

            # 5. 清理
            r = c.delete(f"/api/schedule-items/{item_id}")
            assert r.status_code == 200
            r = c.get("/api/view/month/2026/9")
            days = {d["date"]: d for d in r.json()["days"]}
            assert not any(
                it["id"] == item_id
                for ds in ("2026-09-10", "2026-09-11", "2026-09-12")
                for it in days[ds]["schedule_items"]
            )
            print("[cleanup] 删除后三天均无残留")

        print("ALL HTTP MULTIDAY TESTS PASSED")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
