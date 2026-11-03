use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
struct BotStatus {
    pid: Option<u32>,
    running: bool,
    guilds: Vec<String>,
}

#[tauri::command]
fn read_mod_log(path: String, limit: usize) -> Result<Vec<serde_json::Value>, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = content.lines().rev().take(limit).collect();
    let mut out = Vec::new();
    for line in lines {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            out.push(v);
        }
    }
    Ok(out)
}

#[tauri::command]
fn bot_status() -> BotStatus {
    BotStatus {
        pid: None,
        running: true,
        guilds: vec![
            "Bear Café".into(),
            "Babble Playpen".into(),
            "SocialLink.io Staff".into(),
        ],
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![read_mod_log, bot_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}