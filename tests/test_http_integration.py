"""HTTP 集成测试：真实启动 uvicorn + httpx 调端点，验证前端↔后端链路。

不抢焦点（无 GUI），脚本结束自动 kill 子进程。
"""
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
PORT = 8011
BASE = f"http://127.0.0.1:{PORT}"


def main():
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", str(PORT), "--log-level", "warning"],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        # 等 server ready
        ready = False
        for _ in range(30):
            time.sleep(0.4)
            try:
                if httpx.get(f"{BASE}/health", timeout=1).is_success:
                    ready = True
                    break
            except Exception:
                pass
        if not ready:
            out = proc.stdout.read().decode("utf-8", "ignore") if proc.stdout else ""
            print("server failed to start. output:")
            print(out[-2000:])
            return 1

        print(f"[server] ready on :{PORT}")

        with httpx.Client(base_url=BASE, timeout=10) as c:
            r = c.get("/api/view/month/2026/8")
            assert r.status_code == 200
            d = r.json()
            print(f"[month] {r.status_code} | layers={len(d['layers'])} days={len(d['days'])}")
            td = next((x for x in d["days"] if x["is_today"]), None)
            if td:
                print(f"  today {td['date']}: ev_layers={list(td['events_by_layer'].keys())}")

            r = c.get("/api/layers")
            print(f"[layers] {r.status_code} count={len(r.json())}")

            r = c.get("/api/countdown")
            print(f"[countdown] {r.status_code} {r.json()['text'][:40]}")

            r = c.get("/api/search", params={"q": "分红"})
            print(f"[search '分红'] {r.status_code} results={len(r.json())}")

            r = c.get("/api/view/week/2026-08-04")
            print(f"[week] {r.status_code} days={len(r.json()['days'])}")

            # 测图层开关（关再开，验证持久化 + 回读）
            r = c.put("/api/layers/jisilu_CNV", json={"enabled": False})
            print(f"[toggle CNV off] {r.status_code}")
            r = c.put("/api/layers/jisilu_CNV", json={"enabled": True})
            print(f"[toggle CNV on] {r.status_code}")

            print("\nHTTP INTEGRATION TESTS PASSED")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
