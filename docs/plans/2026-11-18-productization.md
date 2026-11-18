# TT Calendar 产品化（安装包 + 可分发产品）实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把当前的便携三 exe 形态，做成一个可安装、可升级、数据不丢、插件可自助安装的 Windows 桌面产品，产出 `TT-Calendar-Setup-x.y.z.exe`。

**Architecture:** 取消 launcher 作为必需入口，改由 Tauri 主进程负责「选端口 → 拉起后端 → 用 Job Object 绑定生命周期」。后端由 onefile 改为 onedir，作为 `bundle.resources` 随安装包进入 `resources/backend/`。数据从 exe 旁迁到 `%LOCALAPPDATA%\TT Calendar\`，插件单独放 `%APPDATA%\TT Calendar\plugins\`（与安装目录解耦，永远可写、升级不覆盖）。更新走 `tauri-plugin-updater` + GitHub Releases。

**Tech Stack:** Tauri 2 / Rust（windows-sys）/ FastAPI / PyInstaller onedir / NSIS / GitHub Actions。

**Baseline:** 开工前打 tag `checkpoint/pre-productization-20261118`，不覆盖 `release/` 直到最后一次验收。

**不触碰:** `frontend/eslint.config.js`、`docs/DIALOG_A11Y.md`、`frontend/scripts/diff-shots.mjs`、`frontend/scripts/visual-probe.mjs`。

---

## 关键决策（已定）

| 决策 | 结论 | 理由 |
|---|---|---|
| 入口 | `TT Calendar.exe` 单入口 | launcher 保留源码但不再随包分发；少一个用户会点错的 exe |
| 后端形态 | PyInstaller **onedir** | onefile 每次启动解压 %TEMP%，实测 5–7s；onedir 约 1–2s |
| 后端位置 | `<install>\resources\backend\tt-calendar-backend.exe` | `bundle.resources` 可整目录拷贝，卸载自动清理 |
| 数据目录 | `%APPDATA%\TT Calendar\data` | 与安装目录分离，卸载不会误删 |
| 插件目录 | `%APPDATA%\TT Calendar\plugins` | Roaming 语义更符合「用户自己的东西」；卸载不删 |
| 备份目录 | `%APPDATA%\TT Calendar\backups` | 与数据同盘，SQLite backup API 可用 |
| 端口 | 8765–8785 顺序探测 | CSP 放行 `http://127.0.0.1:*`；避免双开/被占 |
| 单实例 | `tauri-plugin-single-instance` | 第二次启动只聚焦已有窗口 |
| 安装范围 | NSIS `currentUser` | 不需要管理员权限，插件/日志目录永远可写 |
| 更新 | GitHub Releases `latest.json` | 主仓库已公开，已有 v2.3.0 Release |
| 插件源 | `TT_Calendar_Plugins/registry.json` | 已有 sha256 + protocol_version，可直接校验 |

---

## Phase 0：基线

### Task 0: 打基线 tag

**Step 1:** 关闭正在运行的预览进程（先问用户或确认无未保存操作）

```powershell
taskkill /F /IM "TT Calendar.exe" 2>$null
taskkill /F /IM "TT-Calendar-Launcher.exe" 2>$null
taskkill /F /IM tt-calendar-backend.exe 2>$null
```

**Step 2:** 打 tag 并确认工作区干净

```bash
git tag checkpoint/pre-productization-20261118
git status --short
```

Expected: 仅 `?? docs/DIALOG_A11Y.md`。

---

## Phase 1：运行时收口

### Task 1: 统一路径解析（`tt_calendar/paths.py`）

**Files:**
- Create: `tt_calendar/paths.py`
- Create: `tests/test_paths.py`
- Modify: `tt_calendar/config.py:16-36`

**Step 1: 写失败测试**

```python
# tests/test_paths.py
import os, sys
from pathlib import Path
from tt_calendar import paths


def test_home_from_env(monkeypatch, tmp_path):
    monkeypatch.setenv("TT_CALENDAR_HOME", str(tmp_path))
    assert paths.resolve_home() == tmp_path


def test_dev_home_is_repo_root(monkeypatch):
    monkeypatch.delenv("TT_CALENDAR_HOME", raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    assert paths.resolve_home() == paths.PROJECT_ROOT


def test_windows_home_uses_appdata(monkeypatch, tmp_path):
    monkeypatch.delenv("TT_CALENDAR_HOME", raising=False)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setenv("APPDATA", str(tmp_path))
    assert paths.resolve_home() == tmp_path / "TT Calendar"
```

**Step 2:** `pytest tests/test_paths.py -q` → FAIL（模块不存在）

**Step 3: 实现**

```python
# tt_calendar/paths.py
"""数据/插件/备份目录解析。

优先级：TT_CALENDAR_HOME > 平台目录（打包） > 仓库根（源码）。
开发模式故意继续写仓库 data/，保持现有测试与调试路径不变。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Final

APP_NAME: Final[str] = "TT Calendar"

if getattr(sys, "frozen", False):
    PROJECT_ROOT: Final[Path] = Path(sys.executable).resolve().parent
else:
    PROJECT_ROOT: Final[Path] = Path(__file__).resolve().parent.parent


def resolve_home() -> Path:
    env = os.environ.get("TT_CALENDAR_HOME")
    if env:
        return Path(env).expanduser().resolve()
    if getattr(sys, "frozen", False):
        base = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
        if base:
            return Path(base) / APP_NAME
        return Path.home() / ".tt-calendar"
    return PROJECT_ROOT


def resolve_plugins_dir(home: Path) -> Path:
    """打包态放 Roaming；开发态放仓库 plugins/（当前行为）。"""
    env = os.environ.get("TT_CALENDAR_PLUGINS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    if getattr(sys, "frozen", False):
        base = os.environ.get("APPDATA") or str(home)
        return Path(base) / APP_NAME / "plugins"
    return home / "plugins"


HOME: Final[Path] = resolve_home()
DATA_DIR: Final[Path] = HOME / "data"
BACKUP_DIR: Final[Path] = HOME / "backups"
PLUGINS_DIR: Final[Path] = resolve_plugins_dir(HOME)

for _d in (HOME, DATA_DIR, BACKUP_DIR, PLUGINS_DIR):
    try:
        _d.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
```

**Step 4:** `config.py` 改为从 `paths` 取常量，保留 `PROJECT_ROOT` 别名与所有既有名字：

```python
from .paths import HOME, DATA_DIR, BACKUP_DIR, PLUGINS_DIR, PROJECT_ROOT
```

删除原来 18–36 行的路径推导。`LEGACY_*_JSON` 继续指向 `PROJECT_ROOT`。

**Step 5:** `pytest tests/test_paths.py -q` → PASS；`pytest tests -q` → PASS

**Step 6:** commit `refactor(paths): 统一数据/插件/备份目录解析`

---

### Task 2: 旧数据自动迁移

**Files:**
- Create: `tt_calendar/migrate.py`
- Create: `tests/test_migrate.py`
- Modify: `backend/main.py:70-83`

**Step 1: 失败测试**

```python
def test_copies_legacy_db_once(tmp_path, monkeypatch):
    legacy = tmp_path / "legacy" / "data"
    legacy.mkdir(parents=True)
    (legacy / "calendar.db").write_bytes(b"SQLite format 3\x00" + b"\x00" * 100)
    home = tmp_path / "home"
    (home / "data").mkdir(parents=True)
    monkeypatch.setattr(migrate, "PROJECT_ROOT", legacy.parent)
    assert migrate.import_legacy_data(home) is True
    assert (home / "data" / "calendar.db").read_bytes()[:15] == b"SQLite format 3\x00"
    assert migrate.import_legacy_data(home) is False  # 已有库不覆盖
```

**Step 2:** FAIL

**Step 3: 实现**

```python
def import_legacy_data(home: Path) -> bool:
    """把便携版 exe 旁的 data/ 复制到新 HOME。仅在目标库不存在时执行。"""
    target = home / "data" / "calendar.db"
    if target.exists():
        return False
    for candidate in (PROJECT_ROOT / "data" / "calendar.db",
                      PROJECT_ROOT.parent / "data" / "calendar.db"):
        if candidate.is_file() and candidate.resolve() != target.resolve():
            shutil.copy2(candidate, target)
            for name in ("user_config.json",):
                src = candidate.parent / name
                if src.is_file():
                    shutil.copy2(src, home / "data" / name)
            return True
    return False
```

**Step 4:** 在 `lifespan` 连接 DB **之前** 调用：

```python
from tt_calendar import migrate
if migrate.import_legacy_data(cfg.HOME):
    logger.info("已从便携版 data/ 导入历史数据")
```

**Step 5:** 测试通过，commit `feat(data): 首次启动自动导入便携版数据`

---

### Task 3: 后端支持动态端口与版本端点

**Files:**
- Modify: `backend/main.py:212-215`
- Modify: `backend/routes.py`（新增 `/version`）
- Create: `tt_calendar/_build_version.py`（生成文件，入 gitignore）
- Create: `tests/test_version_endpoint.py`

**Step 1:** `__main__` 改为：

```python
if __name__ == "__main__":
    import argparse
    import uvicorn

    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=int(os.environ.get("TT_CALENDAR_PORT", "8765")))
    args = p.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")
```

**Step 2:** routes 增加：

```python
@router.get("/version")
def version_api():
    try:
        from tt_calendar._build_version import __version__
    except ImportError:
        __version__ = "dev"
    return {"version": __version__, "frozen": bool(getattr(sys, "frozen", False))}
```

**Step 3:** 测试 `GET /api/version` 返回 `version` 字段。

**Step 4:** commit `feat(api): 支持 --port 与版本端点`

---

### Task 4: 后端改 onedir

**Files:**
- Modify: `tt-calendar-backend.spec`

**Step 1:** 去掉 `frontend/dist`（Tauri 模式不需要；Pake 模式另行处理），改为：

```python
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='tt-calendar-backend',
          console=True, upx=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=True,
               name='tt-calendar-backend')
```

**Step 2:** 构建验证

```powershell
python -m PyInstaller --noconfirm --clean tt-calendar-backend.spec
```

Expected: `dist/tt-calendar-backend/tt-calendar-backend.exe` 存在；启动后 `/health` 在 2 秒内返回。

**Step 3:** commit `build(backend): onefile 改 onedir，启动时间从 5-7s 降到 1-2s`

---

## Phase 2：Tauri 接管后端

### Task 5: Rust 侧拉起后端 + 单实例 + Job Object

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `frontend/src-tauri/src/lib.rs`
- Modify: `frontend/src-tauri/tauri.conf.json`

**Step 1:** 依赖

```toml
tauri-plugin-single-instance = "2"
windows-sys = { version = "0.59", features = [
  "Win32_Foundation",
  "Win32_System_JobObjects",
  "Win32_System_Threading",
] }
```

**Step 2:** `lib.rs` 结构（关键代码）

```rust
struct BackendState {
    base_url: String,
    job: isize,
    child: std::sync::Mutex<Option<std::process::Child>>,
}

fn free_port() -> u16 {
    for p in 8765..=8785 {
        if std::net::TcpListener::bind(("127.0.0.1", p)).is_ok() { return p; }
    }
    8765
}

fn backend_exe(app: &tauri::AppHandle) -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let mut c = Vec::new();
    if let Ok(r) = app.path().resource_dir() { c.push(r.join("backend/tt-calendar-backend.exe")); }
    c.push(exe_dir.join("backend/tt-calendar-backend.exe"));
    c.push(exe_dir.join("tt-calendar-backend.exe"));
    c.into_iter().find(|p| p.is_file())
}

#[tauri::command]
fn backend_base_url(s: tauri::State<'_, BackendState>) -> String { s.base_url.clone() }

#[tauri::command]
fn restart_app(app: tauri::AppHandle) { app.restart(); }

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _a, _c| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![backend_base_url, restart_app])
        .setup(|app| {
            let port = free_port();
            let home = app.path().app_local_data_dir()?.join("TT Calendar");
            std::fs::create_dir_all(&home)?;
            let plugins = app.path().app_data_dir()?.join("TT Calendar").join("plugins");
            std::fs::create_dir_all(&plugins)?;

            if let Some(exe) = backend_exe(&app.handle()) {
                let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
                // JOBOBJECT_EXTENDED_LIMIT_INFORMATION + KILL_ON_JOB_CLOSE，逻辑照抄 launcher/src/main.rs
                let mut cmd = std::process::Command::new(exe);
                cmd.args(["--port", &port.to_string()])
                   .env("TT_CALENDAR_HOME", &home)
                   .env("TT_CALENDAR_PLUGINS_DIR", &plugins)
                   .creation_flags(0x0800_0000); // CREATE_NO_WINDOW
                let child = cmd.spawn()?;
                // AssignProcessToJobObject(job, child.as_raw_handle())
                app.manage(BackendState {
                    base_url: format!("http://127.0.0.1:{port}"),
                    job, child: std::sync::Mutex::new(Some(child)),
                });
            } else {
                // 开发模式：外部 uvicorn
                app.manage(BackendState { base_url: "http://localhost:8000".into(), job: 0, child: Default::default() });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(s) = app.try_state::<BackendState>() {
                    if s.job != 0 { unsafe { TerminateJobObject(s.job as HANDLE, 0) }; }
                }
            }
        });
}
```

**Step 3:** 单实例注册必须放在第一个 `.plugin()`，否则第二个实例会先拉起后端。

**Step 4:** `cargo build` 通过；`cargo clippy` 无 error。

**Step 5:** commit `feat(tauri): 主进程接管后端生命周期，单实例 + Job Object`

---

### Task 6: 前端动态发现后端地址

**Files:**
- Modify: `frontend/src/api/client.ts:1-46,232`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src-tauri/tauri.conf.json`（CSP）
- Create: `frontend/src/boot.ts`

**Step 1:** `client.ts` 改为

```ts
let API_BASE = import.meta.env.PROD ? 'http://127.0.0.1:8765' : 'http://localhost:8000'
export const getApiBase = () => API_BASE

export async function initApiBase(): Promise<void> {
  if (!import.meta.env.PROD) return
  try {
    const core = await import('@tauri-apps/api/core')
    if (!core.isTauri()) return
    API_BASE = await core.invoke<string>('backend_base_url')
  } catch { /* 保留默认，交给 waitForBackend 报错 */ }
}

export async function waitForBackend(timeoutMs = 45_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(`${API_BASE}/health`)).ok) return true } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}
```

把所有模板字符串里的 `${API_BASE}` 替换为 `${getApiBase()}`。删除末尾 `export { API_BASE }`，改为 `export { getApiBase }`；grep 全仓确认无其他 import。

**Step 2:** `main.tsx` 改为异步 bootstrap，先渲染静态启动页（`index.html` 里已有 `#boot` 可选），失败时渲染错误页并显示日志路径。

**Step 3:** CSP 的 `connect-src` 改为 `... http://127.0.0.1:*`（同时更新 `devCsp`）。

**Step 4:** `npm run typecheck && npm test -- --run` → PASS

**Step 5:** commit `feat(frontend): 动态发现后端端口，启动页等待 /health`

---

### Task 7: 打包配置

**Files:**
- Modify: `frontend/src-tauri/tauri.conf.json`

**Step 1:** bundle 段改为

```json
"bundle": {
  "active": true,
  "targets": ["nsis", "msi"],
  "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.ico"],
  "resources": { "../../dist/tt-calendar-backend/": "backend/" },
  "windows": {
    "webviewInstallMode": { "type": "downloadBootstrapper", "silent": true },
    "nsis": {
      "installMode": "currentUser",
      "languages": ["SimpChinese", "English"],
      "displayLanguageSelector": false
    }
  }
}
```

**Step 2:** 移除 `externalBin: []`、`resources: []` 旧字段；确认 `bundle.resources` 的相对路径从 `src-tauri` 出发是 `../../dist/...`。

**Step 3:** `npx tauri build --no-bundle` 通过，且 `target/release/resources/backend/tt-calendar-backend.exe` 存在。

**Step 4:** commit `build(bundle): 后端整目录进包，NSIS currentUser + WebView2 bootstrapper`

---

### Task 8: 版本号单一来源

**Files:**
- Create: `version.json`
- Create: `scripts/sync_version.py`
- Modify: `.gitignore`
- Create: `tests/test_version_sync.py`

**Step 1:** `version.json` → `{"version": "2.4.0"}`

**Step 2:** 脚本读取并写回：

- `frontend/src-tauri/tauri.conf.json` → `version`
- `frontend/src-tauri/Cargo.toml` → `[package] version`
- `frontend/package.json` → `version`
- `tt_calendar/_build_version.py` → `__version__ = "2.4.0"`

**Step 3:** `_build_version.py` 加入 `.gitignore`。

**Step 4:** 测试：跑两次脚本结果幂等；版本非法（`2.4`）抛错。

**Step 5:** commit `build(version): 单一版本源 + 同步脚本`

---

### Task 9: 一键出包脚本

**Files:**
- Rewrite: `build_release.bat`
- Create: `scripts/make_portable_zip.ps1`

**Step 1:** 流程

```
[0] 杀进程
[1] python scripts/sync_version.py
[2] npm run build
[3] python -m PyInstaller --noconfirm --clean tt-calendar-backend.spec
[4] npx tauri build            (msi + nsis，自动带 resources)
[5] 收集:
    frontend/src-tauri/target/release/bundle/nsis/*-setup.exe -> release/TT-Calendar-Setup-<ver>.exe
    frontend/src-tauri/target/release/bundle/msi/*.msi        -> release/TT-Calendar-<ver>.msi
[6] portable zip:
    target/release/app.exe -> TT Calendar.exe
    dist/tt-calendar-backend/ -> backend/
    Compress-Archive -> release/TT-Calendar-Portable-<ver>.zip
[7] 打印 SHA256
```

**Step 2:** 保留 `--no-bundle` 快速预览分支（`build_release.bat preview`）。

**Step 3:** 实测出包，确认 setup.exe 体积 > 20MB（含后端）。

**Step 4:** commit `build(release): 一条命令产出 setup.exe / msi / portable zip`

---

## Phase 3：数据安全

### Task 10: 每日自动备份

**Files:**
- Create: `tt_calendar/backup.py`
- Create: `tests/test_backup.py`
- Modify: `backend/main.py` lifespan
- Modify: `backend/routes.py`

**Step 1:** 实现

```python
def daily_backup(conn, backup_dir: Path, keep: int = 14) -> Path | None:
    dest = backup_dir / f"calendar-{date.today():%Y%m%d}.db"
    if dest.exists():
        return None
    tmp = dest.with_suffix(".tmp")
    with sqlite3.connect(tmp) as b:
        conn.backup(b)
    tmp.replace(dest)
    for old in sorted(backup_dir.glob("calendar-*.db"))[:-keep]:
        old.unlink(missing_ok=True)
    return dest
```

**Step 2:** lifespan 在迁移后调用，异常只记日志不阻断启动。

**Step 3:** 端点 `GET /api/backups` 返回 `[{name,size,mtime}]`；`POST /api/backups/now` 立即备份。

**Step 4:** 测试：同一天只生成一份；超过 keep 删除最旧；备份可被 sqlite 打开。

**Step 5:** commit `feat(data): 每日 SQLite 热备份，保留 14 天`

---

### Task 11: 首次启动引导 + 导入旧库

**Files:**
- Create: `backend/onboarding.py`
- Create: `frontend/src/components/OnboardingGate.tsx`
- Modify: `backend/routes.py`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/i18n/*`

**Step 1:** 后端

```
GET  /api/onboarding/status  -> {first_run, data_dir, plugins_dir, version}
POST /api/onboarding/complete
POST /api/onboarding/import  (multipart db)
```

- `first_run` = `HOME/.initialized` 不存在。
- import：校验文件头 `SQLite format 3\0`、能打开、含 `events` 表；写 `HOME/data/import-pending.db`；返回 `{ok:true}`。
- 启动时若存在 `import-pending.db`：先把当前库备份到 `backups/pre-import-*.db`，再替换，删除 pending 与 `.initialized`（强制重新走引导确认）。

**Step 2:** 前端引导页：应用名 + 两个按钮「开始使用」「导入旧数据」；导入用 `<input type="file" accept=".db">`，上传成功后 `invoke('restart_app')`。

**Step 3:** 引导完成后才渲染 `AppGate`。

**Step 4:** 测试：首次 status=true；complete 后 false；import 非 sqlite 返回 400。

**Step 5:** commit `feat(onboarding): 首次启动引导与旧数据导入`

---

### Task 12: 诊断包

**Files:**
- Create: `backend/diagnostics.py`
- Create: `tests/test_diagnostics.py`
- Modify: `backend/routes.py`
- Modify: `frontend/src/components/SettingsDialog.tsx`

**Step 1:** `POST /api/diagnostics/export` 生成 zip：

```
version.json
system.json      (OS、Python、frozen、数据目录、DB 大小、各表行数)
backend.log / backend.log.1..3
launcher.log     (若存在)
```

**Step 2:** 明确不含 `calendar.db`、`user_config.json`（可能含 token）。

**Step 3:** 前端设置页加「导出诊断包」按钮，成功后显示路径 + 复制按钮。

**Step 4:** commit `feat(diagnostics): 一键导出脱敏诊断包`

---

## Phase 4：插件一键安装

### Task 13: 后端插件管理 API

**Files:**
- Create: `backend/plugins_api.py`
- Create: `tests/test_plugins_api.py`
- Modify: `backend/routes.py`
- Modify: `tt_calendar/sources/__init__.py`（暴露 `reload_plugins()`）

**Step 1:** 注册表拉取

```python
REGISTRY_URL = "https://raw.githubusercontent.com/TTDiang2/TT_Calendar_Plugins/main/registry.json"
CACHE = cfg.DATA_DIR / "plugin_registry.json"
TTL = 6 * 3600
```

网络失败时回退缓存；两者都没有则返回 `{error: "offline"}`，前端提示手动安装。

**Step 2:** 端点

```
GET    /api/plugins                -> 合并 registry + 本地文件状态
POST   /api/plugins/install        -> {source_id}
DELETE /api/plugins/{source_id}
POST   /api/plugins/reload
```

状态字段：`installed`、`installed_sha`、`update_available`、`local_modified`、`size`、`layer_count`。

**Step 3:** 安装校验（硬性）

1. `url` 必须 `https://` 且以 `https://raw.githubusercontent.com/TTDiang2/TT_Calendar_Plugins/` 开头；
2. `sha256` 必须匹配下载内容；
3. `size <= 2MB`；
4. 文件名匹配 `^[a-z0-9_]+\.py$`；
5. 写入临时文件 → `importlib` 加载 → 必须出现 `source_id` 等于 registry 声明 → 才 `replace()` 到插件目录；
6. 任何一步失败删除临时文件并返回 400。

**Step 4:** 卸载只允许删除「registry 中声明过」的 `file`，路径必须落在 `PLUGINS_DIR` 内。

**Step 5:** `reload_plugins()` 置 `_PLUGINS = None` 并重新扫描，返回新的 `source_id` 列表；前端无需重启。

**Step 6:** 测试用 `httpx.MockTransport` 注入假 registry 与假插件字节，覆盖：sha 不匹配、协议不兼容、路径穿越、重复 source_id。

**Step 7:** commit `feat(plugins): 注册表拉取、校验安装、卸载与热重载`

---

### Task 14: 插件管理界面

**Files:**
- Create: `frontend/src/components/PluginManager.tsx`
- Modify: `frontend/src/components/SettingsDialog.tsx`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/i18n/zh.ts` / `en.ts`

**Step 1:** 设置页新增「插件」区块入口，打开 `PluginManager` 弹窗。

**Step 2:** 列表分组：已安装 / 可安装 / 可更新。每项显示名称、作者/来源、大小、图层数。

**Step 3:** 首次安装前弹确认框：

> 插件是 Python 代码，安装后会以与本应用相同的权限在本机运行，可读取本机数据与网络。只安装你信任的来源。

**Step 4:** 操作按钮：安装 / 更新 / 卸载 / 重新加载；失败显示后端 `detail`。

**Step 5:** 底部「打开插件目录」——用 `@tauri-apps/plugin-opener` 的 `revealItemInDir`，dev 模式降级为显示路径。

**Step 6:** vitest 覆盖：mock API 后渲染列表、点击安装调用正确端点、卸载二次确认。

**Step 7:** commit `feat(plugins): 设置页插件管理器`

---

## Phase 5：更新与分发

### Task 15: 自动更新

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `frontend/src-tauri/src/lib.rs`
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `frontend/src-tauri/capabilities/default.json`
- Create: `frontend/src/components/UpdateChecker.tsx`
- Create: `scripts/gen_latest_json.py`

**Step 1:** 依赖 `tauri-plugin-updater = "2"`、`tauri-plugin-opener = "2"`、`tauri-plugin-process = "2"`；JS 侧 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`、`@tauri-apps/plugin-opener`。

**Step 2:** `tauri.conf.json`

```json
"plugins": {
  "updater": {
    "endpoints": ["https://github.com/TTDiang2/TT_Calendar/releases/latest/download/latest.json"],
    "pubkey": "<由 tauri signer generate 生成>"
  }
},
"bundle": { "createUpdaterArtifacts": true }
```

**Step 3:** 生成密钥对

```powershell
npx tauri signer generate -w .keys/tt-calendar.key
```

私钥写入 `.keys/`（加入 `.gitignore`），并提示用户备份；CI 用 secret `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

**Step 4:** `gen_latest_json.py` 读取 `bundle/nsis/*.nsis.zip.sig` 与版本号，输出：

```json
{"version":"2.4.0","notes":"...","pub_date":"...","platforms":{"windows-x86_64":{"signature":"...","url":"https://github.com/.../TT-Calendar-Setup-2.4.0.exe"}}}
```

**Step 5:** 设置页「检查更新」按钮：发现新版本显示版本号与说明，确认后 `downloadAndInstall()` → `relaunch()`。

**Step 6:** capabilities 增加 `updater:default`、`process:allow-restart`、`opener:default`。

**Step 7:** commit `feat(update): 自动更新检查与安装`

---

### Task 16: GitHub Actions 出包

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1:** 触发：`push: tags: ['v*']` 与 `workflow_dispatch`。

**Step 2:** windows-latest 步骤：checkout → setup python 3.10 / node 24 / rust stable → `pip install -r requirements.txt` → `npm ci` → `python scripts/sync_version.py` → PyInstaller → `npx tauri build` →（可选）signtool → 生成 `latest.json` → `gh release create` 上传 setup/msi/latest.json/portable zip。

**Step 3:** 代码签名走条件步骤：仅当 `secrets.WINDOWS_CERT_PFX_BASE64` 存在时执行；否则跳过并在 job summary 里写明「未签名，SmartScreen 会告警」。

**Step 4:** 缓存 cargo 与 npm。

**Step 5:** commit `ci(release): tag 触发构建并发布安装包`

---

### Task 17: 文档

**Files:**
- Create: `docs/RELEASE.md`
- Modify: `README.md` / `README.zh-CN.md`
- Modify: `docs/MIGRATION_PLAN.md`
- Modify: `docs/DEV_ENVIRONMENT.md`

**Step 1:** `RELEASE.md` 写清：版本号怎么改、密钥怎么生成与备份、本地出包、CI 出包、签名证书放哪、回滚方式。

**Step 2:** README 安装段改成「下载 `TT-Calendar-Setup-x.y.z.exe`，双击安装」，便携版作为备选。

**Step 3:** `MIGRATION_PLAN.md` 把已完成项打勾，并记录实际落地路径（`%LOCALAPPDATA%` / `%APPDATA%`）。

**Step 4:** commit `docs(release): 发布、签名与升级手册`

---

## Phase 6：验收

### Task 18: 端到端验收

**Step 1:** 本机安装

```powershell
Start-Process release/TT-Calendar-Setup-2.4.0.exe -ArgumentList "/S"
```

Expected: 安装到 `%LOCALAPPDATA%\TT Calendar`；开始菜单与桌面快捷方式指向 `TT Calendar.exe`。

**Step 2:** 功能冒烟

- 启动 ≤ 3s 出现界面（onedir）
- 建一条日程 → 重启仍在
- 设置页安装 `investing` 插件 → 图层出现
- 卸载插件 → 图层消失
- 导出诊断包 → zip 可打开
- 检查更新 → 无新版本时提示「已是最新」

**Step 3:** 升级验证

装 2.4.0 → 造一条数据 → 装 2.4.1 → 数据仍在、插件仍在。

**Step 4:** 卸载验证

```powershell
& "$env:LOCALAPPDATA\TT Calendar\uninstall.exe" /S
```

Expected: 安装目录删除；`%APPDATA%\TT Calendar\data` 与 `%APPDATA%\TT Calendar\plugins` 保留；重装后数据自动被读取。

**Step 5:** 后端测试、前端测试、lint、typecheck 全绿。

**Step 6:** 更新 `release/` 产物并打 tag `checkpoint/productization-20261118`。

---

## 风险与依赖（需要用户提供）

| 项 | 影响 | 谁提供 |
|---|---|---|
| 代码签名证书（PFX / 云签名） | 不签则 SmartScreen 首次运行告警 | 用户 |
| 更新签名私钥密码 | 丢失则无法发布可被旧版本信任的更新 | 用户保管 |
| GitHub Release 发布权限 | CI 出包需要 `GITHUB_TOKEN`（默认有） | 仓库设置 |
| 干净 Windows 虚拟机 | 最终验收（无 Python / 无 WebView2） | 用户 |

## 明确不做

- macOS / Linux 打包
- 插件市场评分、评论、自动更新
- 多用户/多设备同步改造
- 安装包内自定义卸载问卷
