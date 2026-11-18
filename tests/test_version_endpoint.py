"""构建版本端点与动态端口参数。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend import main as backend_main


def test_version_endpoint_returns_metadata():
    client = TestClient(backend_main.app)
    r = client.get("/api/version")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["version"], str) and body["version"]
    assert body["frozen"] is False
    assert body["data_dir"]
    assert body["plugins_dir"]


def test_main_accepts_port_argument():
    import subprocess
    import sys

    proc = subprocess.run(
        [sys.executable, "-m", "backend.main", "--help"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0
    assert "--port" in proc.stdout
