// TT Calendar Tauri 主逻辑：启动 Python sidecar，窗口关闭时 kill。
#![cfg_attr(mobile, tauri::mobile_entry_point)]

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct SidecarState(Mutex<Option<CommandChild>>);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // 启动 Python backend sidecar（监听 127.0.0.1:8765）
            let sidecar = app
                .shell()
                .sidecar("tt-calendar-backend")
                .expect("failed to find sidecar binary");
            let (_events, child) = sidecar
                .spawn()
                .expect("failed to spawn backend sidecar");
            app.manage(SidecarState(Mutex::new(Some(child))));
            Ok(())
        })
        .on_window_event(|window, event| {
            // 窗口销毁时 kill sidecar，避免僵尸进程
            if let tauri::WindowEvent::Destroyed = event {
                let state: tauri::State<SidecarState> = window.app_handle().state();
                let mut guard = state.0.lock().unwrap();
                if let Some(child) = guard.take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
