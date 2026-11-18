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
        }
    }
}

static RUNNING: AtomicBool = AtomicBool::new(false);
static CONFIG: Mutex<Option<LiteConfig>> = Mutex::new(None);

pub fn is_running() -> bool {
    RUNNING.load(Ordering::SeqCst)
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
}

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
    RUNNING.store(true, Ordering::SeqCst);
    lite_server::lite_event(
        "note",
        "BabbleBot Lite is connecting to Discord".into(),
        None,
        None,
    );

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
                        "intents": 1 | 512 | 4096 | 32768,   // GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
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
                    let cfg = config();
                    announce_switch(token, &cfg).await;
                } else if t == "MESSAGE_CREATE" {
                    handle_message(token, &v).await;
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
    if cmd != "verify" {
        return;
    }

    let guild_id = d.get("guild_id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let channel_id = d.get("channel_id").and_then(|x| x.as_str()).unwrap_or("").to_string();
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
                { "name": "Watching", "value": format!("{guild_count} server{} · {rule_count} channel rule{}", if guild_count == 1 { "" } else { "s" }, if rule_count == 1 { "" } else { "s" }), "inline": true },
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
