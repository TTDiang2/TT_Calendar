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
    import os
    import subprocess
    import sys

    # argparse 的 help 文案是中文，Windows runner 的默认控制台编码是 cp1252，
    # 子进程写 stdout 时会 UnicodeEncodeError 直接退出（returncode=1）。
    # 强制子进程走 UTF-8，与开发者本机（cp936 能编码中文，所以本地从不复现）解耦。
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.run(
        [sys.executable, "-m", "backend.main", "--help"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    assert "--port" in proc.stdout
