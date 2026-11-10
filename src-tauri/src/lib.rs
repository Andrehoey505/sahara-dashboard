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
            "Glacy's Tropical".into(),
            "SocialLink.io Staff".into(),
        ],
    }
}

/// Open a URL in the system browser.
///
/// The webview can't navigate to an external site, so Spotify authorisation
/// has to be handed to the default browser.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) URLs may be opened".into());
    }

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();

    result.map(|_| ()).map_err(|e| e.to_string())
}

/// Copy text to the system clipboard.
///
/// Used by the Spotify paste-the-callback flow, where the URL is long enough
/// that selecting it by hand is unreliable.
#[tauri::command]
fn copy_to_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(text)
        .map_err(|e| e.to_string())
}

/// Read text from the system clipboard.
#[tauri::command]
fn read_from_clipboard(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().read_text().map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            read_mod_log,
            bot_status,
            open_external,
            copy_to_clipboard,
            read_from_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
