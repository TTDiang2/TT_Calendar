// TT Calendar Tauri 壳：负责拉起后端、选择空闲端口、并用 Job Object 绑定生命周期。
//
// 设计要点：
// - 打包态（release）由本进程 spawn `resources/backend/tt-calendar-backend.exe`；
//   开发态（debug）继续连本地 `uvicorn backend.main:app --port 8000`。
// - 端口在 8765..=8785 里挑一个能绑上的，通过 `--port` 传给后端，前端再经
//   `backend_base_url` 命令拿到完整地址。这样双开、端口被占都不会白屏。
// - 后端放进 Job Object 并设 KILL_ON_JOB_CLOSE：界面进程无论正常退出还是崩溃，
//   后端都会被一起回收，不会留下孤儿进程占着数据库。
#![cfg_attr(mobile, tauri::mobile_entry_point)]

use std::net::TcpListener;
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::Mutex;

use tauri::Manager;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DEV_BASE_URL: &str = "http://localhost:8000";

struct BackendState {
    base_url: String,
    /// Job Object 句柄；0 表示创建失败或开发模式。
    job: isize,
    /// 持有 Child 只为了不让它被 drop 后变成僵尸进程。
    #[allow(dead_code)]
    child: Mutex<Option<Child>>,
}

fn app_home() -> PathBuf {
    if let Ok(home) = std::env::var("TT_CALENDAR_HOME") {
        if !home.is_empty() {
            return PathBuf::from(home);
        }
    }
    match std::env::var("APPDATA") {
        Ok(base) => PathBuf::from(base).join("TT Calendar"),
        Err(_) => PathBuf::from(".tt-calendar"),
    }
}

/// 与 tt_calendar/paths.py 的 resolve_plugins_dir 保持一致：放 Roaming。
fn plugins_home() -> PathBuf {
    if let Ok(dir) = std::env::var("TT_CALENDAR_PLUGINS_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    match std::env::var("APPDATA") {
        Ok(base) => PathBuf::from(base).join("TT Calendar").join("plugins"),
        Err(_) => app_home().join("plugins"),
    }
}

fn pick_port() -> u16 {
    for port in 8765..=8785u16 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    // 全被占也不至于让配置为空；后端启动失败时前端会显示明确错误。
    8765
}

fn resolve_backend(app: &tauri::AppHandle) -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))?;
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("backend").join("tt-calendar-backend.exe"));
    }
    candidates.push(exe_dir.join("backend").join("tt-calendar-backend.exe"));
    // 兼容旧便携包：后端与界面平铺在同一目录
    candidates.push(exe_dir.join("tt-calendar-backend.exe"));
    candidates.into_iter().find(|p| p.is_file())
}

fn create_job() -> isize {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            log::warn!("CreateJobObjectW failed");
            return 0;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            std::ptr::addr_of_mut!(info) as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            log::warn!("SetInformationJobObject failed");
        }
        job as isize
    }
}

fn spawn_backend(
    exe: &Path,
    port: u16,
    home: &Path,
    plugins: &Path,
    job: isize,
) -> std::io::Result<Child> {
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--port")
        .arg(port.to_string())
        .env("TT_CALENDAR_HOME", home)
        .env("TT_CALENDAR_PLUGINS_DIR", plugins)
        .env("TT_CALENDAR_PORT", port.to_string())
        .current_dir(exe.parent().unwrap_or_else(|| Path::new(".")))
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    let child = cmd.spawn()?;
    if job != 0 {
        let ok = unsafe { AssignProcessToJobObject(job as HANDLE, child.as_raw_handle() as _) };
        if ok == 0 {
            log::warn!("AssignProcessToJobObject failed");
        }
    }
    Ok(child)
}

#[tauri::command]
fn backend_base_url(state: tauri::State<'_, BackendState>) -> String {
    state.base_url.clone()
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

pub fn run() {
    tauri::Builder::default()
        // 必须第一个注册：第二实例在 setup 之前就退出，避免重复拉起后端。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![backend_base_url, restart_app])
        .setup(|app| {
            let home = app_home();
            let plugins = plugins_home();
            let _ = std::fs::create_dir_all(&home);
            let _ = std::fs::create_dir_all(&plugins);

            let (base_url, job, child) = if cfg!(debug_assertions) {
                (DEV_BASE_URL.to_string(), 0, None)
            } else {
                match resolve_backend(&app.handle()) {
                    Some(exe) => {
                        let port = pick_port();
                        let job = create_job();
                        match spawn_backend(&exe, port, &home, &plugins, job) {
                            Ok(child) => {
                                log::info!("backend spawned on port {port}: {}", exe.display());
                                (format!("http://127.0.0.1:{port}"), job, Some(child))
                            }
                            Err(e) => {
                                log::error!("backend spawn failed: {e}");
                                (format!("http://127.0.0.1:{port}"), job, None)
                            }
                        }
                    }
                    None => {
                        log::error!("backend executable not found");
                        (DEV_BASE_URL.to_string(), 0, None)
                    }
                }
            };

            app.manage(BackendState {
                base_url,
                job,
                child: Mutex::new(child),
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<BackendState>() {
                    if state.job != 0 {
                        unsafe {
                            windows_sys::Win32::System::JobObjects::TerminateJobObject(
                                state.job as HANDLE,
                                0,
                            );
                        }
                    }
                }
            }
        });
}
