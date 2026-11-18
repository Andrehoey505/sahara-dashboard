//! Finding Babblebot on the network instead of being told where it is.
//!
//! ## The problem this exists for
//!
//! The dashboard used to assume an address. When the Windows laptop's IP moved
//! from .131 to .128, the app kept knocking at the old door and reported the bot
//! down while it was sitting right there, answering in 20ms. A hardcoded address
//! is a guess that is right until it is wrong, and it is wrong silently.
//!
//! ## The order, cheapest first
//!
//! 1. **What we found last time.** One request, seconds. Usually this is the end
//!    of it, and nothing else is tried.
//! 2. **Broadcast on the network this Mac is actually on.** A single UDP packet to
//!    the broadcast address; whoever is listening answers with its own address.
//!    Never a subnet sweep: 254 probes look like an attack, take half a minute,
//!    and find nothing a broadcast would not have found instantly.
//! 3. **Tailscale.** Always known, always works if the tunnel is up, slower.
//!
//! ## What discovery failing must NOT mean
//!
//! Nothing answering is ambiguous. It could be "the bot is down" -- which should
//! raise the alarm and offer the handover -- or "the bot is up and we have not
//! found it", which should do neither. Starting Lite on the second one puts two
//! processes on one Discord token and kicks the healthy bot off its session,
//! which is the exact failure this whole system is built to avoid.
//!
//! So this module only ever reports *what it found*. The decision to call
//! something down belongs to the caller, which is the only place that knows
//! whether every road was actually tried.

use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::time::{Duration, Instant};

use serde_json::Value;

/// The magic string Babblebot answers to. Deliberately not a JSON body: the
/// answer has to be recognisable from one datagram without parsing anything.
pub const PING: &[u8] = b"BABBLEBOT_DISCOVER";

/// How long to wait for an answer. A broadcast on a home LAN is answered in
/// single-digit milliseconds; a second is generous and keeps a dead network from
/// stalling the connect screen.
const WAIT: Duration = Duration::from_secs(1);

/// How many times to shout before giving up. Broadcast can be dropped by a busy
/// access point, and two attempts cost one extra second in the worst case.
const ATTEMPTS: usize = 2;

/// What a successful discovery found.
#[derive(Clone, Debug)]
pub struct Found {
    pub address: String,
    pub port: u16,
    /// Whatever the bot said about itself. Free-form on purpose: the app must not
    /// break when Babblebot adds a field, and must not require one it does not send.
    pub info: Value,
}

/// The address to broadcast to on the network this machine is on.
///
/// ## Why this is not just 255.255.255.255
///
/// The global broadcast address reaches every interface the OS feels like using,
/// including Tailscale's, which never answers and which some configurations will
/// happily spend a second on. Asking for the *interface's own* broadcast address
/// means the packet goes out of exactly one door, on the network the Mac is
/// really attached to -- which is also why a Mac on a hotspot simply finds
/// nothing and falls through to Tailscale instead of waiting.
pub fn broadcast_addresses() -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = Vec::new();

    // `ifconfig` rather than a new crate. This runs once per connect attempt, not
    // per request, and the alternative is a dependency for four numbers.
    if let Ok(text) = std::process::Command::new("/sbin/ifconfig").output() {
        let text = String::from_utf8_lossy(&text.stdout);
        for line in text.lines() {
            // "	inet 192.168.1.94 netmask 0xffffff00 broadcast 192.168.1.255"
            let line = line.trim();
            if !line.starts_with("inet ") {
                continue;
            }
            let bcast = line
                .split_whitespace()
                .skip_while(|w| *w != "broadcast")
                .nth(1)
                .and_then(|s| s.parse::<Ipv4Addr>().ok());
            if let Some(b) = bcast {
                if !out.contains(&b) {
                    out.push(b);
                }
            }
        }
    }

    // The global address as a last resort, but only if the interfaces gave us
    // nothing: a Mac with no broadcast lines still has a LAN.
    if out.is_empty() {
        out.push(Ipv4Addr::new(255, 255, 255, 255));
    }
    out
}

/// Shout on the LAN and see who answers.
///
/// Returns the first real answer. `None` means nobody answered -- which is a
/// statement about this network, never a verdict on the bot.
pub fn discover(port: u16) -> Option<Found> {
    let targets = broadcast_addresses();

    for _ in 0..ATTEMPTS {
        // One socket for all targets so a reply cannot be attributed to the wrong
        // shout. Bound to an ephemeral port: nothing else on this Mac listens on
        // the bot's port, and trying to would fight the bot itself.
        let sock = UdpSocket::bind(("0.0.0.0", 0)).ok()?;
        let _ = sock.set_broadcast(true);
        let _ = sock.set_read_timeout(Some(WAIT));

        let mut sent = false;
        for b in &targets {
            if sock.send_to(PING, SocketAddr::from((*b, port))).is_ok() {
                sent = true;
            }
        }
        if !sent {
            continue;
        }

        let deadline = Instant::now() + WAIT;
        let mut buf = [0u8; 4096];
        while Instant::now() < deadline {
            match sock.recv_from(&mut buf) {
                Ok((n, from)) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    // A datagram that is not from a Babblebot is somebody else's
                    // traffic on the same port. Ignore it and keep listening
                    // rather than mistaking it for an answer.
                    let parsed: Value = match serde_json::from_str(&text) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    if parsed.get("service").and_then(|s| s.as_str()) != Some("babblebot") {
                        continue;
                    }
                    let port = parsed
                        .get("port")
                        .and_then(|p| p.as_u64())
                        .unwrap_or(port as u64) as u16;
                    return Some(Found {
                        address: from.ip().to_string(),
                        port,
                        info: parsed,
                    });
                }
                Err(_) => break,
            }
        }
    }
    None
}

/// Ask one specific address who it is.
///
/// This is the HTTP half, and it is what makes discovery useful even before the
/// UDP responder exists on the bot: any address we already suspect can be
/// confirmed rather than assumed.
pub async fn whois(client: &reqwest::Client, base: &str) -> Option<Value> {
    let resp = client
        .get(format!("{}/api/discover", base.trim_end_matches('/')))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: Value = resp.json().await.ok()?;
    if v.get("service").and_then(|s| s.as_str()) != Some("babblebot") {
        return None;
    }
    Some(v)
}

/// Find the bot, and say which road found it.
///
/// ## The order is the whole point
///
/// Remembered, then broadcast, then whatever the caller passes as the fallback
/// (Tailscale). Each answer names the road, because "connected" is not enough
/// information: a LAN connection is fast and unmetered, a Tailscale one depends
/// on the tunnel, and the difference is what the top bar is there to show.
///
/// ## What this never does
///
/// It never decides the bot is down. It returns `found: false` and a list of what
/// it tried, and the caller -- which knows whether the alarm should sound -- makes
/// that call. Starting Lite on an unfound-but-healthy bot would kick it off its
/// Discord session.
#[tauri::command]
pub async fn discover_bot(
    remembered: Option<String>,
    fallback: Option<String>,
) -> serde_json::Value {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .connect_timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "found": false, "error": e.to_string() }),
    };

    let mut tried: Vec<serde_json::Value> = Vec::new();

    // 1. What worked last time.
    if let Some(addr) = remembered.filter(|a| !a.trim().is_empty()) {
        let base = addr.trim().trim_end_matches('/');
        if let Some(info) = whois(&client, base).await {
            return serde_json::json!({
                "found": true, "via": "remembered", "url": base, "info": info,
                "tried": tried,
            });
        }
        tried.push(serde_json::json!({ "url": base, "why": "remembered address did not answer" }));
    }

    // 2. Shout on the network this Mac is actually on.
    //
    // Blocking work on a blocking-friendly thread: it is a UDP wait, and doing it
    // on the async runtime would stall every other request behind it.
    let found = tokio::task::spawn_blocking(|| discover(8080)).await.ok().flatten();
    if let Some(f) = found {
        let base = format!("http://{}:{}", f.address, f.port);
        // Confirm over HTTP before believing it. A datagram says where to look;
        // only a real answer says the bot is there.
        if let Some(info) = whois(&client, &base).await {
            return serde_json::json!({
                "found": true, "via": "lan", "url": base, "info": info,
                "tried": tried,
            });
        }
        tried.push(serde_json::json!({
            "url": base,
            "why": "answered the broadcast but not over HTTP"
        }));
    } else {
        tried.push(serde_json::json!({
            "url": "broadcast",
            "why": "nothing on this network answered"
        }));
    }

    // 3. The fallback road, whatever the caller passed.
    if let Some(addr) = fallback.filter(|a| !a.trim().is_empty()) {
        let base = addr.trim().trim_end_matches('/');
        if whois(&client, base).await.is_some() {
            return serde_json::json!({
                "found": true, "via": "tailscale", "url": base, "tried": tried,
            });
        }
        tried.push(serde_json::json!({ "url": base, "why": "fallback did not answer" }));
    }

    serde_json::json!({ "found": false, "tried": tried })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A machine with no broadcast lines still has to try something, or a Mac
    /// that is on a network the parser did not recognise would never discover
    /// anything at all.
    #[test]
    fn always_has_at_least_one_target() {
        assert!(!broadcast_addresses().is_empty());
    }

    /// The ping has to be recognisable in one datagram without parsing, so it is
    /// a fixed string rather than JSON.
    #[test]
    fn ping_is_its_own_magic() {
        assert_eq!(PING, b"BABBLEBOT_DISCOVER");
        assert!(std::str::from_utf8(PING).is_ok());
    }
}
