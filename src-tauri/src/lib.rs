mod translator;

use translator::TranslatorState;
use tauri::Manager; // Import Manager trait for get_webview_window

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.get_webview_window("main").expect("no main window").set_focus();
        }))
        .manage(TranslatorState::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            translator::start_translation,
            translator::stop_translation,
            translator::fetch_models,
            translator::load_config,
            translator::save_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
