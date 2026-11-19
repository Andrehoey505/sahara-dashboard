use serde::Serialize;
mod lite_discord;
mod lite_images;
mod discovery;
mod lite_rules;
mod lite_server;

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

    // One request per call, and a fresh connection is cheap when you make twelve
    // of them. What is not cheap: reqwest pools connections per host by default,
    // and a client built per request still hands its socket back to a pool that
    // is dropped with it -- so a stalled request on a starved machine can leave
    // the next one waiting on a connection that will never drain. The log showed
    // exactly that shape: a burst where seven requests each returned 200 but
    // took 11-20 SECONDS, and three took the full 20s timeout and returned
    // nothing. That is queueing, not latency.
    //
    // A per-call client with pooling off and no idle reuse turns each request
    // into one dedicated socket that dies with the answer. On a LAN that costs
    // microseconds; on that machine it is the difference between answering and
    // not.
    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(0)
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
    let res = req.send().await.map_err(|e| {
        // A bare `{e}` from reqwest is "error sending request for url (...)",
        // which says nothing about why. The layers underneath do know: DNS,
        // connect, TLS, timeout. Walk the source chain, because the outer
        // message is always the useless one.
        let mut detail = e.to_string();
        let mut src: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(&e);
        while let Some(s) = src {
            detail.push_str(&format!(" <- {s}"));
            src = std::error::Error::source(s);
        }
        detail
    })?;
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

/// Where the bot token lives: the macOS Keychain, and nowhere else.
///
/// A Discord bot token is a password that cannot be rotated without breaking
/// every server the bot is in, so it is treated like one. It is never written to
/// a settings file, never logged, never put in an error message, and never
/// returned to the webview in full -- the screen only ever learns whether a
/// token exists.
const KEYCHAIN_SERVICE: &str = "com.sahara.dashboard";
const KEYCHAIN_ACCOUNT: &str = "babblebot-discord-token";

/// Every service name a token could have been stored under.
///
/// The app's own bundle identifier is the one it writes. The other was used while
/// the card was first built, and a token stored by the `security` command or by an
/// earlier build sits under whichever name was current at the time. Looking in
/// both costs nothing and means a token is never "missing" because of a rename.
const KEYCHAIN_SERVICES: &[&str] = &["com.sahara.dashboard", "io.sociallink.sahara-dashboard"];

fn keychain_entry_for(service: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

/// The entry that actually holds a token, and the service it was found under.
fn keychain_entry() -> Result<(keyring::Entry, &'static str), String> {
    let mut last = String::from("no keychain entry");
    for svc in KEYCHAIN_SERVICES {
        match keychain_entry_for(svc) {
            Ok(e) => match e.get_password() {
                Ok(_) => return Ok((e, svc)),
                Err(err) => last = format!("{svc}: {err:?}"),
            },
            Err(e) => last = format!("{svc}: {e}"),
        }
    }
    Err(last)
}

/// Store a token the user pasted or fetched. Called once, while Windows is up.
#[tauri::command]
fn lite_token_store(token: String) -> Result<serde_json::Value, String> {
    let t = token.trim();
    if t.is_empty() {
        return Err("empty token".into());
    }
    // A Discord bot token is three base64url segments separated by dots. Checked
    // because storing a wrong string silently means discovering it at 11am when
    // the power is already off.
    if t.split('.').count() != 3 || t.len() < 50 {
        return Err("that does not look like a Discord bot token".into());
    }
    // Written to the app's own service name, so there is one place it lives going
    // forward. An older copy under another name is left alone rather than deleted:
    // removing something the user cannot see is worse than a stale duplicate.
    keychain_entry_for(KEYCHAIN_SERVICES[0])?
        .set_password(t)
        .map_err(|e| format!("keychain refused it: {e}"))?;
    Ok(serde_json::json!({ "stored": true, "service": KEYCHAIN_SERVICES[0] }))
}

/// Whether a token is held, without ever handing it back to the screen.
#[tauri::command]
fn lite_token_status() -> serde_json::Value {
    // The reason matters. "Not stored" and "stored but this app was refused
    // permission" are completely different problems and used to look identical.
    match keychain_entry() {
        Ok((entry, svc)) => match entry.get_password() {
            Ok(t) => serde_json::json!({ "present": true, "length": t.len(), "service": svc }),
            Err(e) => serde_json::json!({
                "present": false,
                "service": svc,
                "reason": format!("{e:?}"),
                "hint": "macOS may be refusing this app access to the item. Deleting it in Keychain Access and saving it again from this screen re-creates it with this app's permissions.",
            }),
        },
        Err(reason) => serde_json::json!({
            "present": false,
            "service": KEYCHAIN_SERVICES[0],
            "reason": reason,
        }),
    }
}

/// Forget it, for when the bot's token is rotated or the Mac changes hands.
#[tauri::command]
fn lite_token_clear() -> serde_json::Value {
    for svc in KEYCHAIN_SERVICES {
        if let Ok(e) = keychain_entry_for(svc) {
            let _ = e.delete_credential();
        }
    }
    serde_json::json!({ "present": false })
}

/// Lite's rules, taken from the Windows database snapshot when there is one.
///
/// Read-only and best-effort: if the snapshot is missing or has no rule tables,
/// Lite runs with its built-in minimum (invite links) rather than refusing to
/// start. An emergency bot with a small rule set is worth more than no bot.
pub fn load_lite_config() -> lite_discord::LiteConfig {
    let mut cfg = lite_discord::LiteConfig::default();
    let path = lite_server::snapshot_path();
    if !path.exists() {
        return cfg;
    }
    let conn = match rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        Ok(c) => c,
        Err(_) => return cfg,
    };

    // Guilds, so Lite only watches where Babblebot watched.
    if let Ok(mut stmt) = conn.prepare("SELECT guild_id, name FROM servers") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0).unwrap_or_default(),
                r.get::<_, String>(1).unwrap_or_default(),
            ))
        }) {
            for row in rows.flatten() {
                if !row.0.is_empty() {
                    cfg.guilds.push(row);
                }
            }
        }
    }

    // Channels set to Off, which Lite must leave alone.
    if let Ok(mut stmt) =
        conn.prepare("SELECT channel_id FROM channel_rules WHERE preset = 'off'")
    {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            for row in rows.flatten() {
                cfg.ignored_channels.push(row);
            }
        }
    }

    // Per-channel switches, so Lite enforces exactly what each channel says.
    if let Ok(mut stmt) = conn.prepare(
        "SELECT channel_id, preset, links, profanity, spam FROM channel_rules",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0).unwrap_or_default(),
                crate::lite_rules::ChannelRule {
                    preset: r.get::<_, String>(1).unwrap_or_else(|_| "normal".into()),
                    links: r.get::<_, String>(2).unwrap_or_else(|_| "flag".into()),
                    profanity: r.get::<_, String>(3).unwrap_or_else(|_| "flag".into()),
                    spam: r.get::<_, String>(4).unwrap_or_else(|_| "flag".into()),
                },
            ))
        }) {
            for (id, rule) in rows.flatten() {
                if !id.is_empty() {
                    cfg.rules.insert(id, rule);
                }
            }
        }
    }

    // Staff Andre has exempted. Windows does not moderate them at all.
    if let Ok(mut stmt) = conn.prepare("SELECT user_id FROM exempt_users") {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            cfg.exempt_users = rows.flatten().collect();
        }
    }

    // Ticket types, so Lite answers the same buttons the Windows panel posts.
    if let Ok(mut stmt) = conn.prepare("SELECT guild_id, type_id, label, emoji FROM ticket_types") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0).unwrap_or_default(),
                r.get::<_, String>(1).unwrap_or_default(),
                r.get::<_, String>(2).unwrap_or_default(),
                r.get::<_, String>(3).unwrap_or_default(),
            ))
        }) {
            for row in rows.flatten() {
                if !row.1.is_empty() {
                    cfg.ticket_types.push(row);
                }
            }
        }
    }

    // Where a ticket channel goes.
    if let Ok(mut stmt) = conn.prepare("SELECT guild_id, ticket_category FROM guild_config") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0).unwrap_or_default(), r.get::<_, String>(1).unwrap_or_default()))
        }) {
            for (g, c) in rows.flatten() {
                if !g.is_empty() && !c.is_empty() {
                    cfg.ticket_category.insert(g, c);
                }
            }
        }
    }

    // Staff roles, so bb!verify refuses a non-staff member exactly as Windows does.
    if let Ok(mut stmt) = conn.prepare("SELECT guild_id, role_id FROM staff_roles") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0).unwrap_or_default(), r.get::<_, String>(1).unwrap_or_default()))
        }) {
            for (g, role) in rows.flatten() {
                if !g.is_empty() && !role.is_empty() {
                    cfg.staff_roles.entry(g).or_default().push(role);
                }
            }
        }
    }

    // The role bb!verify grants, per server.
    if let Ok(mut stmt) = conn.prepare(
        "SELECT guild_id, value FROM guild_config WHERE key = 'verification_role'",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0).unwrap_or_default(), r.get::<_, String>(1).unwrap_or_default()))
        }) {
            for (g, role) in rows.flatten() {
                if !g.is_empty() && role.chars().all(|c| c.is_ascii_digit()) {
                    cfg.verify_roles.insert(g, role);
                }
            }
        }
    }

    // The learned part of the flag system: how staff have judged past flags on
    // Windows. Without this Lite would use the bot's original default and flag
    // things staff have already decided to tolerate.
    let (mut approved, mut rejected) = (0u32, 0u32);
    if let Ok(mut stmt) = conn.prepare("SELECT approved, violation_type FROM mod_decisions") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0).unwrap_or(0) != 0,
                r.get::<_, String>(1).unwrap_or_default(),
            ))
        }) {
            for (ok, vtype) in rows.flatten() {
                // Only profanity moves a threshold Lite actually applies.
                if vtype == "profanity" {
                    if ok {
                        approved += 1;
                    } else {
                        rejected += 1;
                    }
                }
            }
        }
    }
    cfg.profanity_threshold = crate::lite_rules::threshold_for(approved, rejected, 2);

    // The helpline, where nothing is ever auto-deleted.
    if let Ok(mut stmt) = conn.prepare(
        "SELECT value FROM config WHERE key = 'helpline_guild_id'",
    ) {
        if let Ok(v) = stmt.query_row([], |r| r.get::<_, String>(0)) {
            if !v.trim().is_empty() {
                cfg.helpline_guild_id = Some(v.trim().to_string());
            }
        }
    }

    cfg
}

fn keychain_token() -> Result<String, String> {
    keychain_entry()?
        .0
        .get_password()
        .map_err(|_| "no bot token saved on this Mac".to_string())
}

/// Copy a token from any service name it was stored under into the app's own.
///
/// ## Why this exists
///
/// A Keychain item carries the permissions of whoever created it. A token written
/// by the `security` command or by an older build belongs to a *different* item,
/// and this app can be refused access to it -- which is what makes the screen say
/// "no token" while the token is plainly there. Re-creating the item from this app
/// fixes the permissions, and doing that needs the value, so the copy happens here
/// in Rust where the value never reaches the webview.
///
/// It reports what it did in terms of service names, never the token.
#[tauri::command]
fn lite_token_sync() -> serde_json::Value {
    let target = KEYCHAIN_SERVICES[0];

    // Already readable under the app's own name: nothing to do.
    if let Ok(e) = keychain_entry_for(target) {
        if e.get_password().is_ok() {
            return serde_json::json!({
                "ok": true,
                "changed": false,
                "message": format!("Already readable under {target}."),
            });
        }
    }

    // Find it anywhere else.
    for svc in KEYCHAIN_SERVICES.iter().skip(1) {
        if let Ok(src) = keychain_entry_for(svc) {
            if let Ok(secret) = src.get_password() {
                match keychain_entry_for(target).and_then(|e| {
                    e.set_password(&secret)
                        .map_err(|err| format!("could not write under {target}: {err}"))
                }) {
                    Ok(()) => {
                        return serde_json::json!({
                            "ok": true,
                            "changed": true,
                            "from": svc,
                            "to": target,
                            "message": format!("Copied from {svc} to {target}. It should now read as held."),
                        })
                    }
                    Err(e) => {
                        return serde_json::json!({ "ok": false, "error": e });
                    }
                }
            }
        }
    }

    serde_json::json!({
        "ok": false,
        "error": "No readable token found under any known name. Save it again from this screen.",
    })
}

/// Keep this Mac awake while Lite is in charge.
///
/// ## Why this is not optional
///
/// The whole point of Lite is that it runs when nobody is at the machine -- the
/// power has gone, Andre is asleep, and the Windows box is dead. A Mac that
/// sleeps mid-shift takes Lite with it, so the server is unmoderated by a laptop
/// that has dozed off. That would make the feature a false promise.
///
/// macOS gives this through an IOKit power assertion: a named claim that says
/// "do not idle-sleep while this is held", released when the handle drops. It
/// does not stop a lid-close, and it should not -- it stops the *idle* sleep that
/// would otherwise end a shift quietly.
///
/// The assertion is held in a static so it lives exactly as long as the app does,
/// and is released explicitly when Lite stops, so this Mac is not kept awake for
/// a bot that is no longer running.
#[cfg(target_os = "macos")]
mod keep_awake {
    use std::ffi::c_void;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            name: *const c_void,
            level: u32,
            reason: *const c_void,
            id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            c_str: *const i8,
            encoding: u32,
        ) -> *const c_void;
        fn CFRelease(cf: *const c_void);
    }

    const K_UTF8: u32 = 0x08000100;
    /// kIOPMAssertionLevelOn
    const LEVEL_ON: u32 = 255;

    fn cfstring(s: &str) -> *const c_void {
        let c = std::ffi::CString::new(s).unwrap_or_default();
        unsafe { CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), K_UTF8) }
    }

    pub struct Handle(pub u32);
    unsafe impl Send for Handle {}

    pub fn acquire() -> Option<Handle> {
        let kind = cfstring("NoIdleSleepAssertion");
        let why = cfstring("BabbleBot Lite is watching a Discord server");
        if kind.is_null() || why.is_null() {
            return None;
        }
        let mut id: u32 = 0;
        let r = unsafe { IOPMAssertionCreateWithName(kind, LEVEL_ON, why, &mut id) };
        unsafe {
            CFRelease(kind);
            CFRelease(why);
        }
        if r == 0 {
            Some(Handle(id))
        } else {
            None
        }
    }

    pub fn release(h: Handle) {
        unsafe {
            IOPMAssertionRelease(h.0);
        }
    }
}

static AWAKE: std::sync::Mutex<Option<u32>> = std::sync::Mutex::new(None);

/// Hold the "do not idle sleep" assertion. Safe to call twice.
#[tauri::command]
fn keep_awake_on() -> serde_json::Value {
    #[cfg(target_os = "macos")]
    {
        let mut g = AWAKE.lock().unwrap_or_else(|e| e.into_inner());
        if g.is_some() {
            return serde_json::json!({ "awake": true, "changed": false });
        }
        match keep_awake::acquire() {
            Some(h) => {
                *g = Some(h.0);
                serde_json::json!({ "awake": true, "changed": true })
            }
            None => serde_json::json!({
                "awake": false,
                "error": "macOS refused the power assertion",
            }),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        serde_json::json!({ "awake": false, "error": "only implemented on macOS" })
    }
}

/// Give the assertion back.
#[tauri::command]
fn keep_awake_off() -> serde_json::Value {
    #[cfg(target_os = "macos")]
    {
        let mut g = AWAKE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(id) = g.take() {
            keep_awake::release(keep_awake::Handle(id));
            return serde_json::json!({ "awake": false, "changed": true });
        }
    }
    serde_json::json!({ "awake": false, "changed": false })
}

/// Where Lite's API is listening, for the app to switch its address to.
#[tauri::command]
fn lite_url() -> String {
    lite_server::lite_server_url()
}

/// BabbleBot Lite: the emergency bot, on this Mac.
///
/// ## What it is
///
/// The same Discord bot, run from here, when the Windows machine is gone. It
/// shares Babblebot's token because Andre will not run a second Discord
/// application -- which is the constraint that makes the whole thing delicate:
/// two processes on one token cannot coexist, because Discord ends the older
/// session the moment the newer one identifies.
///
/// ## The safety rules, all of them required
///
/// 1. **Windows must be confirmed gone first.** Not "unreachable from this
///    Mac" -- gone. If Windows is merely unreachable we are about to kick a
///    healthy bot off its session, which is worse than an unmoderated server.
///    Checked here, in Rust, against every address we know, with a real
///    timeout.
/// 2. **Never when this Mac has no network of its own.** No network means no
///    Discord, and a bot that cannot connect does not moderate anything.
/// 3. **It announces itself** in the server when it starts, so nobody wonders
///    why the bot's behaviour changed.
/// 4. **It stops before Windows comes back.** Windows is the owner; the Mac is
///    the stand-in.
///
/// The token is passed in from the frontend's Keychain-held copy and never
/// written to disk, never logged, and never included in an error message.
#[tauri::command]
async fn babblebot_lite(action: String) -> Result<serde_json::Value, String> {
    match action.as_str() {
        "start" => {
            let token = keychain_token()?;

            // The one check that can honestly answer "is a client already
            // running". Lite's HTTP API being up is not the same question: on a
            // relaunch the old process is usually gone, nothing answers on 8099,
            // and starting a second client on the same token made Discord deliver
            // every event twice -- which is how Andre saw every Lite message
            // posted in duplicate.
            if lite_discord::is_running() || lite_discord::a_client_was_started() {
                return Ok(serde_json::json!({
                    "running": true,
                    "already": true,
                    "detail": "A Discord client is already running in this app -- not starting a second one on the same token",
                    "url": lite_server::lite_server_url(),
                    "connected": true,
                }));
            }

            // Rule 1: is Windows really gone?
            let client = reqwest::Client::builder()
                .pool_max_idle_per_host(0)
                .timeout(std::time::Duration::from_secs(3))
                .build()
                .map_err(|e| e.to_string())?;
            for url in ["http://192.168.1.128:8080/api/health", "http://100.121.118.62:8080/api/health"] {
                if let Ok(r) = client.get(url).send().await {
                    if r.status().is_success() {
                        return Ok(serde_json::json!({
                            "running": false,
                            "error": format!("Windows answered at {url} -- not taking over a healthy bot"),
                        }));
                    }
                }
            }

            // Windows is gone and the token is here: the two conditions that
            // make a takeover legitimate. Start the API Lite can actually serve.
            //
            // The Discord client is the remaining piece. Until it is wired, the
            // server comes up honestly reporting `connected: false` -- the app
            // gets a real Lite endpoint that says nobody is watching yet, which
            // is the truth, rather than a cheerful lie.
            // Ask before touching anything. A second Start used to reset the state
            // and only then discover the port was taken, so a running Lite was
            // emptied and then reported as a failure.
            let already = lite_server::lite_is_serving();
            if !already {
                lite_server::lite_reset();
            }
            // Only bind if nobody already holds the port. A second start used to
            // fail the whole command with "Address already in use" *after* it had
            // reset the state -- so Lite looked like it had crashed while an older
            // copy of itself was still quietly serving, and every screen showed a
            // fresh, empty Lite. Ask whether our own API is already answering and
            // treat that as "already running" rather than as a failure.
            if !already {
                lite_server::lite_server_start()
                    .map_err(|e| format!("could not start the Lite API: {e}"))?;
            } else {
                lite_server::lite_event(
                    "note",
                    "Lite's API was already up on this Mac, so it was kept rather than bound again".into(),
                    None,
                    None,
                );
            }

            // Keep this Mac awake for the shift. Released when Lite stops, so an
            // idle laptop is not held awake for a bot that has finished.
            let _ = keep_awake_on();

            // Load the rules Lite enforces.
            //
            // Three sources, in order of how much they deserve to be believed:
            //  1. the file written by the last successful sync -- a real copy of
            //     Windows' settings, with a timestamp on it;
            //  2. the database snapshot taken at handover, if there is one;
            //  3. nothing, which is what the app must be honest about.
            //
            // A relaunch used to land on (3) every time, so Lite came back empty
            // and reporting nothing, as though the rules had stopped being true
            // because the window was closed.
            match lite_discord::load_saved_config() {
                Some(saved) => {
                    let age = lite_discord::saved_config_at()
                        .map(|at| {
                            let secs = (lite_server::lite_now_ms().saturating_sub(at)) / 1000;
                            format!("{} ago", lite_discord::describe_seconds(secs))
                        })
                        .unwrap_or_else(|| "of unknown age".into());
                    lite_server::lite_event(
                        "note",
                        format!(
                            "loaded the saved rules from disk ({}, {} servers, {} channel rules) -- {age}",
                            lite_discord::describe_saved(&saved),
                            saved.guilds.len(),
                            saved.rules.len()
                        ),
                        None,
                        None,
                    );
                    lite_discord::set_config(saved);
                }
                None => {
                    lite_server::lite_event(
                        "note",
                        "no saved rules on this Mac yet, so reading the database snapshot".into(),
                        None,
                        None,
                    );
                    lite_discord::set_config(load_lite_config());
                }
            }

            // Image checking comes up with Lite and goes down with it, so the model
            // is only in memory while this Mac is actually covering.
            match lite_images::start() {
                Ok(()) => lite_server::lite_event(
                    "note",
                    "image checker loaded (NudeNet on this Mac)".into(),
                    None,
                    None,
                ),
                Err(e) => lite_server::lite_event(
                    "error",
                    format!("image checking is off: {e}"),
                    None,
                    None,
                ),
            }

            // Now actually watch. This runs on its own thread with its own
            // runtime: the command returns immediately so the screen can show
            // "connected" as soon as Discord says so, and a gateway hiccup cannot
            // block the app.
            let token_for_client = token.clone();
            std::thread::spawn(move || {
                let rt = match tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt,
                    Err(e) => {
                        lite_server::lite_event(
                            "error",
                            format!("could not start the Discord runtime: {e}"),
                            None,
                            None,
                        );
                        return;
                    }
                };
                rt.block_on(lite_discord::run(token_for_client));
            });

            // Windows may come back while nobody is watching. Waiting for a human
            // to notice is how a laptop ends up moderating for three days, so the
            // handover is watched for rather than waited for.
            std::thread::spawn(|| {
                let rt = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt,
                    Err(_) => return,
                };
                rt.block_on(lite_discord::watch_for_windows());
            });

            Ok(serde_json::json!({
                "running": true,
                "detail": "Lite API is up on 127.0.0.1:8099 — Discord client not connected yet",
                "url": lite_server::lite_server_url(),
                "connected": false,
            }))
        }
        "stop" => {
            // Leave the gateway cleanly before anything else: the session is what
            // another process would have to take over, and dropping the socket is
            // how Discord learns we are gone.
            let deliberate = lite_discord::is_running();
            lite_discord::stop();
            lite_images::stop();
            let _ = keep_awake_off();
            Ok(serde_json::json!({
                "running": false,
                "deliberate": deliberate,
                "detail": "Lite stopped, its API closed, and this Mac may sleep again",
            }))
        }
        _ => Ok(serde_json::json!({ "running": false, "detail": "not running" })),
    }
}

/// Point Lite's watcher at the road the app last reached Windows on.
///
/// Lite only covers while Windows is gone, so this is the address it checks to
/// find out whether that is still true. Cleared when the app has no working
/// address, because guessing one risks finding a different machine that happens
/// to answer -- and stepping down for that would leave the server uncovered.
#[tauri::command]
fn lite_set_watch_address(url: Option<String>) -> Result<(), String> {
    lite_discord::set_watch_address(url);
    Ok(())
}

/// Has Lite handed back?
///
/// ## Why the app has to ask
///
/// The watcher lives in Rust and steps Lite down by itself. Nothing told the
/// window, so Andre had to restart the app before the UI changed back -- Lite had
/// already let go of Discord and Windows had the session again, and the screen
/// still said "Lite — moderating". A handback nobody is told about leaves the
/// screen claiming the opposite of the truth, which is the one thing this app is
/// not allowed to do.
///
/// The answer is "Lite was running at some point and is running no longer", which
/// is exactly `was_stopped()`: set only by a deliberate stop, so a dropped socket
/// is not mistaken for a handback. `cleared` resets it once the screen has taken
/// the news, so the app does not see the same handback twice.
#[tauri::command]
fn lite_handback_taken() -> serde_json::Value {
    let stopped = lite_discord::was_stopped();
    let running = lite_discord::is_running();
    serde_json::json!({
        "handed_back": stopped && !running,
        "running": running,
    })
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
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            bot_http,
            babblebot_lite,
            lite_token_store,
            lite_token_status,
            lite_token_clear,
            lite_token_sync,
            lite_url,
            lite_server::lite_auto_sync_start,
            lite_server::lite_sync_now,
            lite_server::lite_set_live_road,
            lite_set_watch_address,
            lite_handback_taken,
            keep_awake_on,
            keep_awake_off,
            lite_server::lite_db_snapshot,
            lite_server::lite_db_status,
            lite_server::lite_ticket_open,
            lite_server::lite_merge_reconcile,
            discovery::discover_bot,
            lite_server::lite_rules_sync,
            lite_server::lite_tickets,
            lite_server::lite_tickets_mark_transferred,
            lite_server::lite_verify_message,
            // What Lite is actually enforcing, and when it last refreshed. Built
            // and never called until now: the two questions the Lite screen most
            // needs answered were the two it had no way to ask.
            lite_server::lite_rules_summary,
            lite_server::lite_sync_state,
            read_mod_log,
            bot_status,
            open_external,
            copy_to_clipboard,
            read_from_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
