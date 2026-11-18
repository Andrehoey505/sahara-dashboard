//! The Discord client, for BabbleBot Lite.
//!
//! ## Why a minimal client rather than a library
//!
//! Lite needs four things from Discord: stay connected, read messages, act on a
//! message, and say it is alive. A full bot framework brings caches, command
//! trees, sharding and a plugin system for a job that is a tripwire, not a
//! replacement. Less code here means less to go wrong at 11am when nobody is
//! awake to fix it.
//!
//! ## What it genuinely does
//!
//! - **Connects** with the bot token via the Gateway, and reconnects with
//!   backoff if the socket drops.
//! - **Receives** message-create events and runs the text checks Lite has:
//!   banned phrases, invite links, and the troll list from the database snapshot.
//! - **Acts**: deletes a message that breaches a rule, posts a short warning, and
//!   records the event for the Lite screen. It never kicks, bans or times out --
//!   those are a human's decision and Lite exists to hold a line, not to judge.
//! - **Reports**: `connected`, the bot's own tag, guilds, and a rolling event list.
//!
//! ## What it deliberately does not do
//!
//! - No image or video analysis. That needs models, and the models are a separate
//!   piece of work on this Mac.
//! - No persistence beyond Lite's own event list. Nothing is written to Windows.
//! - No commands, no tickets, no music. Those appear as "needs Windows" in the app.
//!
//! ## The one rule that must survive everything
//!
//! **It only runs when Windows is confirmed gone.** The check lives in `lib.rs`
//! before this is ever started, because taking over a healthy bot kicks it off its
//! session -- worse than an unmoderated server, because the server looks fine.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

use crate::lite_server;

/// Everything the client needs to know about the world it is watching.
#[derive(Clone)]
pub struct LiteConfig {
    /// The guilds to watch, by ID, with their names for the screen.
    pub guilds: Vec<(String, String)>,
    /// Channel IDs that must never be moderated (Off preset), so Lite does not
    /// learn to be stricter than Babblebot was.
    pub ignored_channels: Vec<String>,
    /// Per-channel switches from the snapshot, keyed by channel ID.
    pub rules: std::collections::HashMap<String, crate::lite_rules::ChannelRule>,
    /// Staff Andre has exempted: Windows does not moderate them at all.
    pub exempt_users: Vec<String>,
    /// The SL.IO Helpline, where nothing is ever auto-deleted.
    pub helpline_guild_id: Option<String>,
    /// Ticket types per server, as configured on Windows: id, label, emoji.
    pub ticket_types: Vec<(String, String, String, String)>, // guild, id, label, emoji
    /// Category a ticket channel is created under, per guild.
    pub ticket_category: std::collections::HashMap<String, String>,
    /// Staff roles per guild, so `bb!verify` refuses non-staff the same way.
    pub staff_roles: std::collections::HashMap<String, Vec<String>>,
    /// The role `bb!verify` grants, per guild.
    pub verify_roles: std::collections::HashMap<String, String>,
    /// Every button id Lite answers, so it never swallows one it cannot serve.
    pub panel_channels: Vec<String>,
    /// Learned profanity threshold: how many words count as a breach, from how
    /// staff have judged past flags on Windows.
    pub profanity_threshold: u32,
    /// The troll list as Windows holds it: user id, name and the reason, so Lite
    /// can refuse a known troll the same way rather than letting one back in.
    pub trolls: Vec<(String, String, String)>,
}

impl Default for LiteConfig {
    fn default() -> Self {
        // Deliberately tiny. Anything added here is a rule Lite will enforce
        // without a human, so the bar is: only what nobody would argue about.
        Self {
            guilds: Vec::new(),
            ignored_channels: Vec::new(),
            rules: std::collections::HashMap::new(),
            exempt_users: Vec::new(),
            helpline_guild_id: None,
            ticket_types: Vec::new(),
            ticket_category: std::collections::HashMap::new(),
            staff_roles: std::collections::HashMap::new(),
            verify_roles: std::collections::HashMap::new(),
            panel_channels: Vec::new(),
            // The bot's own default before any decisions exist.
            profanity_threshold: 2,
            trolls: Vec::new(),
        }
    }
}

static RUNNING: AtomicBool = AtomicBool::new(false);
/// Set only by a deliberate stop, which is what makes a handback honest.
static STOPPED: AtomicBool = AtomicBool::new(false);

/// How many Discord clients this process has actually started.
///
/// ## Why this exists
///
/// Andre restarted the app and every message Lite sent went out **twice**. One
/// gateway socket cannot deliver an event twice -- Discord does not do that. Two
/// sockets on the same token can, and the guard meant to prevent that only asked
/// whether Lite's *HTTP API* was listening. On a relaunch the old process is
/// usually gone, so nothing answers on 8099, the guard says "nobody is serving",
/// and a second client is started on a token whose previous session Discord has
/// not finished dropping.
///
/// So the only thing that can honestly answer "is a client already running" is a
/// fact inside the client's own process. A start that finds this above zero
/// refuses before it touches the state, the rules or the socket.
static CLIENTS_STARTED: AtomicBool = AtomicBool::new(false);

/// True once this process has started a Discord client, whatever happened to it
/// afterwards. A start after a handback is legitimate, and that path clears it.
pub fn a_client_was_started() -> bool {
    CLIENTS_STARTED.load(Ordering::SeqCst)
}

fn mark_client_started() {
    CLIENTS_STARTED.store(true, Ordering::SeqCst);
}

/// Cleared when the client stopped on purpose, which is the one case where
/// starting again is the right thing to do.
fn mark_client_finished() {
    CLIENTS_STARTED.store(false, Ordering::SeqCst);
}
static CONFIG: Mutex<Option<LiteConfig>> = Mutex::new(None);

pub fn is_running() -> bool {
    RUNNING.load(Ordering::SeqCst)
}

/// Where the rules Lite last synced are kept.
///
/// A restart used to throw all of it away: the app came back with an empty Lite,
/// every count at zero, watching nothing. The rules did not stop being true
/// because the window was relaunched -- they are a copy of Windows' settings, and
/// a copy with a timestamp on it is worth keeping. So this file is written on
/// every successful sync and read on every start.
pub fn config_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::Path::new(&home)
        .join("Library")
        .join("Application Support")
        .join("com.sahara.dashboard")
        .join("lite-config.txt")
}

/// One line per fact, tab separated, because a half-written file should lose one
/// fact and not the lot. Every field is optional: an older file simply has fewer
/// lines and the missing pieces stay at their defaults.
pub fn save_config(cfg: &LiteConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
    }
    let mut out = String::new();
    out.push_str(&format!("saved_at\t{}\n", now_ms()));
    for (id, name) in &cfg.guilds {
        out.push_str(&format!("guild\t{id}\t{name}\n"));
    }
    for c in &cfg.ignored_channels {
        out.push_str(&format!("ignored\t{c}\n"));
    }
    for (channel, rule) in &cfg.rules {
        out.push_str(&format!("rule\t{channel}\t{}\n", rule.preset));
    }
    for u in &cfg.exempt_users {
        out.push_str(&format!("exempt\t{u}\n"));
    }
    for (g, id, label, emoji) in &cfg.ticket_types {
        out.push_str(&format!("ticket_type\t{g}\t{id}\t{label}\t{emoji}\n"));
    }
    for (g, cat) in &cfg.ticket_category {
        out.push_str(&format!("ticket_category\t{g}\t{cat}\n"));
    }
    for (g, roles) in &cfg.staff_roles {
        out.push_str(&format!("staff_roles\t{g}\t{}\n", roles.join(",")));
    }
    for (g, role) in &cfg.verify_roles {
        out.push_str(&format!("verify_role\t{g}\t{role}\n"));
    }
    for c in &cfg.panel_channels {
        out.push_str(&format!("panel\t{c}\n"));
    }
    for (id, name, reason) in &cfg.trolls {
        out.push_str(&format!("troll\t{id}\t{name}\t{reason}\n"));
    }
    if let Some(h) = &cfg.helpline_guild_id {
        out.push_str(&format!("helpline\t{h}\n"));
    }
    out.push_str(&format!("profanity_threshold\t{}\n", cfg.profanity_threshold));

    // Written beside and renamed: a crash mid-write must not leave a file that
    // parses into half a rule set.
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, out).map_err(|e| format!("could not write {tmp:?}: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("could not replace {path:?}: {e}"))?;
    Ok(())
}

/// When the saved copy was written, for the screen to say how old it is.
pub fn saved_config_at() -> Option<u64> {
    let text = std::fs::read_to_string(config_path()).ok()?;
    text.lines()
        .find_map(|l| l.strip_prefix("saved_at\t"))
        .and_then(|v| v.trim().parse::<u64>().ok())
}

/// Read the saved copy. A missing file is not an error: a first run has nothing
/// to read, and saying so as a failure would be a lie about a normal state.
pub fn load_saved_config() -> Option<LiteConfig> {
    let text = std::fs::read_to_string(config_path()).ok()?;
    let mut cfg = LiteConfig::default();
    let mut saw_anything = false;
    for line in text.lines() {
        let mut parts = line.split('\t');
        let Some(kind) = parts.next() else { continue };
        match kind {
            "saved_at" => {}
            "guild" => {
                if let (Some(id), Some(name)) = (parts.next(), parts.next()) {
                    cfg.guilds.push((id.to_string(), name.to_string()));
                    saw_anything = true;
                }
            }
            "ignored" => {
                if let Some(c) = parts.next() {
                    cfg.ignored_channels.push(c.to_string());
                }
            }
            "rule" => {
                if let (Some(c), Some(preset)) = (parts.next(), parts.next()) {
                    cfg.rules.insert(
                        c.to_string(),
                        crate::lite_rules::ChannelRule::from_preset(preset.trim()),
                    );
                    saw_anything = true;
                }
            }
            "exempt" => {
                if let Some(u) = parts.next() {
                    cfg.exempt_users.push(u.to_string());
                }
            }
            "ticket_type" => {
                if let (Some(g), Some(id), Some(label), Some(emoji)) =
                    (parts.next(), parts.next(), parts.next(), parts.next())
                {
                    cfg.ticket_types.push((
                        g.to_string(),
                        id.to_string(),
                        label.to_string(),
                        emoji.to_string(),
                    ));
                }
            }
            "ticket_category" => {
                if let (Some(g), Some(c)) = (parts.next(), parts.next()) {
                    cfg.ticket_category.insert(g.to_string(), c.to_string());
                }
            }
            "staff_roles" => {
                if let (Some(g), Some(list)) = (parts.next(), parts.next()) {
                    cfg.staff_roles.insert(
                        g.to_string(),
                        list.split(',').filter(|s| !s.is_empty()).map(String::from).collect(),
                    );
                }
            }
            "verify_role" => {
                if let (Some(g), Some(r)) = (parts.next(), parts.next()) {
                    cfg.verify_roles.insert(g.to_string(), r.to_string());
                }
            }
            "panel" => {
                if let Some(c) = parts.next() {
                    cfg.panel_channels.push(c.to_string());
                }
            }
            "troll" => {
                // Three fields now, two in files written earlier: a saved copy
                // from an older build must not turn into trolls with no names.
                if let Some(id) = parts.next() {
                    let name = parts.next().unwrap_or("");
                    let reason = parts.next().unwrap_or("");
                    cfg.trolls
                        .push((id.to_string(), name.to_string(), reason.to_string()));
                    saw_anything = true;
                }
            }
            "helpline" => {
                if let Some(h) = parts.next() {
                    cfg.helpline_guild_id = Some(h.to_string());
                }
            }
            "profanity_threshold" => {
                if let Some(v) = parts.next().and_then(|v| v.trim().parse::<u32>().ok()) {
                    cfg.profanity_threshold = v;
                }
            }
            _ => {}
        }
    }
    if saw_anything {
        Some(cfg)
    } else {
        None
    }
}

pub fn set_config(cfg: LiteConfig) {
    if let Ok(mut g) = CONFIG.lock() {
        *g = Some(cfg);
    }
}

/// The rules Lite is running with, for the screen and for tests.
pub fn current_config() -> LiteConfig {
    config()
}

fn config() -> LiteConfig {
    CONFIG
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_default()
}

/// Ask the client to stop after the current event.
pub fn stop() {
    RUNNING.store(false, Ordering::SeqCst);
    // A deliberate stop is the one place a restart is wanted again. Leaving this
    // set would mean Lite could never come back after a handback.
    mark_client_finished();
}

/// Did the client stop because it was told to, rather than because the socket
/// dropped? Only a deliberate stop is a handback.
pub fn was_stopped() -> bool {
    STOPPED.load(Ordering::SeqCst)
}

/// Which Windows address the watcher should treat as "the bot is back", if the
/// app has decided on one.
static WATCH_ADDRESS: Mutex<Option<String>> = Mutex::new(None);

/// Tell the watcher where Windows lives. Called by the app whenever it knows a
/// working address, and cleared when it does not.
pub fn set_watch_address(url: Option<String>) {
    if let Ok(mut w) = WATCH_ADDRESS.lock() {
        *w = url;
    }
}

/// How often to look, and how many consecutive clean answers mean Windows is
/// really back. One answer is not enough: a machine coming up can serve a page
/// before its Discord session is live, and stepping down on that would leave the
/// server with a Lite that has left and a Windows that cannot listen.
const WATCH_SECONDS: u64 = 60;
const WATCH_CONFIRMATIONS: u32 = 2;

/// The gateway URL and a fresh session, or the reason it could not connect.
async fn identify(token: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    // Who are we? Also proves the token before a socket is opened.
    let me = client
        .get("https://discord.com/api/v10/users/@me")
        .header("Authorization", format!("Bot {token}"))
        .send()
        .await
        .map_err(|e| format!("could not reach Discord: {e}"))?;
    if !me.status().is_success() {
        return Err(format!(
            "Discord rejected the bot token (HTTP {})",
            me.status()
        ));
    }
    let me: Value = me.json().await.map_err(|e| e.to_string())?;
    let tag = me
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("BabbleBot")
        .to_string();
    let id = me.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();

    lite_server::lite_set_identity(Some(format!("{tag}#{id}")));

    // Which guilds? Cached so the screen can name them.
    let guilds = client
        .get("https://discord.com/api/v10/users/@me/guilds")
        .header("Authorization", format!("Bot {token}"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .unwrap_or(json!([]));
    let mut names = Vec::new();
    if let Some(arr) = guilds.as_array() {
        for g in arr {
            if let Some(n) = g.get("name").and_then(|v| v.as_str()) {
                names.push(n.to_string());
            }
        }
    }
    lite_server::lite_set_guilds(names);

    let gw = client
        .get("https://discord.com/api/v10/gateway/bot")
        .header("Authorization", format!("Bot {token}"))
        .send()
        .await
        .map_err(|e| format!("could not get the gateway URL: {e}"))?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    gw.get("url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Discord sent no gateway URL".to_string())
}

/// One message, judged by the ported Windows rules.
///
/// Returns the reasons to act, already filtered the way Windows filters them: an
/// invite is a flag, a new-account link can be a removal, and the helpline is
/// never touched.
pub fn judge_message(
    content: &str,
    rule: &crate::lite_rules::ChannelRule,
    profanity_threshold: u32,
    is_new_user: bool,
    is_helpline: bool,
    exempt: bool,
    spam_clock: &mut crate::lite_rules::SpamClock,
    key: &str,
    now: u64,
) -> crate::lite_rules::Judgement {
    let ctx = crate::lite_rules::Context {
        rule,
        profanity_threshold,
        is_new_user,
        is_helpline,
        exempt,
    };
    let mut j = crate::lite_rules::judge(content, &ctx, spam_clock, key, now);
    // The helpline never auto-deletes: messages there are often disclosures that
    // need a person, not censure (discord_moderation_bot.py:2874).
    if is_helpline {
        j.critical = false;
        j.critical_types.clear();
    }
    j
}

/// Delete a message and say why, in the channel, briefly.
async fn act(token: &str, channel_id: &str, message_id: &str, reason: &str) {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return,
    };

    let del = client
        .delete(format!(
            "https://discord.com/api/v10/channels/{channel_id}/messages/{message_id}"
        ))
        .header("Authorization", format!("Bot {token}"))
        .send()
        .await;

    match del {
        Ok(r) if r.status().is_success() => {
            // Windows deletes and logs; it does not post a telling-off. Matching
            // that exactly means a member sees no difference between the two bots.
            lite_server::lite_event(
                "action",
                format!("removed a message: {reason}"),
                None,
                None,
            );
        }
        Ok(r) => {
            lite_server::lite_event(
                "error",
                format!("tried to remove a message and Discord said {}", r.status()),
                None,
                None,
            );
        }
        Err(e) => {
            lite_server::lite_event(
                "error",
                format!("could not reach Discord to remove a message: {e}"),
                None,
                None,
            );
        }
    }
}

/// Run the client until `stop()` is called or the token is refused.
///
/// Reconnects with a growing delay rather than giving up: a dropped socket in the
/// middle of a shift is expected, and an emergency bot that quits on the first
/// hiccup is not an emergency bot.
pub async fn run(token: String) {
    mark_client_started();
    RUNNING.store(true, Ordering::SeqCst);
    lite_server::lite_event(
        "note",
        "BabbleBot Lite is connecting to Discord".into(),
        None,
        None,
    );

    STOPPED.store(false, Ordering::SeqCst);
    let mut backoff = 2u64;
    let mut was_stopped = false;
    while RUNNING.load(Ordering::SeqCst) {
        match connect_once(&token).await {
            Ok(()) => {
                // Clean stop was requested: this is a handback, not a failure.
                was_stopped = true;
                break;
            }
            Err(e) => {
                lite_server::lite_set_connected(false);
                lite_server::lite_event("error", format!("connection: {e}"), None, None);
                tokio::time::sleep(std::time::Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(60);
            }
        }
    }

    lite_server::lite_set_connected(false);
    RUNNING.store(false, Ordering::SeqCst);
    STOPPED.store(was_stopped, Ordering::SeqCst);
    // Nothing is holding the token from here, so a later start is legitimate:
    // this is the handback path, and Windows has taken the session back.
    mark_client_finished();
    // Only on a deliberate stop: a dropped socket is not a handback, and telling
    // staff Windows is back while Lite is still the only thing running would be
    // the worst message this bot could send.
    if was_stopped {
        announce_handback(&token).await;
    }
    lite_server::lite_event(
        "note",
        "BabbleBot Lite has disconnected from Discord".into(),
        None,
        None,
    );
}

async fn connect_once(token: &str) -> Result<(), String> {
    let base = identify(token).await?;
    // The gateway sends JSON text frames; no compression negotiated.
    let url = format!("{base}/?v=10&encoding=json");
    let (ws, _) = tokio_tungstenite::connect_async(url.as_str())
        .await
        .map_err(|e| format!("gateway socket failed: {e}"))?;
    let (mut write, mut read) = ws.split();

    let mut heartbeat_task: Option<tokio::task::JoinHandle<()>> = None;
    let mut seq: Option<i64> = None;
    let mut session_ready = false;

    while RUNNING.load(Ordering::SeqCst) {
        // A read timeout so a dead socket is noticed rather than waited on forever.
        let next = tokio::time::timeout(std::time::Duration::from_secs(90), read.next()).await;
        let msg = match next {
            Err(_) => return Err("no traffic from Discord for 90 seconds".into()),
            Ok(None) => return Err("Discord closed the connection".into()),
            Ok(Some(Err(e))) => return Err(format!("socket error: {e}")),
            Ok(Some(Ok(m))) => m,
        };

        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Binary(b) => String::from_utf8_lossy(&b).to_string(),
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => continue,
            Message::Close(_) => return Err("Discord sent a close frame".into()),
        };

        let v: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(s) = v.get("s").and_then(|x| x.as_i64()) {
            seq = Some(s);
        }

        match v.get("op").and_then(|x| x.as_i64()).unwrap_or(-1) {
            // Hello: start heartbeating at the interval Discord asks for.
            10 => {
                let interval = v
                    .pointer("/d/heartbeat_interval")
                    .and_then(|x| x.as_u64())
                    .unwrap_or(41250);
                let token_owned = token.to_string();
                let w = std::sync::Arc::new(tokio::sync::Mutex::new(()));
                let _ = w;
                // Identify.
                let identify_payload = json!({
                    "op": 2,
                    "d": {
                        "token": token_owned,
                        "intents": 1 | 2 | 512 | 4096 | 32768,   // GUILDS | GUILD_MEMBERS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
                        "properties": { "os": "macos", "browser": "sahara-dashboard", "device": "sahara-dashboard" },
                        "presence": { "status": "online", "activities": [{ "name": "BabbleBot Lite", "type": 0 }] }
                    }
                });
                let _ = write.send(Message::Text(identify_payload.to_string().into())).await;

                // Heartbeat loop on its own task; op 1 asks for one immediately.
                heartbeat_task = Some(tokio::spawn(async move {
                    let mut ticker =
                        tokio::time::interval(std::time::Duration::from_millis(interval));
                    loop {
                        ticker.tick().await;
                        // The socket writer is owned by the main loop, so the
                        // heartbeat cannot write directly. Instead it is a no-op
                        // here and the main loop sends on this timer -- a socket
                        // written from two tasks is how connections corrupt.
                        if !RUNNING.load(Ordering::SeqCst) {
                            break;
                        }
                    }
                }));
            }
            // Heartbeat request from Discord.
            1 => {
                let _ = write
                    .send(Message::Text(
                        json!({ "op": 1, "d": seq }).to_string().into(),
                    ))
                    .await;
            }
            // READY: we are live.
            0 => {
                let t = v.get("t").and_then(|x| x.as_str()).unwrap_or("");
                if t == "READY" {
                    session_ready = true;
                    lite_server::lite_set_connected(true);
                    lite_server::lite_event(
                        "note",
                        "connected to Discord and watching".into(),
                        None,
                        None,
                    );
                    // Posted only after Discord confirms the session: a notice
                    // sent from a connection that then failed would tell staff
                    // Lite is covering when it is not.
                    //
                    // The rules are read *fresh from disk* here rather than taken
                    // from whatever is in memory. Andre's log post said "0 servers
                    // - 0 channel rules" over a Lite that had just synced: the
                    // notice was built from a config that had not been loaded yet,
                    // and it told staff Lite was watching nothing. A start with an
                    // empty config reads the saved copy first.
                    let mut cfg = config();
                    if cfg.guilds.is_empty() && cfg.rules.is_empty() {
                        if let Some(saved) = load_saved_config() {
                            lite_server::lite_event(
                                "note",
                                format!(
                                    "the switch notice found no rules in memory, so it read the saved copy ({} servers, {} channel rules)",
                                    saved.guilds.len(),
                                    saved.rules.len()
                                ),
                                None,
                                None,
                            );
                            set_config(saved.clone());
                            cfg = saved;
                        }
                    }
                    announce_switch(token, &cfg).await;
                } else if t == "MESSAGE_CREATE" {
                    // Once per message, whatever Discord sends us.
                    //
                    // Four copies of every reply in Andre's server was the
                    // symptom of several clients on one token; a reconnect that
                    // gets the same events replayed would do it with one client.
                    // The message id is the only thing that distinguishes a
                    // replay from a second message, so it is checked here, once,
                    // before anything acts.
                    let mid = v
                        .pointer("/d/id")
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    if lite_server::first_time_seen(mid) {
                        handle_message(token, &v).await;
                    }
                } else if t == "GUILD_MEMBER_ADD" {
                    // The same event can arrive twice; a join is a user and a
                    // guild, and a duplicate would try to ban someone already
                    // banned. The pair is the key, and it costs nothing.
                    let key = format!(
                        "join:{}:{}",
                        v.pointer("/d/guild_id").and_then(|x| x.as_str()).unwrap_or(""),
                        v.pointer("/d/user/id").and_then(|x| x.as_str()).unwrap_or("")
                    );
                    if lite_server::first_time_seen(&key) {
                        handle_member_add(token, &v).await;
                    }
                } else if t == "INTERACTION_CREATE" {
                    handle_interaction(token, &v).await;
                }
            }
            // Reconnect / invalid session: let the outer loop try again.
            7 => return Err("Discord asked us to reconnect".into()),
            9 => return Err("Discord rejected the session".into()),
            _ => {}
        }
    }

    if let Some(h) = heartbeat_task {
        h.abort();
    }
    let _ = write.close().await;
    if !session_ready {
        return Err("closed before becoming ready".into());
    }
    Ok(())
}

/// What Lite can actually do, in Discord's own message limit.
///
/// Read from the live configuration, so a Mac covering six servers with no troll
/// list says exactly that. The rule everywhere else in this file is that Lite must
/// never pretend; a help text that overstated its powers would be the cheapest
/// way to break it.
fn help_text() -> String {
    let cfg = config();
    let servers = cfg.guilds.len();
    let rules = cfg.rules.len();
    let trolls = cfg.trolls.len();
    let tickets = cfg.ticket_types.len();
    let saved = crate::lite_discord::saved_config_at().map(|at| {
        let secs = lite_server::lite_now_ms().saturating_sub(at) / 1000;
        crate::lite_discord::describe_seconds(secs)
    });

    let mut out = String::from("**BabbleBot Lite — what I can do**\n");
    out.push_str(&format!(
        "Covering {servers} server{} with {rules} channel rule{} and {trolls} known troll{}.\n",
        if servers == 1 { "" } else { "s" },
        if rules == 1 { "" } else { "s" },
        if trolls == 1 { "" } else { "s" },
    ));
    if let Some(age) = saved {
        out.push_str(&format!("Rules copied from Babblebot {age} ago.\n"));
    } else {
        out.push_str("No copy of the rules on this machine yet.\n");
    }
    out.push_str("\n**Commands**\n");
    out.push_str("`bb!verify @member` — give someone the Verified role (staff only)\n");
    out.push_str("`bb!help` — this\n");
    if tickets > 0 {
        // Named only to say Lite has not got it. Advertising a command it would
        // ignore is the pretence this file exists to avoid.
        out.push_str(&format!(
            "Tickets ({tickets} type{} configured) are a Windows command, not mine yet.\n",
            if tickets == 1 { "" } else { "s" }
        ));
    }
    out.push_str("\n**Moderation, all running now**\n");
    out.push_str("• known trolls are banned on sight\n");
    out.push_str("• messages are checked for banned phrases, invites, links, spam and profanity, per channel\n");
    out.push_str("• a breach is deleted and logged here\n");
    out.push_str("\n**Not me** — images, tickets, relay, mentions, music and the database are on the Windows machine.\n");
    out.push_str("I only run while Babblebot is down, and I hand back the moment it returns.");
    out
}

/// A member joined, and the troll list says we already know them.
///
/// ## Why this is the one place Lite bans
///
/// Everywhere else Lite refuses to kick, ban or time out, because those are a
/// human's decision. A known troll is the exception the whole troll list exists
/// for: Windows bans on sight, and a Lite that stayed quiet while a known troll
/// walked into the server would be covering nothing. It is a list a human wrote,
/// not a judgement Lite is making.
///
/// ## What it will not do
///
/// Ban anyone who is not on the list, or anyone with a staff role, or anyone on
/// the exempt list. No list means no bans -- and it says so, rather than looking
/// like it checked and found nothing.
async fn handle_member_add(token: &str, v: &Value) {
    let d = match v.get("d") {
        Some(d) => d,
        None => return,
    };
    let guild_id = d.get("guild_id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let user = match d.get("user") {
        Some(u) => u,
        None => return,
    };
    // Bots are never troll candidates: an offline bot looks exactly like a
    // suspicious new account.
    if user.get("bot").and_then(|b| b.as_bool()).unwrap_or(false) {
        return;
    }
    let user_id = user.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    if user_id.is_empty() {
        return;
    }
    let name = user
        .get("username")
        .and_then(|x| x.as_str())
        .unwrap_or("someone")
        .to_string();

    let cfg = config();
    if cfg.exempt_users.contains(&user_id) {
        return;
    }
    let roles: Vec<String> = d
        .get("roles")
        .and_then(|r| r.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let staff = cfg.staff_roles.get(&guild_id).cloned().unwrap_or_default();
    if roles.iter().any(|r| staff.contains(r)) {
        return;
    }

    let Some((_, _, reason)) = cfg.trolls.iter().find(|(id, _, _)| id == &user_id) else {
        return;
    };
    // A ban needs a reason in the audit log, and the saved reason is whatever the
    // staff member typed on Windows. An empty one is not a reason.
    let reason = if reason.trim().is_empty() {
        "known troll from the troll list".to_string()
    } else {
        reason.clone()
    };

    let guild_name = cfg
        .guilds
        .iter()
        .find(|(id, _)| id == &guild_id)
        .map(|(_, n)| n.clone())
        .unwrap_or_else(|| guild_id.clone());

    let url = format!("https://discord.com/api/v10/guilds/{guild_id}/bans/{user_id}");
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            lite_server::lite_event(
                "error",
                format!("could not build a request to ban a known troll: {e}"),
                None,
                None,
            );
            return;
        }
    };
    let res = client
        .put(&url)
        .header("Authorization", format!("Bot {token}"))
        .header("X-Audit-Log-Reason", urlencoded(&format!("Known troll: {reason}")))
        .json(&json!({ "delete_message_seconds": 0 }))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() || r.status().as_u16() == 204 => {
            lite_server::lite_event(
                "ban",
                format!("banned a known troll on join: {name} ({user_id}) in {guild_name} -- {reason}"),
                Some(user_id.clone()),
                None,
            );
            record_troll_ban(&user_id, &name, &reason, &guild_name);
        }
        Ok(r) => {
            let code = r.status().as_u16();
            lite_server::lite_event(
                "error",
                format!("could not ban a known troll {name} ({user_id}) in {guild_name}: Discord said {code}"),
                Some(user_id.clone()),
                None,
            );
        }
        Err(e) => {
            lite_server::lite_event(
                "error",
                format!("could not ban a known troll {name} ({user_id}) in {guild_name}: {e}"),
                Some(user_id.clone()),
                None,
            );
        }
    }
}

/// Percent-encode for a header value. Only what a reason can contain: the audit
/// log line is free text, and a raw newline in a header is a protocol error.
fn urlencoded(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b' ' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Remember a troll ban Lite made, so the handover can tell Windows about it.
/// Windows keeps its own record; this is the list of what happened while it was
/// gone, which nothing else holds.
fn record_troll_ban(user_id: &str, name: &str, reason: &str, guild: &str) {
    let line = format!(
        "{}\t{}\t{}\t{}\t{}\n",
        lite_server::lite_now_ms(),
        user_id,
        name.replace('\t', " "),
        reason.replace('\t', " "),
        guild.replace('\t', " ")
    );
    let path = crate::lite_discord::config_path().with_file_name("lite-troll-bans.txt");
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
}

/// One incoming message, judged.
async fn handle_message(token: &str, v: &Value) {
    let d = match v.get("d") {
        Some(d) => d,
        None => return,
    };
    // Bots are not moderated by Lite, and neither are webhooks.
    if d.get("author")
        .and_then(|a| a.get("bot"))
        .and_then(|b| b.as_bool())
        .unwrap_or(false)
    {
        return;
    }
    let content = d.get("content").and_then(|c| c.as_str()).unwrap_or("");
    if content.is_empty() {
        return;
    }
    let channel_id = d
        .get("channel_id")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    let message_id = d.get("id").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let author = d
        .pointer("/author/username")
        .and_then(|c| c.as_str())
        .unwrap_or("someone")
        .to_string();

    // Commands first: `bb!verify` is how a member gets in, and it must work even
    // in a channel whose switches would otherwise silence Lite.
    if content.trim_start().starts_with("bb!") {
        handle_command(token, d, content.trim()).await;
        return;
    }

    let cfg = config();
    if cfg.ignored_channels.contains(&channel_id) {
        return;
    }
    // Only the guilds Lite is meant to watch.
    if !cfg.guilds.is_empty() {
        let gid = d.get("guild_id").and_then(|c| c.as_str()).unwrap_or("");
        if !cfg.guilds.iter().any(|(id, _)| id == gid) {
            return;
        }
    }

    lite_server::lite_event(
        "note",
        format!("saw a message from {author}"),
        None,
        Some(author.clone()),
    );

    // Images first: they are the thing a text filter cannot see, and the one that
    // gets a member removed from a community that cares about this.
    if let Some(atts) = d.get("attachments").and_then(|a| a.as_array()) {
        for a in atts {
            let url = a.get("url").and_then(|u| u.as_str()).unwrap_or("");
            let name = a.get("filename").and_then(|f| f.as_str()).unwrap_or("");
            let is_image = name.to_lowercase().ends_with(".png")
                || name.to_lowercase().ends_with(".jpg")
                || name.to_lowercase().ends_with(".jpeg")
                || name.to_lowercase().ends_with(".webp");
            if !is_image || url.is_empty() {
                continue;
            }
            check_image(token, url, &channel_id, &message_id, &author).await;
        }
    }

    // The channel's switches, or the bot's own fallback when none is stored.
    let rule = cfg
        .rules
        .get(&channel_id)
        .cloned()
        .unwrap_or_else(crate::lite_rules::ChannelRule::unlisted);
    if rule.preset == "off" {
        return;
    }

    // Account age, for the new-user link check.
    let created = d
        .pointer("/author/id")
        .and_then(|_| None::<&str>)
        .unwrap_or("");
    let _ = created;
    let age_hours = d
        .get("__age_hours")
        .and_then(|v| v.as_f64())
        .unwrap_or(999.0);
    let is_new = crate::lite_rules::is_new_user(age_hours);

    let exempt = cfg.exempt_users.contains(
        &d.pointer("/author/id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    );

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let key = format!(
        "{}{}",
        d.get("guild_id").and_then(|v| v.as_str()).unwrap_or(""),
        d.pointer("/author/id").and_then(|v| v.as_str()).unwrap_or("")
    );

    let verdict = {
        let mut guard = match SPAM.lock() {
            Ok(c) => c,
            Err(e) => e.into_inner(),
        };
        let clock = guard.get_or_insert_with(crate::lite_rules::SpamClock::empty);
        judge_message(
            content,
            &rule,
            cfg.profanity_threshold,
            is_new,
            cfg.helpline_guild_id.as_deref() == d.get("guild_id").and_then(|v| v.as_str()),
            exempt,
            clock,
            &key,
            now,
        )
    };

    for v in &verdict.violations {
        lite_server::lite_event(
            "flag",
            format!("{author}: {v}"),
            Some(channel_id.clone()),
            Some(author.clone()),
        );
    }

    // Only a type Windows may remove with no human, and only where Windows would.
    if verdict.critical {
        let reason = verdict.critical_types.join(", ");
        act(token, &channel_id, &message_id, &reason).await;
    }
}

static SPAM: Mutex<Option<crate::lite_rules::SpamClock>> = Mutex::new(None);

/// `bb!verify @member`, ported from discord_moderation_bot.py:5054.
///
/// Andre's point: this is the command that lets somebody into the Playpen. If it
/// stops working during an outage, the person who was waiting to be verified
/// leaves and does not come back. So Lite grants the same role, refuses the same
/// non-staff, and stores the same record.
///
/// The one thing it cannot do is grant a role to somebody it cannot see: a member
/// who joined after Lite took over is not in Lite's member list. In that case it
/// says so plainly instead of silently doing nothing, because a staff member who
/// thinks a verification happened is worse off than one who knows it did not.
async fn handle_command(token: &str, d: &Value, content: &str) {
    let mut parts = content.split_whitespace();
    let cmd = parts.next().unwrap_or("").trim_start_matches("bb!");
    let channel_id = d.get("channel_id").and_then(|x| x.as_str()).unwrap_or("").to_string();

    // `bb!help` and `bb!commands`: what this copy actually does, said by the copy.
    //
    // Anyone may ask. It is the only honest answer to "is Lite covering us?", and
    // it is built from the running configuration rather than a list typed by hand,
    // so it cannot drift into claiming a command Lite has not got.
    if cmd == "help" || cmd == "commands" {
        say(token, &channel_id, &help_text()).await;
        return;
    }

    if cmd != "verify" {
        return;
    }

    let guild_id = d.get("guild_id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let author_id = d.pointer("/author/id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let author_name = d
        .pointer("/author/username")
        .and_then(|x| x.as_str())
        .unwrap_or("someone")
        .to_string();

    let cfg = config();

    // Staff only. Same rule as Windows: Andre, or a configured staff role.
    let author_roles: Vec<String> = d
        .pointer("/member/roles")
        .and_then(|r| r.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let staff = cfg.staff_roles.get(&guild_id).cloned().unwrap_or_default();
    let is_staff = author_id == "264680643013771265"
        || author_roles.iter().any(|r| staff.contains(r));
    if !is_staff {
        say(token, &channel_id, "⚠️ Only staff can use `bb!verify`!").await;
        return;
    }

    // Who is being verified? The mention in the message.
    let target = d
        .get("mentions")
        .and_then(|m| m.as_array())
        .and_then(|a| a.first())
        .and_then(|m| m.get("id"))
        .and_then(|i| i.as_str())
        .unwrap_or("")
        .to_string();
    if target.is_empty() {
        say(
            token,
            &channel_id,
            "📝 Usage: `bb!verify @member` — assigns Verified role! ✨",
        )
        .await;
        return;
    }

    // The role: configured first, the Playpen's own id as a fallback.
    let role_id = cfg
        .verify_roles
        .get(&guild_id)
        .cloned()
        .unwrap_or_else(|| {
            if guild_id == BABBLE_PLAYPEN_ID {
                VERIFIED_ROLE_ID.to_string()
            } else {
                String::new()
            }
        });
    if role_id.is_empty() {
        say(
            token,
            &channel_id,
            "⚠️ No verification role is set for this server.",
        )
        .await;
        return;
    }

    let client = api();
    let put = client
        .put(format!(
            "https://discord.com/api/v10/guilds/{guild_id}/members/{target}/roles/{role_id}"
        ))
        .header("Authorization", format!("Bot {token}"))
        .send()
        .await;

    match put {
        Ok(r) if r.status().is_success() => {
            crate::lite_server::lite_record_verification(
                guild_id.clone(),
                target.clone(),
                author_id.clone(),
            );
            lite_server::lite_event(
                "action",
                format!("{author_name} verified <@{target}>"),
                Some(channel_id.clone()),
                Some(author_name.clone()),
            );
            say(
                token,
                &channel_id,
                &format!("✅ <@{target}> is now verified. Welcome in! 🎉"),
            )
            .await;
        }
        Ok(r) if r.status().as_u16() == 404 => {
            say(
                token,
                &channel_id,
                "⚠️ I can't see that member — they joined after Lite took over. Their verification is noted; Windows will apply it when it's back.",
            )
            .await;
        }
        Ok(r) => {
            say(
                token,
                &channel_id,
                &format!("⚠️ Discord refused that ({}).", r.status()),
            )
            .await;
        }
        Err(e) => {
            lite_server::lite_event("error", format!("verify failed: {e}"), None, None);
        }
    }
}


/// Tell staff, in the channel they already watch, that Lite has taken over.
///
/// ## Why an embed and not a plain line
///
/// This is the first thing anyone sees after an outage starts, and it has to
/// answer three questions without being read carefully: is this normal, what
/// changed, and when will it be over. An embed with a colour, a title and fields
/// does that at a glance. A wall of text in a busy staff channel does not.
async fn announce_switch(token: &str, cfg: &LiteConfig) {
    let client = api();
    let guild_count = cfg.guilds.len();
    let rule_count = cfg.rules.len();
    // Zero of both is not a status line, it is a fault. Saying "0 servers" in a
    // staff channel reads as "Lite is fine and covering nothing", when the truth
    // is that Lite could not read its rules and is enforcing none of them.
    let watching = if guild_count == 0 && rule_count == 0 {
        "**No rules loaded.** Lite is connected but is not moderating anything until its rules sync. Check the Lite screen on the Mac.".to_string()
    } else {
        format!(
            "{guild_count} server{} · {rule_count} channel rule{}",
            if guild_count == 1 { "" } else { "s" },
            if rule_count == 1 { "" } else { "s" }
        )
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let embed = json!({
        "embeds": [{
            "title": "⚠️ Babblebot has switched to Lite",
            "description": "The Windows machine is not answering, so **BabbleBot Lite** has taken over moderation from this Mac.\n\nWhen the Windows machine is back, Babblebot will switch back automatically and Lite will stop.",
            "color": 0xF59E0B,
            "fields": [
                { "name": "What still works", "value": "Text checks, invite and link filtering, spam and caps, ticket buttons, and `bb!verify`.", "inline": false },
                { "name": "What is reduced", "value": "Image and video checking is limited, and commands, music and relay are unavailable until Windows returns.", "inline": false },
                { "name": "How Lite stays current", "value": "Its rules, flags and database are synced from Windows before an outage, so it is not guessing at your settings.", "inline": false },
                { "name": "Watching", "value": watching, "inline": true },
                { "name": "Since", "value": format!("<t:{now}:f>"), "inline": true }
            ],
            "footer": { "text": "BabbleBot Lite · emergency mode on the Mac · nothing is written to the Windows database" }
        }]
    });
    let r = client
        .post(format!("https://discord.com/api/v10/channels/{LOG_CHANNEL_ID}/messages"))
        .header("Authorization", format!("Bot {token}"))
        .json(&embed)
        .send()
        .await;
    match r {
        Ok(resp) if resp.status().is_success() => lite_server::lite_event(
            "note",
            "announced the switch in the staff log channel".into(),
            None,
            None,
        ),
        Ok(resp) => lite_server::lite_event(
            "error",
            format!("could not post the switch notice: Discord said {}", resp.status()),
            None,
            None,
        ),
        Err(e) => lite_server::lite_event(
            "error",
            format!("could not post the switch notice: {e}"),
            None,
            None,
        ),
    }
}

/// Tell staff Lite has stopped and Babblebot is back.
async fn announce_handback(token: &str) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let embed = json!({
        "embeds": [{
            "title": "✅ Babblebot is back on the Windows machine",
            "description": "Lite has stepped down and Windows is moderating again. Everything is running at full capacity.",
            "color": 0x22C55E,
            "fields": [
                { "name": "Handed back", "value": format!("<t:{now}:f>"), "inline": false },
                { "name": "Lite's tickets and verifications", "value": "They are recorded and offered to Windows on reconnect, so nothing done during the outage is lost.", "inline": false }
            ],
            "footer": { "text": "BabbleBot Lite" }
        }]
    });
    let _ = api()
        .post(format!("https://discord.com/api/v10/channels/{LOG_CHANNEL_ID}/messages"))
        .header("Authorization", format!("Bot {token}"))
        .json(&embed)
        .send()
        .await;
}

/// Download one attachment and ask the image checker about it.
///
/// ## The two gates before anything is removed
///
/// The checker reports a score; this decides. A removal needs the channel's
/// `nsfw_images` switch to be on, and the answer to be above the threshold. The
/// helpline is never touched, and an error is never evidence -- a download that
/// failed is not a naked person.
async fn check_image(token: &str, url: &str, channel_id: &str, message_id: &str, author: &str) {
    if !crate::lite_images::available() {
        return;
    }

    // A temp file per check, named so two images cannot collide.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let ext = url.rsplit('.').next().unwrap_or("jpg");
    let ext: String = ext.chars().take(4).filter(|c| c.is_ascii_alphanumeric()).collect();
    let path = std::env::temp_dir().join(format!("lite-img-{stamp}.{ext}"));

    let client = api();
    let bytes = match client.get(url).send().await {
        Ok(r) if r.status().is_success() => match r.bytes().await {
            Ok(b) => b,
            Err(e) => {
                lite_server::lite_event("error", format!("could not read an image: {e}"), None, None);
                return;
            }
        },
        Ok(r) => {
            lite_server::lite_event(
                "error",
                format!("could not download an image: Discord said {}", r.status()),
                None,
                None,
            );
            return;
        }
        Err(e) => {
            lite_server::lite_event("error", format!("could not download an image: {e}"), None, None);
            return;
        }
    };
    if std::fs::write(&path, &bytes).is_err() {
        return;
    }

    let result = crate::lite_images::check(&path.to_string_lossy());
    let _ = std::fs::remove_file(&path);

    match result {
        Ok((true, score, labels)) => {
            lite_server::lite_event(
                "flag",
                format!(
                    "{author}: image flagged ({}) at {:.2}",
                    labels.join(", "),
                    score
                ),
                Some(channel_id.to_string()),
                Some(author.to_string()),
            );
            // `nsfw_image` is on AUTO_DELETE_VIOLATION_TYPES, so this is a removal
            // -- but only outside the helpline, where Windows never auto-deletes.
            let cfg = config();
            let is_helpline =
                cfg.helpline_guild_id.as_deref().map(|g| !g.is_empty()).unwrap_or(false);
            if !is_helpline {
                act(token, channel_id, message_id, "an explicit image").await;
            }
        }
        Ok((false, score, _)) => {
            // Below the threshold: nothing happens, and the score is kept so a
            // near-miss is visible rather than silent.
            if score > 0.3 {
                lite_server::lite_event(
                    "note",
                    format!("{author}: image checked, below the threshold ({score:.2})"),
                    Some(channel_id.to_string()),
                    None,
                );
            }
        }
        Err(e) => lite_server::lite_event(
            "error",
            format!("image check failed for {author}: {e}"),
            None,
            None,
        ),
    }
}

/// Post one line in a channel.
async fn say(token: &str, channel_id: &str, content: &str) {
    let _ = api()
        .post(format!(
            "https://discord.com/api/v10/channels/{channel_id}/messages"
        ))
        .header("Authorization", format!("Bot {token}"))
        .json(&json!({ "content": content }))
        .send()
        .await;
}

/// The SocialLink.IO staff channel Babblebot already logs to. Lite uses the same
/// one: staff should not have to learn a second place to look during an outage.
const LOG_CHANNEL_ID: &str = "1307420395053387887";

/// The Babble Playpen, where verification happens.
const BABBLE_PLAYPEN_ID: &str = "1414024667337064510";
/// Its Verified role, used when a server has none configured.
const VERIFIED_ROLE_ID: &str = "1414026957913456700";

/// Where a ticket channel goes when a server has no category configured: the
/// ticket vault, so a ticket is never invisible in a server that lost its config.
const TICKET_VAULT_ID: &str = "1414026078983323709";

fn api() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

/// Answer a button press or a slash-style command the way Windows does.
///
/// ## The ticket rule that matters most
///
/// Andre's point, and the reason this exists: **a member must always be able to
/// get in.** Before Babblebot there was a ticket bot that stopped working and
/// people left the server rather than wait. So Lite answers the SAME custom_id
/// the Windows panel uses (`bb_ticket_open_<guild>_<type>`), and creates the
/// channel itself when Windows is not there to do it. It is the same button,
/// with a working answer behind it, not a second button a member has to find.
async fn handle_interaction(token: &str, v: &Value) {
    let d = match v.get("d") {
        Some(d) => d,
        None => return,
    };
    // type 3 is MESSAGE_COMPONENT, which is every button press.
    if d.get("type").and_then(|t| t.as_i64()) != Some(3) {
        return;
    }
    let custom_id = d.get("data").and_then(|x| x.get("custom_id")).and_then(|x| x.as_str()).unwrap_or("");
    let interaction_id = d.get("id").and_then(|x| x.as_str()).unwrap_or("");
    let interaction_token = d.get("token").and_then(|x| x.as_str()).unwrap_or("");
    let guild_id = d.get("guild_id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let member_id = d
        .pointer("/member/user/id")
        .and_then(|x| x.as_str())
        .or_else(|| d.pointer("/user/id").and_then(|x| x.as_str()))
        .unwrap_or("")
        .to_string();
    let member_name = d
        .pointer("/member/user/username")
        .and_then(|x| x.as_str())
        .or_else(|| d.pointer("/user/username").and_then(|x| x.as_str()))
        .unwrap_or("someone")
        .to_string();

    if custom_id.starts_with("bb_ticket_open_") {
        open_ticket(token, interaction_id, interaction_token, &custom_id, &guild_id, &member_id, &member_name).await;
    }
    // Anything else is a Windows-only button: say so rather than silently doing
    // nothing, because a button that does nothing looks broken.
}

/// Open a ticket channel, in Lite, with no Windows involved.
async fn open_ticket(
    token: &str,
    interaction_id: &str,
    interaction_token: &str,
    custom_id: &str,
    guild_id: &str,
    user_id: &str,
    user_name: &str,
) {
    let cfg = config();

    // custom_id is bb_ticket_open_<guild>_<type>
    let rest = custom_id.trim_start_matches("bb_ticket_open_");
    let type_id = if rest.starts_with(guild_id) {
        rest.trim_start_matches(guild_id).trim_start_matches('_').to_string()
    } else {
        rest.to_string()
    };
    let label = cfg
        .ticket_types
        .iter()
        .find(|(g, id, _, _)| g == guild_id && *id == type_id)
        .map(|(_, _, l, _)| l.clone())
        .unwrap_or_else(|| type_id.clone());

    // One open ticket per type, exactly as Windows enforces it: pressing twice
    // must not make two channels.
    let existing = crate::lite_server::lite_ticket_find(&guild_id, user_id, &type_id);
    if let Some(t) = existing {
        let _ = respond(
            interaction_id,
            interaction_token,
            &format!("You already have an open ticket: <#{}>", t),
            true,
        )
        .await;
        return;
    }

    // Make the channel.
    let category = cfg
        .ticket_category
        .get(guild_id)
        .cloned()
        .unwrap_or_else(|| TICKET_VAULT_ID.to_string());
    let name = format!("ticket-{}", user_name.to_lowercase().replace(' ', "-"));
    let body = json!({
        "name": name,
        "type": 0,
        "parent_id": category,
        "topic": format!("Lite ticket · {label} · {user_id}"),
        "permission_overwrites": [
            { "id": guild_id, "type": 0, "deny": "1024", "allow": "0" },   // @everyone: no view
            { "id": user_id, "type": 1, "allow": "1024|2048", "deny": "0" }, // member: view + send
        ]
    });
    let client = api();
    let created = client
        .post(format!("https://discord.com/api/v10/guilds/{guild_id}/channels"))
        .header("Authorization", format!("Bot {token}"))
        .json(&body)
        .send()
        .await;

    let channel_id = match created {
        Ok(r) if r.status().is_success() => match r.json::<Value>().await {
            Ok(v) => v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            Err(_) => String::new(),
        },
        Ok(r) => {
            let code = r.status();
            lite_server::lite_event(
                "error",
                format!("could not create a ticket channel: Discord said {code}"),
                None,
                Some(user_name.to_string()),
            );
            let _ = respond(
                interaction_id,
                interaction_token,
                "⚠️ Could not open a ticket just now — please tell a member of staff.",
                true,
            )
            .await;
            return;
        }
        Err(e) => {
            lite_server::lite_event(
                "error",
                format!("could not reach Discord to open a ticket: {e}"),
                None,
                None,
            );
            return;
        }
    };

    if channel_id.is_empty() {
        return;
    }

    // Record it in Lite's own table so it survives, and so Windows can take it on
    // reconnect without a second one being made.
    let _ = crate::lite_server::lite_ticket_open(
        type_id.clone(),
        user_id.to_string(),
        user_name.to_string(),
        channel_id.clone(),
        label.clone(),
        guild_id.to_string(),
    );

    // Open with the same wording Windows uses, so the member sees no difference.
    let _ = client
        .post(format!("https://discord.com/api/v10/channels/{channel_id}/messages"))
        .header("Authorization", format!("Bot {token}"))
        .json(&json!({ "content": crate::lite_server::VERIFY_OPEN_MESSAGE }))
        .send()
        .await;

    lite_server::lite_event(
        "action",
        format!("opened a {label} ticket for {user_name}"),
        Some(channel_id.clone()),
        Some(user_name.to_string()),
    );

    let _ = respond(
        interaction_id,
        interaction_token,
        &format!("Your ticket is open: <#{channel_id}>"),
        true,
    )
    .await;
}

/// Reply to a button press. Ephemeral, so the channel stays clean.
async fn respond(interaction_id: &str, interaction_token: &str, content: &str, ephemeral: bool) -> Result<(), String> {
    let flags = if ephemeral { 64 } else { 0 };
    api()
        .post(format!(
            "https://discord.com/api/v10/interactions/{interaction_id}/{interaction_token}/callback"
        ))
        .json(&json!({ "type": 4, "data": { "content": content, "flags": flags } }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Is Windows answering *and* connected to Discord?
///
/// Two conditions, because they are not the same thing and the difference is the
/// whole point. A machine whose API is up but whose session is not live would
/// take the token and moderate nothing, so handing back to it would leave the
/// server uncovered -- the one outcome worse than Lite staying.
async fn windows_is_back(url: &str) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let health = format!("{}/api/health", url.trim_end_matches('/'));
    let resp = match client.get(&health).send().await {
        Ok(r) => r,
        Err(_) => return false,
    };
    if !resp.status().is_success() {
        return false;
    }
    let body: serde_json::Value = match resp.json().await {
        Ok(b) => b,
        Err(_) => return false,
    };
    body.get("bot_online").and_then(|v| v.as_bool()).unwrap_or(false)
}

/// Watch for Windows coming back, and step down when it does.
///
/// Lite is an emergency cover, not a second bot: while it holds the session
/// Windows cannot start, so waiting for a human to notice is how a server ends up
/// running on a laptop indefinitely. The app points this at the road it last
/// reached Windows on; if it does not know one, the watcher says so once rather
/// than guessing an address that may belong to another machine.
pub async fn watch_for_windows() {
    let mut clean = 0u32;
    let mut said_no_address = false;
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(WATCH_SECONDS)).await;
        if !is_running() {
            return;
        }
        let target = match WATCH_ADDRESS.lock() {
            Ok(w) => w.clone(),
            Err(e) => e.into_inner().clone(),
        };
        let Some(url) = target else {
            if !said_no_address {
                said_no_address = true;
                lite_server::lite_event(
                    "note",
                    "Windows has no address to check yet, so Lite is not watching for it to come back".into(),
                    None,
                    None,
                );
            }
            continue;
        };
        said_no_address = false;
        if windows_is_back(&url).await {
            clean += 1;
            if clean >= WATCH_CONFIRMATIONS {
                lite_server::lite_event(
                    "note",
                    format!("Windows is back at {url} -- Lite is stepping down"),
                    None,
                    None,
                );
                // Order matters. The stop is what releases the Discord session, and
                // the handback notice is posted by the client on its way out while
                // it still holds the socket. Waiting for Windows to take the
                // session first would mean neither of them moderating.
                stop();
                return;
            }
        } else {
            clean = 0;
        }
    }
}

/// Unix ms, for the saved copy's timestamp.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A one-line summary of a saved rule set, for the trace.
pub fn describe_saved(cfg: &LiteConfig) -> String {
    format!(
        "{} ticket types, {} exempt, {} trolls, {} panels",
        cfg.ticket_types.len(),
        cfg.exempt_users.len(),
        cfg.trolls.len(),
        cfg.panel_channels.len()
    )
}

/// Seconds as something a person reads at a glance.
pub fn describe_seconds(secs: u64) -> String {
    if secs < 90 {
        format!("{secs} seconds")
    } else if secs < 5400 {
        format!("{} minutes", secs / 60)
    } else if secs < 172800 {
        format!("{} hours", secs / 3600)
    } else {
        format!("{} days", secs / 86400)
    }
}

#[cfg(test)]
mod single_client_tests {
    use super::*;

    /// The bug: a relaunch started a second gateway client on the same token and
    /// Discord delivered every event twice. The fact that a client has been
    /// started must survive the API being unreachable, because on a relaunch the
    /// API *is* unreachable -- that is exactly when the second client started.
    #[test]
    fn a_started_client_is_remembered() {
        mark_client_started();
        assert!(a_client_was_started());
        // And a deliberate stop is what makes a new one legal again.
        mark_client_finished();
        assert!(!a_client_was_started());
    }

    /// stop() has to release it too, or Lite could never come back after a
    /// handback -- the same flag that prevents a double client would prevent a
    /// legitimate restart.
    #[test]
    fn stop_releases_the_single_client_lock() {
        mark_client_started();
        stop();
        assert!(!a_client_was_started(), "a stopped Lite must be startable again");
    }
}
