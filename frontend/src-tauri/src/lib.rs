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
// 用 127.0.0.1 而不是 localhost：Windows 上 localhost 会先解析到 ::1，
// 而 uvicorn 默认只绑 IPv4，WebView2 里会连接失败（curl 走 IPv4 所以看不出来）。
const DEV_BASE_URL: &str = "http://127.0.0.1:8000";

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
    // 便携/仓库内运行：onedir 产物放在 exe 同级的 tt-calendar-backend/ 目录
    // （与 dist/tt-calendar-backend 的结构一致，不会和 Python 源码目录 backend/ 混在一起）
    candidates.push(
        exe_dir
            .join("tt-calendar-backend")
            .join("tt-calendar-backend.exe"),
    );
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

/// 界面缩放。
///
/// 用 WebView 整体缩放而不是只改根字号：字号里有 200 处是绝对 px
/// （text-[11px] / text-[10px] 之类），只调根字号它们完全不跟；整体缩放
/// 连侧栏宽度、格子最小宽度一起按比例走，窗口 1949 宽时调 125% 就等价于
/// 回到 1560 的 CSS 视口，比例立刻恢复。
///
/// 快捷键由前端按档位绑定（不用 WebView2 自带的 20% 大步进），所以这里
/// 只暴露一个带范围校验的设值入口。
#[tauri::command]
fn set_ui_zoom(window: tauri::WebviewWindow, scale: f64) -> Result<(), String> {
    if !(0.5..=3.0).contains(&scale) {
        return Err(format!("缩放比例超出范围: {scale}"));
    }
    window.set_zoom(scale).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// 窗口圆角
// ---------------------------------------------------------------------------
//
// 两条完全不同的实现路径，取决于系统版本：
//
// - Win11（build >= 22000）：DWM 的 DWMWA_WINDOW_CORNER_PREFERENCE 直接给窗口
//   系统级圆角——带抗锯齿、带阴影、最大化时自动变方角，不用自己管。
// - Win10（含 1809 LTSC）：DWM 没有这个属性，只能 SetWindowRgn 按窗口区域硬裁。
//   边缘是 1px 阶梯（没有抗锯齿），因为半径小（8px）肉眼基本看不出，但确实圆了。
//   代价是缩放窗口时窗口区域不会自动跟着变，所以要在 Resized 事件里重设。
//
// 这也是用户在老 Win10 上看到「不是圆角」的根因：Win11 上无边框窗口默认有
// 系统圆角，Win10 上同一个二进制就是个直角矩形。

#[repr(C)]
struct OsVersionInfoW {
    dw_os_version_info_size: u32,
    dw_major_version: u32,
    dw_minor_version: u32,
    dw_build_number: u32,
    dw_platform_id: u32,
    sz_csd_version: [u16; 128],
}

#[link(name = "ntdll")]
extern "system" {
    // RtlGetVersion 不读兼容性清单，拿到的才是真实 build（GetVersionEx 会被 manifest 骗）。
    fn RtlGetVersion(version_info: *mut OsVersionInfoW) -> i32;
}

fn windows_build() -> u32 {
    let mut info = OsVersionInfoW {
        dw_os_version_info_size: std::mem::size_of::<OsVersionInfoW>() as u32,
        dw_major_version: 0,
        dw_minor_version: 0,
        dw_build_number: 0,
        dw_platform_id: 0,
        sz_csd_version: [0; 128],
    };
    let ok = unsafe { RtlGetVersion(&mut info) };
    if ok == 0 {
        info.dw_build_number
    } else {
        0
    }
}

/// DWMWA_WINDOW_CORNER_PREFERENCE；没有现成常量就自己写（值由 Windows SDK 22000 固定）。
const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
const DWMWCP_ROUND: u32 = 2;

fn apply_window_rounding(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;

    let Ok(raw) = window.hwnd() else {
        return;
    };
    let hwnd = raw.0 as HWND;

    if windows_build() >= 22000 {
        let pref = DWMWCP_ROUND;
        let hr = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &pref as *const u32 as *const core::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            )
        };
        if hr != 0 {
            log::warn!("DwmSetWindowAttribute(corner) failed: 0x{hr:08x}");
        }
        return;
    }

    // Win10：按窗口区域裁圆角。最大化时不裁（系统会把它拉成直角，看着更正常）。
    let Ok(size) = window.inner_size() else {
        return;
    };
    let maximized = window.is_maximized().unwrap_or(false);
    let radius = if maximized { 0 } else { 16 };
    unsafe {
        let rgn = windows_sys::Win32::Graphics::Gdi::CreateRoundRectRgn(
            0,
            0,
            size.width as i32 + 1,
            size.height as i32 + 1,
            radius,
            radius,
        );
        if rgn.is_null() {
            log::warn!("CreateRoundRectRgn failed");
            return;
        }
        // SetWindowRgn 成功后区域归系统所有，不能再 DeleteObject。
        let ok = windows_sys::Win32::Graphics::Gdi::SetWindowRgn(hwnd, rgn, 1);
        if ok == 0 {
            log::warn!("SetWindowRgn failed");
        }
    }
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
        // 自动更新：前端 updater 的 downloadAndInstall 需要 Rust 侧注册插件；
        // 装完用 process 插件的 relaunch 重启（比自定义 restart_app 更贴合插件语义）。
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            backend_base_url,
            restart_app,
            set_ui_zoom
        ])
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

            // 窗口圆角：Win11 走 DWM，Win10 走窗口区域；后者在缩放后必须重设。
            if let Some(window) = app.get_webview_window("main") {
                // 默认 1400×900 是按常见笔记本的逻辑分辨率定的；1366×768 这类小屏
                // 直接开会被屏幕裁掉一截，所以按可用工作区收一次再居中。
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
                    let target_w = 1400.0f64.min(size.width * 0.92);
                    let target_h = 900.0f64.min(size.height * 0.88);
                    if target_w < 1400.0 || target_h < 900.0 {
                        let _ = window.set_size(tauri::LogicalSize::new(
                            target_w.max(960.0),
                            target_h.max(600.0),
                        ));
                        let _ = window.center();
                    }
                }
                apply_window_rounding(&window);
                let resized_window = window.clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Resized(_)) {
                        apply_window_rounding(&resized_window);
                    }
                });
            }
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
