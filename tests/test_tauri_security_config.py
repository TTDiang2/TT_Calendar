"""Tauri 发布配置的加固约束（防回退）。

三件事都不是"跑起来才知道"的问题，而是编译期/运行期才会暴露、代价极高的：

1. devtools 若留在 tauri 的默认 features 里，release 也带调试器——用户右键即可
   执行任意 JS、读本地数据，前端所有约束形同虚设。
2. csp 为 null 等于没有 CSP。本应用会渲染远端抓来的标题/备注，一旦有 XSS 就没有
   第二道防线。
3. `script-src 'self'` 不含 unsafe-inline，所以产物里出现内联脚本就会白屏。这条
   必须在改构建配置时就拦住，而不是等用户打开应用发现。

完整 tauri build 要编译 Rust，放不进 CI，故直接断言配置与产物的不变量。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TAURI_CONF = ROOT / "frontend" / "src-tauri" / "tauri.conf.json"
CARGO_TOML = ROOT / "frontend" / "src-tauri" / "Cargo.toml"
DIST_INDEX = ROOT / "frontend" / "dist" / "index.html"
PKG_JSON = ROOT / "frontend" / "package.json"


@pytest.fixture(scope="module")
def security() -> dict:
    return json.loads(TAURI_CONF.read_text(encoding="utf-8"))["app"]["security"]


def test_csp_is_not_disabled(security: dict) -> None:
    csp = security.get("csp")
    assert csp, "app.security.csp 为 null/空 = 无 CSP，XSS 将无第二道防线"
    assert isinstance(csp, str)


@pytest.mark.parametrize("directive", [
    "default-src", "script-src", "style-src", "img-src",
    "font-src", "connect-src", "object-src", "base-uri", "frame-ancestors",
])
def test_csp_declares_required_directives(security: dict, directive: str) -> None:
    """漏掉任一指令都会让它退化成 unrestricted。"""
    assert re.search(rf"(^|;)\s*{re.escape(directive)}\s", security["csp"]), \
        f"CSP 缺少 {directive} 指令"


def test_csp_blocks_objects_and_framing(security: dict) -> None:
    """object-src/frame-ancestors 是防插件滥用与点击劫持的两条底线。"""
    csp = security["csp"]
    assert re.search(r"object-src\s+'none'", csp), "object-src 应为 'none'"
    assert re.search(r"frame-ancestors\s+'none'", csp), "frame-ancestors 应为 'none'"


def test_csp_allows_backend_and_ipc(security: dict) -> None:
    """过紧的 CSP 会让应用连不上自己的后端，故反向钉住必需的源。"""
    connect = re.search(r"connect-src([^;]*)", security["csp"]).group(1)
    assert "http://127.0.0.1:8765" in connect, "放行不到本地后端，应用无法工作"
    assert "ipc:" in connect, "放行不到 Tauri IPC，invoke 将失效"


def test_script_src_does_not_allow_unsafe_inline(security: dict) -> None:
    """生产 CSP 放开 unsafe-inline 等于白名单形同虚设。"""
    script_src = re.search(r"script-src([^;]*)", security["csp"]).group(1)
    assert "unsafe-inline" not in script_src
    assert "unsafe-eval" not in script_src


def test_dev_csp_relaxes_for_hmr(security: dict) -> None:
    """开发态要放行 Vite dev server 与 HMR websocket，否则热更新失效。"""
    dev = security.get("devCsp")
    assert dev, "缺 devCsp：严格 CSP 会打断 Vite HMR，开发体验直接坏掉"
    connect = re.search(r"connect-src([^;]*)", dev).group(1)
    assert "ws://localhost:5173" in connect, "devCsp 需放行 HMR websocket"


def test_devtools_not_in_default_tauri_features() -> None:
    """devtools 只能经 [features] opt-in，不能挂在 tauri 默认 features 上。"""
    cargo = CARGO_TOML.read_text(encoding="utf-8")
    dep = re.search(r'^tauri\s*=\s*\{([^}]*)\}', cargo, re.M)
    assert dep, "未找到 tauri 依赖声明"
    assert "devtools" not in dep.group(1), \
        "devtools 不能在 tauri 默认 features 里——release 会带上调试器"
    assert re.search(r"^\[features\]", cargo, re.M), "缺少 [features] 段"
    assert re.search(r'^devtools\s*=\s*\["tauri/devtools"\]', cargo, re.M), \
        "devtools 应作为 opt-in feature 存在，供开发期显式启用"


def test_dev_script_enables_devtools() -> None:
    """开发要用调试器，就得有个显式带上该 feature 的脚本。"""
    pkg = json.loads(PKG_JSON.read_text(encoding="utf-8"))
    script = pkg["scripts"].get("tauri:dev", "")
    assert "--features devtools" in script, \
        "缺 tauri:dev 脚本，开发期将无法启用调试器（default 已移除）"


def test_built_html_has_no_inline_script() -> None:
    """产物若含内联脚本，`script-src 'self'` 会让它直接白屏。"""
    if not DIST_INDEX.exists():
        pytest.skip("尚未构建 frontend（dist/index.html 不存在）")
    html = DIST_INDEX.read_text(encoding="utf-8")
    inline = re.findall(r"<script(?![^>]*\ssrc=)[^>]*>", html)
    assert not inline, f"产物含内联脚本，会被 CSP 拦成白屏：{inline}"
    assert not re.findall(r"\son[a-z]+\s*=", html), \
        "产物含内联事件处理器，会被 CSP 拦截"
