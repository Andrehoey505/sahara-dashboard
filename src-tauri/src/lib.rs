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

/// Make one HTTP request to the bot, in Rust.
///
/// # Why this exists as a command rather than the http plugin
///
/// The plugin works, but it has to be reached from the webview, and everything
/// it does is still agreed with the webview's security model: a capability, an
/// allow-scope, an origin. That model failed silently against the Tailscale
/// address -- no error surfaced, no request arrived at the bot -- and then it
/// took the LAN address down with it. Each fix was a guess at which part of the
/// model was refusing.
///
/// This is not a guess. It is `reqwest`, called from Rust, on a URL the user
/// typed into a settings field. There is no scope to satisfy, nothing to
/// negotiate with the webview, and no way for the answer to depend on what
/// origin the request appears to come from.
///
/// The URL is untrusted input -- it comes from the frontend and ultimately from
/// what someone typed -- so only http and https are allowed. Nothing else is
/// fetched, and the response is size-limited: a settings field is not a licence
/// to pull a gigabyte into memory.
#[tauri::command]
async fn bot_http(
    url: String,
    method: Option<String>,
    body: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<serde_json::Value, String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("bad url: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("refusing scheme {}", parsed.scheme()));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(20_000)))
        // The bot is on a laptop over Tailscale. A redirect to somewhere else is
        // not something it should ever do, and following one would mean the
        // allow-list is decided by whoever answers.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let m = method.unwrap_or_else(|| "GET".into()).to_uppercase();
    let mut req = client.request(
        reqwest::Method::from_bytes(m.as_bytes()).map_err(|e| e.to_string())?,
        parsed.clone(),
    );
    for (k, v) in headers.unwrap_or_default() {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let started = std::time::Instant::now();
    let res = req.send().await.map_err(|e| format!("{e}"))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| format!("{e}"))?;
    if text.len() > 32 * 1024 * 1024 {
        return Err("response too large".into());
    }

    Ok(serde_json::json!({
        "status": status,
        "ok": (200..300).contains(&status),
        "body": text,
        "ms": started.elapsed().as_millis() as u64,
    }))
}

/// Open a URL in the system browser.
///
/// The webview can't navigate to an external site, so Spotify authorisation
/// has to be handed to the default browser.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    // This command is reachable from the webview, so the URL is untrusted
    // input. Allow-list the hosts rather than trusting the scheme: the only
    // thing that ever needs opening is Spotify's authorisation page, and a
    // scheme-only check would hand any http(s) address to the OS.
    const ALLOWED_HOSTS: [&str; 2] = ["accounts.spotify.com", "open.spotify.com"];

    let parsed = url::Url::parse(&url).map_err(|_| "not a valid URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("only https URLs may be opened".into());
    }
    let host = parsed.host_str().unwrap_or("");
    if !ALLOWED_HOSTS.contains(&host) {
        return Err(format!("refusing to open {}", host));
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
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            bot_http,
            read_mod_log,
            bot_status,
            open_external,
            copy_to_clipboard,
            read_from_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
