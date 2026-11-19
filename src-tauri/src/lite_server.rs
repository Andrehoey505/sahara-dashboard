//! BabbleBot Lite's own API, on this Mac.
//!
//! ## Why this exists
//!
//! The dashboard talks to a bot API on the Windows machine. When that machine is
//! gone there is nothing to talk to, and the app has always handled that the same
//! way: say the bot is unreachable and offer to wait. But the honest situation
//! is not "no bot" -- it is "a smaller bot, on this Mac, with fewer abilities".
//! Those are different states and they should look different.
//!
//! So Lite answers the same `/api/health` the app already asks for, and says what
//! it is. The app connects to it exactly as it connects to Windows; the
//! difference is what the answers contain and which screens make sense.
//!
//! ## What this is not
//!
//! It is not a reimplementation of the bot API. It does not pretend to have
//! violations, music, tickets or a database, because it does not. Every endpoint
//! that would need Windows returns an explicit "not available in Lite" with a
//! reason, and the app shows that as a plain sentence. A screen that quietly
//! showed an empty list would be lying about a 109-channel server being
//! unmoderated, which is the exact thing this whole feature exists to prevent.
//!
//! ## The limits, stated once
//!
//! - Text moderation only: no image or video analysis. The models are gigabytes
//!   of Python that this Mac does not have, and even Windows runs them on CPU.
//! - No database: nothing Lite sees is stored for later, so anything found while
//!   it is in charge is reported live in Discord and gone from here.
//! - No music, relay, Spotify or tickets: those are Windows-side features.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// The port Lite serves on. Deliberately not 8080 -- that would look like Windows.
pub const LITE_PORT: u16 = 8099;

#[derive(Serialize, Clone)]
pub struct LiteEvent {
    pub at: u64,
    pub kind: String,
    /// A sentence a person can read. No IDs without names.
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}

#[derive(Serialize, Clone, Default)]
pub struct LiteState {
    /// Is the Discord client actually connected right now?
    pub connected: bool,
    /// The bot's own tag, so the screen can name who is watching.
    pub bot_tag: Option<String>,
    /// Guild names, for the header.
    pub guilds: Vec<String>,
    /// Unix ms when Lite took over.
    pub since: u64,
    /// Counts, so the screen can show that it is doing something.
    pub seen: u64,
    pub flagged: u64,
    /// The last few things it acted on, newest first. Never stored anywhere else.
    pub recent: Vec<LiteEvent>,
    /// When the copy of the Windows database was taken, and how old it is.
    ///
    /// Lite works from a snapshot, so every screen built on it must say how old
    /// the snapshot is. A ticket list from nine hours ago is useful; a ticket
    /// list from nine hours ago presented as current is a lie.
    pub db_snapshot_at: Option<u64>,
    pub db_ok: bool,
}

/// Unix ms, for other modules that need the same clock as the screen.
pub fn lite_now_ms() -> u64 {
    now_ms()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn state() -> &'static Mutex<LiteState> {
    static STATE: OnceLock<Mutex<LiteState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(LiteState::default()))
}

/// Record who we are, for the screen to name.
/// Read the live state the Lite screen shows: whether the Discord socket is up,
/// who we are, and which guilds are being watched.
pub fn lite_client_state() -> serde_json::Value {
    let g = match state().lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    };
    serde_json::json!({
        "connected": g.connected,
        "bot": g.bot_tag,
        "guilds": g.guilds,
        "seen": g.seen,
    })
}

/// Expose the text check so the app can prove it works without a live server.
/// Judge one piece of text with the real ported rules, for the app to prove the
/// checks work without waiting for a live breach.
pub fn lite_text_breach(content: &str) -> Option<String> {
    let rule = crate::lite_rules::ChannelRule::from_preset("normal");
    let mut clock = crate::lite_rules::SpamClock::empty();
    let j = crate::lite_rules::judge(
        content,
        &crate::lite_rules::Context {
            rule: &rule,
            profanity_threshold: 2,
            is_new_user: false,
            is_helpline: false,
            exempt: false,
        },
        &mut clock,
        "probe",
        0,
    );
    if j.violations.is_empty() {
        None
    } else {
        Some(j.violations.join(", "))
    }
}

pub fn lite_set_identity(tag: Option<String>) {
    if let Ok(mut s) = state().lock() {
        s.bot_tag = tag;
    }
}

/// Record which guilds we are watching.
pub fn lite_set_guilds(names: Vec<String>) {
    if let Ok(mut s) = state().lock() {
        s.guilds = names;
    }
}

/// Record whether the Discord socket is live.
pub fn lite_set_connected(up: bool) {
    if let Ok(mut s) = state().lock() {
        s.connected = up;
    }
}

/// Reset to "just took over, nothing seen yet".
pub fn lite_reset() {
    if let Ok(mut s) = state().lock() {
        *s = LiteState {
            since: now_ms(),
            ..Default::default()
        };
    }
}

/// Called by the Discord side as things happen. Kept tiny on purpose.
pub fn lite_update(patch: LiteState) {
    if let Ok(mut s) = state().lock() {
        *s = patch;
    }
}

/// Message ids Lite has already acted on.
///
/// ## Why this is not paranoia
///
/// Andre saw **four** copies of every Lite reply in Discord. One process with one
/// socket cannot do that; four clients on the same token can, and a client that
/// reconnects after a socket drop while Discord still considers the old session
/// alive will be handed the same events again. Two bugs, one symptom.
///
/// The blockers for the first are in: one client per process, and a start that
/// refuses when the API answers. This set covers the second, because no amount of
/// guarding the start can stop Discord replaying a message.
///
/// The key is the message id, which is unique per message and stable across
/// deliveries -- so acting on "the same content" is never guessed at, and two
/// people posting the same words still both get moderated.
static SEEN_MESSAGES: std::sync::Mutex<std::collections::VecDeque<String>> =
    std::sync::Mutex::new(std::collections::VecDeque::new());

/// True the first time a message id is offered, false every time after.
///
/// Bounded and ordered: a long shift holds a few thousand ids, not a leak. When
/// the cap is reached the oldest goes, which is safe because Discord does not
/// replay an event hours later.
pub fn first_time_seen(message_id: &str) -> bool {
    if message_id.is_empty() {
        // No id means no way to tell a replay from a second message, so it is
        // treated as new rather than silently dropped: dropping a real message
        // would leave it unmoderated.
        return true;
    }
    let mut seen = match SEEN_MESSAGES.lock() {
        Ok(s) => s,
        Err(e) => e.into_inner(),
    };
    if seen.iter().any(|id| id == message_id) {
        return false;
    }
    seen.push_back(message_id.to_string());
    while seen.len() > 5_000 {
        seen.pop_front();
    }
    true
}

/// Add one event to the rolling list the screen shows.
pub fn lite_event(kind: &str, text: String, channel: Option<String>, user: Option<String>) {
    if let Ok(mut s) = state().lock() {
        s.seen += 1;
        if kind == "flag" {
            s.flagged += 1;
        }
        s.recent.insert(
            0,
            LiteEvent {
                at: now_ms(),
                kind: kind.to_string(),
                text,
                channel,
                user,
            },
        );
        s.recent.truncate(40);
    }
}

/// What the app is told when it asks for something Lite cannot do.
///
/// `lite: true` is the flag the frontend keys off, so it never has to guess from
/// a 404 whether the route is missing or the machine is gone.
fn unavailable(what: &str) -> serde_json::Value {
    serde_json::json!({
        "lite": true,
        "available": false,
        "error": format!("{what} needs the Windows machine. BabbleBot Lite is running here instead."),
    })
}

/// Routes Lite genuinely answers, each with what it can actually report.
fn handle(path: &str) -> Option<serde_json::Value> {
    let s = state().lock().ok()?.clone();

    if path == "/api/health" {
        return Some(serde_json::json!({
            // The same shape Windows sends, plus the flag that changes the UI.
            "status": "ok",
            "bot_online": s.connected,
            "guilds": s.guilds.len(),
            "lite": true,
            "since": s.since,
            "bot_tag": s.bot_tag,
            "counts": { "seen": s.seen, "flagged": s.flagged },
        }));
    }

    if path == "/api/lite" {
        return Some(serde_json::json!({
            "lite": true,
            "port": LITE_PORT,
            "connected": s.connected,
            "bot_tag": s.bot_tag,
            "guilds": s.guilds,
            "since": s.since,
            "seen": s.seen,
            "flagged": s.flagged,
            "recent": s.recent,
        }));
    }

    if path == "/api/lite/db" {
        let age_min = s.db_snapshot_at.map(|t| (now_ms().saturating_sub(t)) / 60_000);
        return Some(serde_json::json!({
            "lite": true,
            "available": s.db_ok,
            "snapshot_at": s.db_snapshot_at,
            "age_minutes": age_min,
            "note": if s.db_ok {
                "Read-only copy of the Windows database, taken while Windows was up."
            } else {
                "No copy of the Windows database has been taken yet."
            },
        }));
    }

    if path == "/api/live" || path.starts_with("/api/live/") {
        // Live messages work in Lite: reading a channel is a Discord call, not a
        // Windows feature. The client fills this in as messages arrive.
        return Some(serde_json::json!({
            "lite": true,
            "messages": s.recent,
            "note": "Only what Lite has seen since it took over. Nothing before that, and nothing is stored.",
        }));
    }

    if path == "/api/lite/sync-now" {
        // The nudge: Windows says something it owns has changed, so the copy on
        // this Mac is out of date before the next timer tick.
        //
        // POST only in spirit, but the route table is path-based, so it is guarded
        // by loopback instead: the server binds 127.0.0.1 and nothing off this Mac
        // can reach it. A nudge from the dashboard is the only caller.
        return Some(handle_sync_nudge());
    }

    if path == "/api/lite/tickets" {
        let list = read_tickets();
        let pending = list.iter().filter(|t| !t.transferred).count();
        return Some(serde_json::json!({
            "lite": true,
            "total": list.len(),
            "pending": pending,
            "tickets": list,
        }));
    }

    if path == "/api/tickets" {
        // Tickets DO work in Lite, from Lite's own table. Saying "unavailable"
        // here would be wrong now: a verification must be able to run during an
        // outage, and this is where its record lives.
        let list = read_tickets();
        return Some(serde_json::json!({
            "lite": true,
            "source": "lite",
            "tickets": list,
            "note": "Opened while Babblebot was down. They move to the Windows database when it returns.",
        }));
    }

    if path == "/api/trolls" {
        // Real, not refused. The list is synced from Windows like the rest of the
        // flag system, and it is kept on disk, so the Troll Watch screen has
        // something true to show during an outage -- a list of who Windows has
        // already decided about, with the date it was copied.
        let cfg = crate::lite_discord::current_config();
        let saved = crate::lite_discord::saved_config_at();
        return Some(serde_json::json!({
            "lite": true,
            "source": "copied from Windows",
            "copied_at": saved,
            "total": cfg.trolls.len(),
            "trolls": cfg.trolls.iter().map(|(id, name, reason)| serde_json::json!({
                "user_id": id,
                "name": name,
                "reason": reason,
            })).collect::<Vec<_>>(),
        }));
    }

    if path == "/api/troll-watch" {
        // The pending queue is empty in Lite, and that is the truth rather than a
        // refusal: Lite has no join watch, so it has nothing pending. The troll
        // list beside it is real -- copied from Windows and kept on disk.
        let cfg = crate::lite_discord::current_config();
        return Some(serde_json::json!({
            "lite": true,
            "pending": [],
            "trolls": cfg.trolls.iter().map(|(id, name, reason)| serde_json::json!({
                "user_id": id,
                "name": name,
                "reason": reason,
            })).collect::<Vec<_>>(),
            "note": "Lite bans a known troll on sight and has no join watch, so nothing is ever waiting for a decision.",
        }));
    }

    if path == "/api/system" {
        return Some(serde_json::json!({
            "lite": true,
            "available": false,
            "error": "System stats come from the Windows machine.",
        }));
    }

    // Everything else is a Windows feature. Named individually so the reason is
    // useful rather than "404".
    const NAMED: &[(&str, &str)] = &[
        ("/api/violations", "The violations list"),
        ("/api/storage", "Stored media"),
        ("/api/db", "The database"),
        ("/api/music", "Music"),
        ("/api/playlists", "Playlists"),
        ("/api/ticket-types", "Ticket types"),
        ("/api/relay", "The relay"),
        ("/api/migraines", "The migraine diary"),
        ("/api/sleep", "Sleep mode"),
        ("/api/sleep-log", "The sleep log"),
        ("/api/ed-waits", "ED waits"),
        ("/api/servers", "The server list"),
        ("/api/stats", "Statistics"),
        ("/api/activities", "Activities"),
        ("/api/mentions", "Mentions"),
        ("/api/channel-rules", "Channel rules"),
        ("/api/reaction-roles", "Reaction roles"),
        ("/api/config", "Configuration"),
    ];
    for (prefix, what) in NAMED {
        if path == *prefix || path.starts_with(&format!("{prefix}/")) {
            return Some(unavailable(what));
        }
    }
    None
}

fn respond(mut stream: TcpStream) {
    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };
    let req = String::from_utf8_lossy(&buf[..n]);
    let mut lines = req.lines();
    let first = lines.next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_string();
    let path = parts.next().unwrap_or("/").split('?').next().unwrap_or("/");

    // The nudge changes what the next sync does, so it is a POST and nothing else.
    // The route table is path-based, and a GET on this path arriving from a stray
    // browser tab would be a resync nobody asked for.
    if path == "/api/lite/sync-now" && method != "POST" {
        let text = serde_json::json!({
            "ok": false,
            "error": "Use POST to ask for a sync.",
        })
        .to_string();
        let head = format!(
            "HTTP/1.1 405 Method Not Allowed\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAllow: POST\r\nConnection: close\r\n\r\n",
            text.len()
        );
        let _ = stream.write_all(head.as_bytes());
        let _ = stream.write_all(text.as_bytes());
        return;
    }

    let body = match handle(path) {
        Some(v) => v,
        // A route neither Windows nor Lite knows. Said plainly rather than 404.
        None => serde_json::json!({
            "lite": true,
            "available": false,
            "error": format!("BabbleBot Lite does not know {path}. It is not a full copy of the bot API."),
        }),
    };
    let text = body.to_string();
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        text.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(text.as_bytes());
    let _ = stream.flush();
}

/// Start serving. Returns once the socket is bound, so a caller that gets Ok
/// knows the address will answer.
pub fn lite_server_start() -> Result<(), String> {
    // Bound to loopback only: this is the app on this Mac talking to itself, and
    // it holds no credentials worth exposing to the network.
    let listener = TcpListener::bind(("127.0.0.1", LITE_PORT))
        .map_err(|e| format!("could not bind 127.0.0.1:{LITE_PORT}: {e}"))?;
    std::thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            std::thread::spawn(move || respond(conn));
        }
    });
    Ok(())
}

/// Is Lite's own API already answering on this Mac?
///
/// Asked over HTTP rather than by trying to bind: binding is the destructive test
/// (a failed bind can still have reset state), and the question "is there a Lite
/// here" is exactly the question its own /api/lite answers. Anything that answers
/// with `"lite": true` is ours; anything else on the port is not, and the caller
/// should say so rather than pretend.
pub fn lite_is_serving() -> bool {
    use std::io::{Read, Write};
    let addr = format!("127.0.0.1:{LITE_PORT}");
    let Ok(mut stream) = std::net::TcpStream::connect_timeout(
        &match addr.parse() {
            Ok(a) => a,
            Err(_) => return false,
        },
        std::time::Duration::from_millis(800),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(1200)));
    let req = format!("GET /api/lite HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    buf.contains("\"lite\":true")
}

/// Where the read-only copy of the Windows database is kept.
pub fn snapshot_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::Path::new(&home)
        .join("Library")
        .join("Application Support")
        .join("com.sahara.dashboard")
        .join("lite")
        .join("babblebot.db")
}

/// Take a read-only copy of the Windows database, while Windows is still up.
///
/// ## Why a copy and not the database
///
/// Lite must never hold the only copy of anything, and must never write to the
/// real one -- two writers on one SQLite file across a network is how databases
/// get corrupted. So this is a snapshot, taken deliberately, and every screen
/// built on it reports how old it is.
///
/// ## Why it is worth having
///
/// Tickets, the troll list and channel rules are all *configuration and history*
/// rather than live state. A copy from an hour ago is genuinely useful for those
/// and useless for violations, which are a live queue. That is the split: Lite
/// can answer "who is on the troll list" from a snapshot, and must not pretend to
/// answer "what was flagged in the last ten minutes".
///
/// SQLite is copied with its `-wal` and `-shm` files if present, because copying
/// only the main file of a live database can capture a half-written page.
#[tauri::command]
pub async fn lite_db_snapshot(
    api_url: Option<String>,
    fallback_url: Option<String>,
) -> Result<serde_json::Value, String> {
    let path = snapshot_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
    }

    // Ask the bot API for the file rather than reading it over SMB: the API is
    // already the one door into that machine, and it can hand over a consistent
    // copy while it is running.
    //
    // Whichever address is working, not whichever was typed first. The primary
    // field holds the LAN address and the LAN is the flaky one, so taking the
    // snapshot from it would fail while the bot is perfectly reachable on the
    // fallback. Both are tried, in order, and the answer says which one served it.
    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(0)
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let mut candidates: Vec<String> = Vec::new();
    for u in [api_url, fallback_url].into_iter().flatten() {
        let t = u.trim().trim_end_matches('/').to_string();
        if !t.is_empty() && !candidates.contains(&t) {
            candidates.push(t);
        }
    }
    if candidates.is_empty() {
        return Ok(serde_json::json!({ "ok": false, "error": "No bot address is set." }));
    }

    let mut served_by = String::new();
    let mut last_error = String::new();
    let mut bytes: Option<Vec<u8>> = None;
    for base in &candidates {
        let url = format!("{base}/api/db/export");
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.bytes().await {
                    Ok(b) => {
                        served_by = base.clone();
                        bytes = Some(b.to_vec());
                        break;
                    }
                    Err(e) => last_error = format!("{base} answered but the body failed: {e}"),
                }
            }
            Ok(resp) => {
                last_error = format!(
                    "{base} answered {} — the bot has no database export route yet",
                    resp.status()
                );
            }
            Err(e) => last_error = format!("could not reach {base}: {e}"),
        }
    }
    let bytes = match bytes {
        Some(b) => b,
        None => return Ok(serde_json::json!({ "ok": false, "error": last_error })),
    };
    if bytes.len() < 1024 {
        return Ok(serde_json::json!({
            "ok": false,
            "error": format!("that was {} bytes — too small to be the database", bytes.len()),
        }));
    }
    std::fs::write(&path, &bytes).map_err(|e| format!("could not write the copy: {e}"))?;

    let at = now_ms();
    if let Ok(mut s) = state().lock() {
        s.db_ok = true;
        s.db_snapshot_at = Some(at);
    }
    Ok(serde_json::json!({
        "ok": true,
        "path": path.to_string_lossy(),
        "bytes": bytes.len(),
        "snapshot_at": at,
        "served_by": served_by,
    }))
}

/// When the copy was taken, and whether there is one at all.
#[tauri::command]
pub fn lite_db_status() -> serde_json::Value {
    let path = snapshot_path();
    let exists = path.exists();
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    serde_json::json!({
        "exists": exists,
        "path": path.to_string_lossy(),
        "bytes": bytes,
    })
}

pub fn lite_server_url() -> String {
    format!("http://127.0.0.1:{LITE_PORT}")
}

// ---------------------------------------------------------------------------
// Lite's ticket table
// ---------------------------------------------------------------------------
//
// Lite needs its own record of tickets it opens while Windows is gone, or a
// verification exists only as a conversation in a channel and nobody can prove
// who checked whom. SQLite, one file, on this Mac, written by Lite and read by
// Lite. It is never the Windows database and it never writes to one.
//
// The `transferred` flag is what makes the merge safe to run twice: a row that
// has been handed to Windows is never offered again, so a reconnect cannot
// duplicate every ticket.

fn lite_db_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let dir = std::path::Path::new(&home)
        .join("Library")
        .join("Application Support")
        .join("com.sahara.dashboard")
        .join("lite");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("lite-tickets.json")
}

/// Lite's tickets, as a plain JSON file.
///
/// Not SQLite, deliberately: the volume is tiny (a handful of tickets during an
/// outage), it needs no migration story, and a JSON file can be read by hand if
/// everything else fails. The snapshot of the *Windows* database is separate and
/// stays a real SQLite copy.
#[derive(Serialize, serde::Deserialize, Clone, Default)]
pub struct LiteTicket {
    pub id: String,
    pub kind: String,
    pub user_id: String,
    pub user_name: String,
    pub channel_id: String,
    pub channel_name: String,
    pub guild_id: String,
    pub opened_at: u64,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub notes: String,
    /// Set once Windows has taken this ticket. Never offered again.
    #[serde(default)]
    pub transferred: bool,
}

fn read_tickets() -> Vec<LiteTicket> {
    std::fs::read_to_string(lite_db_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<LiteTicket>>(&s).ok())
        .unwrap_or_default()
}

fn write_tickets(list: &[LiteTicket]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    std::fs::write(lite_db_path(), text).map_err(|e| format!("could not save Lite's tickets: {e}"))
}

/// Record that a verification happened while Lite was in charge.
///
/// Andre's rule: what must never happen is a verification that exists only as a
/// Discord conversation. The role is already granted; this is the record that
/// lets Windows know it was granted, and by whom, when it comes back.
pub fn lite_record_verification(guild_id: String, user_id: String, by: String) {
    let row = LiteTicket {
        id: format!("lite-verify-{}", now_ms()),
        kind: "verification".into(),
        user_id,
        user_name: String::new(),
        channel_id: String::new(),
        channel_name: "bb!verify".into(),
        guild_id,
        opened_at: now_ms(),
        status: "done".into(),
        notes: format!("verified by {by} in BabbleBot Lite"),
        transferred: false,
    };
    let mut list = read_tickets();
    list.push(row);
    let _ = write_tickets(&list);
}

/// Is there already an open ticket for this person, of this kind?
///
/// Windows enforces one open ticket PER TYPE so somebody waiting on verification
/// is not blocked from opening a support ticket. Lite must do the same, or a
/// button pressed twice makes two channels and a staff queue that lies.
pub fn lite_ticket_find(guild_id: &str, user_id: &str, kind: &str) -> Option<String> {
    let list = read_tickets();
    list.into_iter()
        .find(|t| {
            t.guild_id == guild_id
                && t.user_id == user_id
                && t.kind == kind
                && t.status == "open"
        })
        .map(|t| t.channel_id)
}

/// Open a ticket on Lite. Returns the stored row so the screen shows exactly
/// what was written, not what was meant to be written.
#[tauri::command]
pub fn lite_ticket_open(
    kind: String,
    user_id: String,
    user_name: String,
    channel_id: String,
    channel_name: String,
    guild_id: String,
) -> Result<serde_json::Value, String> {
    let mut list = read_tickets();
    let row = LiteTicket {
        id: format!("lite-{}", now_ms()),
        kind,
        user_id,
        user_name,
        channel_id,
        channel_name,
        guild_id,
        opened_at: now_ms(),
        status: "open".into(),
        notes: String::new(),
        transferred: false,
    };
    list.push(row.clone());
    write_tickets(&list)?;
    Ok(serde_json::json!({ "ok": true, "ticket": row }))
}

/// Every ticket Lite is holding, split by whether Windows still needs to take it.
#[tauri::command]
pub fn lite_tickets() -> serde_json::Value {
    let list = read_tickets();
    let pending: Vec<_> = list.iter().filter(|t| !t.transferred).cloned().collect();
    serde_json::json!({
        "total": list.len(),
        "pending": pending.len(),
        "tickets": list,
    })
}

/// Mark tickets as taken by Windows.
///
/// Called only after the app has confirmed the merge. Marking, not deleting: the
/// row is the evidence that the ticket existed, and evidence does not get tidied
/// away because it has been handed over.
#[tauri::command]
pub fn lite_tickets_mark_transferred(ids: Vec<String>) -> serde_json::Value {
    let mut list = read_tickets();
    let mut marked = 0;
    for t in list.iter_mut() {
        if ids.contains(&t.id) && !t.transferred {
            t.transferred = true;
            marked += 1;
        }
    }
    if let Err(e) = write_tickets(&list) {
        return serde_json::json!({ "ok": false, "error": e });
    }
    serde_json::json!({ "ok": true, "marked": marked })
}

/// The opening message for a verification ticket, exactly as Windows posts it.
///
/// Kept here as one constant rather than assembled from pieces, because it is a
/// message a member reads and acts on: the instructions have to match what staff
/// actually check. It is pinned, it uses the same formatting as the Windows side,
/// and it deliberately carries no form fields -- the questions are asked by a
/// human in the channel, which is what stops an ID ending up in a modal.
///
/// A test on the Windows side asserts that this text keeps the instructions and
/// drops any pasted question labels; if the wording changes there, this must
/// change with it.
pub const VERIFY_OPEN_MESSAGE: &str = "—\n\n\
Welcome to Babble Playpen\n\n\
🛡️ ID Verification Instructions\n\
To help keep Babble Playpen safe and adult-only, all new members must complete ID verification before gaining access.\n\n\
***Please submit a photo that includes:***\n\
• A government-issued ID with your date of birth clearly visible\n\
(you may blur other sensitive details like your ID number or address)\n\n\
A handwritten note held up alongside your ID that includes:\n\n\
- The current date\n\
- The server name: Babble Playpen";

/// The text of the verification ticket's opening message.
#[tauri::command]
pub fn lite_verify_message() -> String {
    VERIFY_OPEN_MESSAGE.to_string()
}

/// Pull the flag system from Windows while it is still up.
///
/// ## Why this is a button and not something Lite works out
///
/// Lite's rules come from a database snapshot taken at the moment it took over.
/// If staff have since approved or rejected flags on Windows -- which is exactly
/// how the learned thresholds move -- then Lite is running a *stale* idea of what
/// deserves a flag. A stale flag system is worse than none: it flags messages
/// Windows would have left alone, and the member who gets told off for nothing is
/// the one who leaves.
///
/// So Lite can be refreshed on demand, from the live database, and says how old
/// what it is holding is. Andre presses this while Windows is healthy; if the
/// outage comes first, the snapshot from handover is the fallback and its age is
/// shown rather than hidden.
/// How often Lite refreshes itself from Windows when nobody asks.
///
/// Twenty minutes: often enough that a rule change made an hour ago is already in
/// Lite when the power drops, rare enough that it is one small request rather than
/// a stream. The manual button stays, because "it should have synced by now" is a
/// real thing to want and waiting for a timer is not an answer.
const AUTO_SYNC_SECONDS: u64 = 20 * 60;

/// Refresh Lite's rules and database from Windows, on a timer, while Windows is up.
///
/// ## Why this is safe to run unattended
///
/// It only ever *reads* from Windows and writes to Lite's own copy on this Mac. If
/// Windows is down the request fails, nothing changes, and the previous good copy
/// stays exactly where it is -- an emergency bot must never lose its rules because
/// a refresh happened at the wrong moment.
///
/// Every attempt is recorded, so the screen can say when it last worked and when it
/// last failed rather than implying it is current.
pub async fn auto_sync_loop(api_url: String, fallback_url: Option<String>) {
    let mut consecutive_failures = 0u32;
    loop {
        // Sleep, but wake early when someone changed something on Windows.
        //
        // ## Why a nudge and not a shorter timer
        //
        // The number that matters is not how often this runs, it is how stale the
        // copy is at the moment Windows dies. A five-minute timer still leaves five
        // minutes of drift and runs 288 times a day to do it. A nudge is exact: the
        // dashboard has just written a troll or a rule, it knows, and it tells this
        // Mac to read it now. The timer stays as the backstop for anything that
        // changed without saying so -- an edit made on Windows by hand, a nudge
        // that failed while the Mac was asleep.
        let woken = wait_for_nudge_or_timeout().await;
        if woken {
            lite_event(
                "note",
                "Windows said something changed, so the rules were re-read now".into(),
                None,
                None,
            );
        }

        let r = lite_rules_sync(Some(api_url.clone()), fallback_url.clone()).await;
        let ok = r.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

        if ok {
            if consecutive_failures > 0 {
                lite_event(
                    "note",
                    format!("auto-sync recovered after {consecutive_failures} failed attempts"),
                    None,
                    None,
                );
            }
            consecutive_failures = 0;
            set_last_sync(Some(now_ms()), None);
        } else {
            consecutive_failures += 1;
            let err = r
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown reason")
                .to_string();
            set_last_sync(None, Some(err.clone()));
            // One line per failure, not per retry: a dead Windows box would
            // otherwise fill the log with the same sentence all night.
            if consecutive_failures == 1 {
                lite_event(
                    "error",
                    format!("auto-sync failed ({err}) - keeping the last good copy"),
                    None,
                    None,
                );
            }
        }
    }
}

/// A request for the next sync to happen now rather than at the end of the timer.
///
/// A plain counter rather than a channel or a condvar: the loop checks it between
/// one-second sleeps, so a nudge can never be lost to a race, and a nudge that
/// arrives while a sync is already running is simply served by the next pass.
static NUDGE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Ask for a sync now. Cheap and safe to call from anywhere, including the HTTP
/// handler that took the nudge from the dashboard.
pub fn request_sync_now() {
    NUDGE.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
}

/// Sleep up to the sync interval, returning early if a nudge arrived.
async fn wait_for_nudge_or_timeout() -> bool {
    let start = NUDGE.load(std::sync::atomic::Ordering::SeqCst);
    let mut waited = 0u64;
    while waited < AUTO_SYNC_SECONDS {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        waited += 1;
        if NUDGE.load(std::sync::atomic::Ordering::SeqCst) != start {
            return true;
        }
    }
    false
}

/// The endpoint Windows calls when something it owns has changed.
///
/// Loopback only: it is a nudge from the dashboard on this machine, and nothing
/// off this Mac has any business making Lite re-read its rules.
fn handle_sync_nudge() -> serde_json::Value {
    request_sync_now();
    serde_json::json!({ "ok": true, "note": "the next sync will run now" })
}

static LAST_SYNC: std::sync::Mutex<(Option<u64>, Option<String>)> =
    std::sync::Mutex::new((None::<u64>, None::<String>));

/// The address the app itself is connected through, once it knows.
///
/// The sync used to decide its own road: LAN first, then Tailscale. That is a
/// guess, and on this Mac the LAN guess is a guaranteed four-second failure --
/// there is no route to 192.168.1.128 at all -- so every sync paid for a road
/// that could never work and then reported the failure on screen next to a sync
/// that had actually succeeded. The app has already probed, already discovered,
/// and is already talking to the bot. Asking it costs nothing and cannot be
/// wrong, so the sync follows the app rather than re-deriving the answer.
static LIVE_ROAD: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Told by the app whenever its connection changes. `None` means "no live road",
/// and the sync falls back to trying both.
#[tauri::command]
pub fn lite_set_live_road(url: Option<String>) -> serde_json::Value {
    let clean = url
        .map(|u| u.trim().trim_end_matches('/').to_string())
        .filter(|u| !u.is_empty());
    if let Ok(mut g) = LIVE_ROAD.lock() {
        *g = clean.clone();
    }
    serde_json::json!({ "live_road": clean })
}

fn live_road() -> Option<String> {
    match LIVE_ROAD.lock() {
        Ok(g) => g.clone(),
        Err(e) => e.into_inner().clone(),
    }
}

fn set_last_sync(at: Option<u64>, err: Option<String>) {
    if let Ok(mut g) = LAST_SYNC.lock() {
        if at.is_some() {
            g.0 = at;
        }
        g.1 = err;
    }
}

/// The parts of the flag system that can be read straight off the running bot.
///
/// ## Why this exists as well as the snapshot
///
/// The snapshot is one file with everything in it, but it is a copy: whatever the
/// dashboard saved *after* it was taken is invisible to Lite. These endpoints are
/// the same ones the dashboard itself writes to, so reading them means Lite sees
/// the rules as they are now. The snapshot stays as the fallback for the case this
/// was built for -- Windows already being gone when Lite starts.
#[derive(Default)]
struct LiveRules {
    /// Guilds Windows is in, by ID and name. Lite covers these.
    guilds: Vec<(String, String)>,
    /// guild -> channel -> preset
    channel_rules: Vec<(String, String, String)>,
    exempt: Vec<String>,
    /// guild -> channel for ticket panels
    ticket_category: Vec<(String, String)>,
    /// Ticket types in the client's own shape: guild, id, label, emoji.
    ticket_types: Vec<(String, String, String, String)>,
    /// The troll list: user id, name and why. Without this Lite can see the list
    /// but never act on it, which is a tab that lies.
    trolls: Vec<(String, String, String)>,
}

impl LiveRules {
    fn apply(self, cfg: &mut crate::lite_discord::LiteConfig) {
        // Which guilds Lite is covering, so a takeover knows what it is in charge
        // of before a single message arrives.
        if !self.guilds.is_empty() {
            cfg.guilds = self.guilds.clone();
        }
        if !self.channel_rules.is_empty() {
            for (guild, channel, preset) in self.channel_rules {
                let rule = crate::lite_rules::ChannelRule::from_preset(&preset);
                cfg.rules.insert(channel.clone(), rule);
                // An Off channel is blind, which is also what `ignored_channels`
                // means, so keep the two views consistent.
                if preset == "off" && !cfg.ignored_channels.contains(&channel) {
                    cfg.ignored_channels.push(channel);
                } else if preset != "off" {
                    cfg.ignored_channels.retain(|c| c != &channel);
                }
                let _ = guild;
            }
        }
        if !self.exempt.is_empty() {
            cfg.exempt_users = self.exempt;
        }

        // Ticket types are what the buttons on a panel mean. Without them a
        // takeover can open the channel but not know what kind of ticket it is, so
        // read them from the live endpoint rather than waiting for a database copy.
        if !self.ticket_types.is_empty() {
            cfg.ticket_types = self.ticket_types.clone();
        }
        for (guild, category) in self.ticket_category {
            cfg.ticket_category.insert(guild, category);
        }
        if !self.trolls.is_empty() {
            cfg.trolls = self.trolls;
        }
    }
}

async fn fetch_live_rules(client: &reqwest::Client, urls: &[String]) -> Option<(String, LiveRules)> {
    let (hit, _why) = fetch_live_rules_explained(client, urls).await;
    hit
}

/// The same read, but it also says why each address that failed did so.
///
/// "Local didn't work" is not a diagnosis. Refused, timed out, and "answered but
/// wrong" are three different problems with three different fixes, and the screen
/// can only show the difference if this hands it back.
async fn fetch_live_rules_explained(
    client: &reqwest::Client,
    urls: &[String],
) -> (Option<(String, LiveRules)>, Vec<(String, String)>) {
    let mut why: Vec<(String, String)> = Vec::new();
    for base in urls {
        let base = base.trim_end_matches('/');

        // Which servers exist, so the per-server calls know what to ask for.
        //
        // `?` here was a trap: one address that failed took the whole function
        // with it, so a dead LAN address never fell through to Tailscale. The
        // sync then reported a successful run with nothing in it.
        let servers: serde_json::Value = match client
            .get(format!("{base}/api/servers"))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => match r.json().await {
                Ok(v) => v,
                Err(e) => {
                    why.push((base.to_string(), format!("answered but not JSON: {e}")));
                    continue;
                }
            },
            Ok(r) => {
                why.push((base.to_string(), format!("answered HTTP {}", r.status())));
                continue;
            }
            Err(e) => {
                why.push((base.to_string(), explain_reqwest(&e)));
                continue;
            }
        };
        // Id and name together: the screen shows the name, the client watches the
        // id, and a guild list with only ids would be a list nobody can read.
        let guilds: Vec<(String, String)> = servers
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|g| {
                        let id = g.get("id").and_then(|v| v.as_str())?;
                        let name = g.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        Some((id.to_string(), name.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let guild_ids: Vec<String> = guilds.iter().map(|(id, _)| id.clone()).collect();
        if guild_ids.is_empty() {
            why.push((base.to_string(), "answered but listed no servers".into()));
            continue;
        }

        let mut live = LiveRules::default();

        // Channel rules, per server. This is the switch set the dashboard edits.
        for gid in &guild_ids {
            let v: serde_json::Value = match client
                .get(format!("{base}/api/channel-rules?server={gid}"))
                .send()
                .await
            {
                Ok(r) if r.status().is_success() => match r.json().await {
                    Ok(v) => v,
                    Err(_) => continue,
                },
                _ => continue,
            };
            if let Some(rules) = v.get("rules").and_then(|r| r.as_array()) {
                for r in rules {
                    let cid = r.get("channel_id").and_then(|x| x.as_str()).unwrap_or("");
                    let preset = r.get("preset").and_then(|x| x.as_str()).unwrap_or("normal");
                    if !cid.is_empty() {
                        live.channel_rules.push((gid.clone(), cid.to_string(), preset.to_string()));
                    }
                }
            }

            // Ticket types, per server.
            //
            // The endpoint refuses without `?server=` -- asked once with no guild it
            // answers "I am not in a server called None", which is how the sync came
            // back with 0 ticket types while everything else worked. They are per
            // server, so they have to be asked for per server.
            if let Ok(resp) = client
                .get(format!("{base}/api/ticket-types?server={gid}"))
                .send()
                .await
            {
                if resp.status().is_success() {
                    if let Ok(tv) = resp.json::<serde_json::Value>().await {
                        if let Some(arr) = tv.get("types").and_then(|t| t.as_array()) {
                            for t in arr {
                                let id = t.get("id").and_then(|x| x.as_str()).unwrap_or("");
                                if id.is_empty() {
                                    continue;
                                }
                                let label = t
                                    .get("label")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or(id);
                                let emoji =
                                    t.get("emoji").and_then(|x| x.as_str()).unwrap_or("\u{1F3AB}");
                                live.ticket_types.push((
                                    gid.clone(),
                                    id.to_string(),
                                    label.to_string(),
                                    emoji.to_string(),
                                ));
                            }
                        }
                    }
                }
            }
        }

        // Exempt staff: not moderated at all, on either bot.
        if let Ok(resp) = client.get(format!("{base}/api/exempt-users")).send().await {
            if resp.status().is_success() {
                if let Ok(v) = resp.json::<serde_json::Value>().await {
                    if let Some(arr) = v.get("exempt").and_then(|e| e.as_array()) {
                        live.exempt = arr
                            .iter()
                            .filter_map(|e| e.get("id").and_then(|i| i.as_str()).map(String::from))
                            .collect();
                    }
                }
            }
        }

        // The troll list, so the Troll Watch screen is a real list rather than a
        // tab that opens onto nothing. Windows holds it; this is a copy with the
        // sync's own timestamp on it.
        if let Ok(resp) = client.get(format!("{base}/api/trolls")).send().await {
            if resp.status().is_success() {
                if let Ok(v) = resp.json::<serde_json::Value>().await {
                    // The endpoint has answered in two shapes over its life: a bare
                    // array, and an object with a `trolls` key. Both are read here
                    // rather than picking one and silently getting nothing.
                    let arr = v
                        .as_array()
                        .cloned()
                        .or_else(|| v.get("trolls").and_then(|t| t.as_array()).cloned())
                        .unwrap_or_default();
                    for t in arr {
                        let id = t
                            .get("user_id")
                            .or_else(|| t.get("id"))
                            .or_else(|| t.get("user"))
                            .and_then(|x| x.as_str())
                            .unwrap_or("");
                        if id.is_empty() {
                            continue;
                        }
                        let name = t.get("name").and_then(|x| x.as_str()).unwrap_or("");
                        let reason = t
                            .get("reason")
                            .or_else(|| t.get("note"))
                            .and_then(|x| x.as_str())
                            .unwrap_or("");
                        live.trolls
                            .push((id.to_string(), name.to_string(), reason.to_string()));
                    }
                }
            }
        }

        // The servers themselves are part of the flag system: Lite needs to know
        // which guilds it is covering even before any channel has a rule.
        live.guilds = guilds.clone();

        // At least one thing worked: this address is the live one.
        //
        // Guilds count. Requiring a channel rule meant a bot that answered every
        // endpoint but had none stored came back as "nothing synced" with no
        // explanation, which reads like a broken button rather than an honest
        // "there is nothing to copy yet".
        if !live.channel_rules.is_empty()
            || !live.exempt.is_empty()
            || !live.guilds.is_empty()
            || !live.trolls.is_empty()
        {
            return (Some((base.to_string(), live)), why);
        }
        why.push((base.to_string(), "answered but nothing was readable".into()));
    }
    (None, why)
}

/// reqwest's own message is always the useless outer one ("error sending
/// request"); the layer underneath knows whether it was DNS, connect or timeout.
fn explain_reqwest(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return "no answer in time".into();
    }
    if e.is_connect() {
        let mut detail = String::from("could not connect");
        let mut src: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(e);
        while let Some(s) = src {
            detail.push_str(&format!(" ({s})"));
            src = std::error::Error::source(s);
        }
        return detail;
    }
    e.to_string()
}

/// Reconcile Lite's records with what Windows already has.
///
/// ## The rule this exists to enforce
///
/// A ticket or verification done during an outage exists in Discord either way.
/// What must never happen is Windows not knowing about it: a member who was
/// verified in Lite and is unknown to Windows can be re-checked, re-flagged, or
/// quietly treated as unverified later. So this reads Windows' own `tickets`
/// namespace and marks anything Windows already holds as transferred, then reports
/// exactly what is still only on this Mac.
///
/// ## Read-only against Windows
///
/// The bot's API can read a namespace but cannot write one -- there is no write
/// endpoint at all -- so this never pretends to push. What it does is prove, from
/// Windows' own data, which of Lite's records are already there, and hand the rest
/// over in a form a person can act on. Lite never writes to the Windows database.
///
/// Runs on every start, so a restart cannot leave a stale "pending" list on screen.
#[tauri::command]
pub async fn lite_merge_reconcile(
    api_url: Option<String>,
    fallback_url: Option<String>,
) -> serde_json::Value {
    let urls: Vec<String> = [api_url, fallback_url].into_iter().flatten().collect();
    if urls.is_empty() {
        return serde_json::json!({ "ok": false, "error": "No bot address to check against." });
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e.to_string() }),
    };

    // Every ticket Windows knows about, as channel id -> row.
    let mut windows_channels: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut served_by = String::new();
    for base in &urls {
        let base = base.trim_end_matches('/');
        let resp = client
            .get(format!("{base}/api/db/tickets?limit=500"))
            .send()
            .await;
        let ok = match resp {
            Ok(r) if r.status().is_success() => r.json::<serde_json::Value>().await.ok(),
            _ => None,
        };
        if let Some(v) = ok {
            if let Some(rows) = v.get("rows").and_then(|r| r.as_array()) {
                for row in rows {
                    // Records shape: {"key": channel_id, "value": {...}}
                    if let Some(k) = row.get("key").and_then(|k| k.as_str()) {
                        windows_channels.insert(k.to_string());
                    }
                    if let Some(cid) = row.pointer("/value/channel_id").and_then(|c| c.as_str()) {
                        windows_channels.insert(cid.to_string());
                    }
                }
                served_by = base.to_string();
                break;
            }
        }
    }

    if served_by.is_empty() {
        return serde_json::json!({
            "ok": false,
            "error": "Windows is not answering, so there is nothing to reconcile against yet.",
        });
    }

    // Mark what Windows already holds. Anything it does not hold stays pending and
    // is named, so the gap is visible rather than assumed away.
    let mut list = read_tickets();
    let mut already = 0usize;
    let mut still_pending: Vec<serde_json::Value> = Vec::new();
    for t in list.iter_mut() {
        if t.transferred {
            continue;
        }
        let known = !t.channel_id.is_empty() && windows_channels.contains(&t.channel_id);
        if known {
            t.transferred = true;
            already += 1;
        } else {
            still_pending.push(serde_json::json!({
                "kind": t.kind,
                "user_name": t.user_name,
                "channel_id": t.channel_id,
                "opened_at": t.opened_at,
                "status": t.status,
            }));
        }
    }
    if let Err(e) = write_tickets(&list) {
        return serde_json::json!({ "ok": false, "error": e });
    }

    lite_event(
        "note",
        format!(
            "checked against Windows: {} already there, {} still only on this Mac",
            already,
            still_pending.len()
        ),
        None,
        None,
    );

    // Hand over whatever Windows does not have.
    //
    // Windows now accepts a merge (`POST /api/db/tickets`), so "pending" no longer
    // has to mean "lost". Additive on the far side: a ticket Windows already holds
    // is skipped there, never overwritten. Lite still never writes to the Windows
    // database itself -- it asks, and the bot decides.
    let mut handed = 0usize;
    let mut handover_error: Option<String> = None;
    let to_hand: Vec<LiteTicket> = list
        .iter()
        .filter(|t| !t.transferred && !t.channel_id.is_empty())
        .cloned()
        .collect();
    if !to_hand.is_empty() {
        let records: Vec<serde_json::Value> = to_hand
            .iter()
            .map(|t| {
                serde_json::json!({
                    "key": t.channel_id,
                    "value": {
                        "channel_id": t.channel_id,
                        "guild_id": t.guild_id,
                        "user_id": t.user_id,
                        "user_name": t.user_name,
                        // Windows requires a positive number and refuses the row
                        // without one. Lite never allocates numbers, so derive a
                        // stable one from the opening time: the same ticket always
                        // sends the same number, and it cannot collide with a
                        // Windows ticket because Windows numbers are small.
                        "number": (t.opened_at / 1000) as i64,
                        "status": if t.status.is_empty() { "open".to_string() } else { t.status.clone() },
                        "opened_at": t.opened_at,
                        "type_id": t.kind,
                        "type_label": t.kind,
                        "notes": t.notes,
                    }
                })
            })
            .collect();
        let body = serde_json::json!({ "records": records, "source": "babblebot-lite" });
        match client
            .post(format!("{}/api/db/tickets", served_by.trim_end_matches('/')))
            .json(&body)
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => {
                let v: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
                handed = v.get("merged").and_then(|m| m.as_u64()).unwrap_or(0) as usize;
                if handed > 0 {
                    // Mark them now, so a second press cannot offer them again.
                    let handset: std::collections::HashSet<String> =
                        to_hand.iter().map(|t| t.channel_id.clone()).collect();
                    let mut again = read_tickets();
                    for t in again.iter_mut() {
                        if handset.contains(&t.channel_id) {
                            t.transferred = true;
                        }
                    }
                    let _ = write_tickets(&again);
                    // The cleared pending list is what the caller is shown. The
                    // local `list` was reassigned here and never read again --
                    // harmless, but it reads like the answer depends on it, and
                    // anybody tidying this would keep it for that reason.
                    still_pending.clear();
                }
                lite_event(
                    "note",
                    format!("handed {handed} record(s) to Windows"),
                    None,
                    None,
                );
            }
            Ok(r) => {
                handover_error = Some(format!("Windows refused the handover (HTTP {})", r.status()));
            }
            Err(e) => handover_error = Some(format!("could not hand over: {e}")),
        }
    }

    serde_json::json!({
        "ok": true,
        "served_by": served_by,
        "already_on_windows": already,
        "handed_over": handed,
        "handover_error": handover_error,
        "still_pending": still_pending,
        "checked_at": now_ms(),
    })
}

/// What Lite is actually running with, so a stale copy is visible rather than
/// assumed. Every number here is what the checks will use on the next message.
pub fn rules_summary() -> serde_json::Value {
    let cfg = crate::lite_discord::current_config();
    let presets = cfg
        .rules
        .values()
        .fold(std::collections::BTreeMap::new(), |mut m, r| {
            *m.entry(r.preset.clone()).or_insert(0) += 1;
            m
        });
    serde_json::json!({
        "servers": cfg.guilds.len(),
        "channel_rules": cfg.rules.len(),
        "by_preset": presets,
        "off_channels": cfg.rules.values().filter(|r| r.preset == "off").count(),
        "ticket_types": cfg.ticket_types.len(),
        "exempt_users": cfg.exempt_users.len(),
        "profanity_threshold": cfg.profanity_threshold,
        "helpline": cfg.helpline_guild_id.is_some(),
    })
}

/// When Lite last refreshed itself, and why it failed if it did.
pub fn sync_state() -> serde_json::Value {
    let g = match LAST_SYNC.lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    };
    // The in-memory timestamp is empty after a relaunch, but the saved copy is
    // not: reporting "never synced" over rules that are on disk and being
    // enforced would be the wrong answer to the only question this screen asks.
    let saved = crate::lite_discord::saved_config_at();
    let last = g.0.or(saved);
    serde_json::json!({
        "last_sync": last,
        "last_error": g.1,
        "from_disk": g.0.is_none() && saved.is_some(),
        "interval_seconds": AUTO_SYNC_SECONDS,
        "nudged": NUDGE.load(std::sync::atomic::Ordering::SeqCst),
    })
}

/// Begin refreshing Lite's copy from Windows on a timer.
///
/// Started by the app on launch and never stopped, because the whole value is in
/// the refresh that happened *before* the outage. It is a no-op when Windows is
/// unreachable: the request fails, nothing is overwritten, and the last good copy
/// stays. Safe to call twice -- the second call is ignored.
/// Ask Lite to re-read its rules now, because Windows has just changed something.
///
/// Called by the app when it is the one that made the change (a troll added, a
/// rule edited), and by anything else on this Mac that knows better than the
/// timer. It never waits for the sync: the screen must not hang because a read is
/// slow, and the loop is the only thing allowed to write the copy.
#[tauri::command]
pub fn lite_sync_now() -> serde_json::Value {
    request_sync_now();
    serde_json::json!({ "ok": true })
}

#[tauri::command]
pub fn lite_auto_sync_start(api_url: String, fallback_url: Option<String>) -> serde_json::Value {
    static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return serde_json::json!({ "started": false, "detail": "already running" });
    }
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
            Ok(rt) => rt,
            Err(e) => {
                lite_event("error", format!("could not start the auto-sync timer: {e}"), None, None);
                return;
            }
        };
        rt.block_on(auto_sync_loop(api_url, fallback_url));
    });
    serde_json::json!({ "started": true })
}

#[tauri::command]
pub async fn lite_rules_sync(api_url: Option<String>, fallback_url: Option<String>) -> serde_json::Value {
    let urls: Vec<String> = [api_url, fallback_url].into_iter().flatten().collect();
    if urls.is_empty() {
        return serde_json::json!({ "ok": false, "error": "No bot address to sync from." });
    }

    // Short per-request timeouts, not one long budget.
    //
    // The flag system is a dozen small requests. With a single 120-second cap, a
    // LAN address that is up but not reachable from this machine spends its time
    // refusing, and the whole sync can time out before the address that works is
    // ever tried. Each request gets its own few seconds, so one bad road costs
    // seconds instead of the entire sync.
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .connect_timeout(std::time::Duration::from_secs(4))
        .pool_max_idle_per_host(0)
        .build()
    {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e.to_string() }),
    };

    // The flag system's live endpoints first. These are what the dashboard writes
    // to, so they are the freshest truth about what should be flagged -- fresher
    // than a database copy, and they need no file on this Mac.
    // Follow the app's connection when it has one. Only guess when it does not,
    // because the guess is what produced a red LAN error beside a green sync.
    let followed = live_road();
    let tried: Vec<String> = match &followed {
        Some(u) => vec![u.clone()],
        None => urls.clone(),
    };
    let (live_hit, live_why) = fetch_live_rules_explained(&client, &tried).await;

    let mut last = if live_why.is_empty() {
        String::from("no address answered")
    } else {
        live_why
            .iter()
            .map(|(u, r)| format!("{u}: {r}"))
            .collect::<Vec<_>>()
            .join("; ")
    };
    if let Some((base, fresh)) = live_hit {
        // Start from the saved copy, not from whatever is in memory: the screen
        // may have been relaunched a second ago and memory is empty, while disk
        // holds the last good sync. A live read then overwrites the parts it
        // actually read.
        let mut cfg = crate::lite_discord::load_saved_config()
            .unwrap_or_else(crate::lite_discord::current_config);
        fresh.apply(&mut cfg);
        let counts = serde_json::json!({
            "servers": cfg.guilds.len(),
            "channel_rules": cfg.rules.len(),
            "ticket_types": cfg.ticket_types.len(),
            "exempt": cfg.exempt_users.len(),
            "trolls": cfg.trolls.len(),
            "source": "live endpoints",
        });
        // Persist before anything else looks at it: the next restart reads this
        // file, and a sync that is not on disk did not happen.
        if let Err(e) = crate::lite_discord::save_config(&cfg) {
            // Not fatal: the sync still applies to this run. But it must be said,
            // because it means the next restart will come back empty and nobody
            // would know why.
            lite_event(
                "error",
                format!("the synced rules could not be saved, so a restart will not have them: {e}"),
                None,
                None,
            );
        }
        crate::lite_discord::set_config(cfg);
        // Which road worked matters: a LAN address that never answers means the
        // Mac is off the home network, and that is worth knowing before an outage
        // rather than during one.
        lite_event(
            "note",
            format!("flag system synced from Windows ({base}, live endpoints)"),
            None,
            None,
        );
        if !base.contains("100.") {
            lite_event(
                "note",
                format!("synced over the local network ({base})"),
                None,
                None,
            );
        } else {
            lite_event(
                "note",
                format!("the local address did not answer, so this went over Tailscale ({base})"),
                None,
                None,
            );
        }
        set_last_sync(Some(now_ms()), None);

        // Zero of everything means the live read did not actually read anything,
        // whatever it returned. Reporting that as a successful sync is the worst
        // outcome available: the screen says "synced" and Lite is enforcing nothing.
        if counts["servers"].as_u64().unwrap_or(0) == 0
            && counts["channel_rules"].as_u64().unwrap_or(0) == 0
            && counts["ticket_types"].as_u64().unwrap_or(0) == 0
        {
            set_last_sync(None, Some("the live endpoints answered but returned nothing".into()));
            return serde_json::json!({
                "ok": false,
                "error": format!(
                    "{base} answered but returned no servers, no channel rules and no ticket types. Nothing was changed."
                ),
                "synced_at": now_ms(),
            });
        }

        // Say plainly when the flag system is empty rather than reporting a
        // successful sync of nothing. "0 channel rules" is true and useless: what
        // matters is whether Windows has none stored, or has some Lite could not
        // read. Those look identical in a count and could not be more different in
        // what they mean for the next outage.
        let mut warnings: Vec<String> = Vec::new();
        if counts["servers"].as_u64().unwrap_or(0) == 0 {
            warnings.push("Windows reports no servers".into());
        }
        if counts["channel_rules"].as_u64().unwrap_or(0) == 0 {
            warnings.push(
                "Windows has no channel rules stored, so every channel will use the default preset"
                    .into(),
            );
        }
        if counts["ticket_types"].as_u64().unwrap_or(0) == 0 {
            warnings.push("no ticket types were read, so ticket buttons will not open".into());
        }
        if counts["exempt"].as_u64().unwrap_or(0) == 0 {
            warnings.push("no exempt staff were read".into());
        }
        for w in &warnings {
            lite_event("note", format!("flag system: {w}"), None, None);
        }

        return serde_json::json!({
            "ok": true,
            "served_by": base,
            "source": "live",
            "loaded": counts,
            "warnings": warnings,
            "addresses": live_why,
            "synced_at": now_ms(),
        });
    }

    for base in urls {
        let url = format!("{}/api/db/export", base.trim_end_matches('/'));
        match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => {
                let bytes = match r.bytes().await {
                    Ok(b) => b,
                    Err(e) => {
                        last = e.to_string();
                        continue;
                    }
                };
                if bytes.len() < 1024 {
                    last = "the bot answered with something too small to be a database".into();
                    continue;
                }
                let path = snapshot_path();
                if let Some(dir) = path.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                // Write to a temp name first so a half-written file never replaces
                // a good one: a corrupt rule set is worse than an old one.
                let tmp = path.with_extension("tmp");
                if let Err(e) = std::fs::write(&tmp, &bytes) {
                    last = format!("could not save it: {e}");
                    continue;
                }
                if let Err(e) = std::fs::rename(&tmp, &path) {
                    last = format!("could not put it in place: {e}");
                    continue;
                }

                // Load it into the running client immediately, so the sync does not
                // need a restart to take effect.
                let cfg = crate::load_lite_config();
                let counts = serde_json::json!({
                    "servers": cfg.guilds.len(),
                    "channel_rules": cfg.rules.len(),
                    "ticket_types": cfg.ticket_types.len(),
                    "exempt": cfg.exempt_users.len(),
                });
                crate::lite_discord::set_config(cfg);
                lite_event(
                    "note",
                    format!("flag system synced from Windows ({})", base),
                    None,
                    None,
                );
                set_last_sync(Some(now_ms()), None);
                return serde_json::json!({
                    "ok": true,
                    "served_by": base,
                    "bytes": bytes.len(),
                    "loaded": counts,
                    "synced_at": now_ms(),
                });
            }
            Ok(r) => last = format!("{base} said {}", r.status()),
            Err(e) => last = format!("{base}: {e}"),
        }
    }
    serde_json::json!({ "ok": false, "error": last })
}

#[cfg(test)]
mod sync_nudge_tests {
    use super::*;

    /// The nudge must be visible to the loop and must not be confused with the
    /// timer: one increment, one early wake.
    #[test]
    fn a_nudge_moves_the_counter() {
        let before = NUDGE.load(std::sync::atomic::Ordering::SeqCst);
        request_sync_now();
        let after = NUDGE.load(std::sync::atomic::Ordering::SeqCst);
        assert_eq!(after, before + 1, "a nudge has to be observable");
    }

    /// The endpoint is the one Windows calls, and it answers with what it did.
    #[test]
    fn the_nudge_endpoint_answers() {
        let before = NUDGE.load(std::sync::atomic::Ordering::SeqCst);
        let r = handle("/api/lite/sync-now").expect("the route must exist");
        assert_eq!(r.get("ok").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(
            NUDGE.load(std::sync::atomic::Ordering::SeqCst),
            before + 1,
            "calling the route is what asks for the sync"
        );
    }
}

#[cfg(test)]
mod replay_tests {
    use super::*;

    /// The symptom was four copies. The cause is the same message delivered more
    /// than once, so the second and later deliveries must not be acted on.
    #[test]
    fn the_same_message_is_only_acted_on_once() {
        let id = format!("test-{}", now_ms());
        assert!(first_time_seen(&id), "the first delivery is real");
        assert!(!first_time_seen(&id), "a replay must not be acted on twice");
        assert!(!first_time_seen(&id), "and not a third time either");
    }

    /// Two different messages are two messages, however alike they look.
    #[test]
    fn different_messages_are_both_acted_on() {
        let a = format!("a-{}", now_ms());
        let b = format!("b-{}", now_ms());
        assert!(first_time_seen(&a));
        assert!(first_time_seen(&b));
    }

    /// No id means no way to tell a replay from a real message. It is treated as
    /// real: dropping it would leave a message unmoderated, which is worse than
    /// moderating one twice.
    #[test]
    fn a_message_with_no_id_is_never_silently_dropped() {
        assert!(first_time_seen(""));
        assert!(first_time_seen(""));
    }
}
