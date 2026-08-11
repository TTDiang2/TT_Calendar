// TT Calendar Tauri 壳：纯窗口，后端由外部 launcher 启动并管理生命周期。
#![cfg_attr(mobile, tauri::mobile_entry_point)]

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
