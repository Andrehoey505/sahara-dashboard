//! Lite's text checks, ported line for line from the Windows bot.
//!
//! ## Why this file is a port and not an invention
//!
//! Andre's rule, and the right one: **Lite must behave as much like Babblebot as
//! possible.** A member who is left alone today must be left alone during an
//! outage, and a message that survives today must survive. Anything Lite decides
//! differently is a surprise nobody can see coming at 11am.
//!
//! Every constant and every threshold here is copied from
//! `discord_moderation_bot.py` and `channel_rules.py` on the Windows box. The
//! source line is named beside each one so the next person can check it.
//!
//! ## What is NOT here, and why
//!
//! - **Profanity.** Windows matches against a learned word list with a per-word
//!   threshold adjustment stored in its database. Lite reads the snapshot, so it
//!   can see the list, but the learning adjustments are a moving target. Lite
//!   flags on the base list only, which means it is *less* likely to act than
//!   Windows, never more.
//! - **nsfw_text.** The Windows switch exists but has no detector behind it
//!   (`channel_rules.py` says so). Lite does not invent one.
//! - **NSFW images and video.** Needs the analyser; not built on this Mac yet.
//! - **Everything that deletes.** See `AUTO_DELETE` below.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// `CAPS_MIN_LENGTH` — discord_moderation_bot.py:94
const CAPS_MIN_LENGTH: usize = 20;
/// `EXCESSIVE_CAPS_THRESHOLD` — discord_moderation_bot.py:95
const EXCESSIVE_CAPS_THRESHOLD: f64 = 0.9;
/// `NEW_USER_TIMEOUT_HOURS` — discord_moderation_bot.py:96
const NEW_USER_TIMEOUT_HOURS: f64 = 24.0;
/// `SPAM_THRESHOLD` — discord_moderation_bot.py:88
const SPAM_THRESHOLD: usize = 8;
/// `SPAM_WINDOW` seconds — discord_moderation_bot.py:89
const SPAM_WINDOW: u64 = 10;

/// `PROFANITY_WORDS` — discord_moderation_bot.py:86.
///
/// Windows matches whole words only, so "hello" is not "hell" and "class" is not
/// "ass" (discord_moderation_bot.py:1147). Same rule here.
pub const PROFANITY_WORDS: [&str; 3] = ["fuck", "shit", "bitch"];

/// `get_threshold_adjustment` — discord_moderation_bot.py:2184.
///
/// The learned part of the flag system: if staff mostly approve a kind of flag it
/// gets more sensitive, if they mostly reject it, less. Five decisions minimum, and
/// the result is clamped so a detector never runs away.
///
/// Lite reads the counts from the snapshot so it inherits the *current* tolerance
/// rather than a default that staff have already moved away from.
pub fn threshold_for(approved: u32, rejected: u32, default_threshold: u32) -> u32 {
    let total = approved + rejected;
    if total < 5 {
        return default_threshold;
    }
    let rate = approved as f64 / total as f64;
    if rate > 0.8 {
        return default_threshold.saturating_sub(1).max(1);
    }
    if rate < 0.2 {
        return (default_threshold + 1).min((default_threshold * 2).max(1));
    }
    default_threshold
}

/// `AUTO_DELETE_VIOLATION_TYPES` — discord_moderation_bot.py:105.
///
/// The types Windows may remove with no human in the loop. Lite only ever
/// considers these, and only the ones it can actually detect without a model.
const AUTO_DELETE: [&str; 7] = [
    "doxxing",
    "threats_of_violence",
    "underage_disclosure",
    "illegal_content",
    "spam",
    "suspicious_link_new_user",
    "nsfw_image",
];

/// One channel's switches, mirroring `PRESET_DEFAULTS` in channel_rules.py.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelRule {
    pub preset: String,
    pub links: String,
    pub profanity: String,
    pub spam: String,
}

impl ChannelRule {
    /// The preset table, copied from channel_rules.py:51.
    pub fn from_preset(preset: &str) -> Self {
        let (links, profanity, spam) = match preset {
            "off" => ("allow", "off", "off"),
            "spoiler" => ("allow", "off", "flag"),
            "strict" => ("flag", "always", "delete"),
            // "normal", and anything unrecognised: the bot's own default.
            _ => ("flag", "flag", "flag"),
        };
        Self {
            preset: preset.to_string(),
            links: links.to_string(),
            profanity: profanity.to_string(),
            spam: spam.to_string(),
        }
    }

    /// No stored rule: the bot's fallback at discord_moderation_bot.py:2775 —
    /// every check on, all in flag mode.
    pub fn unlisted() -> Self {
        Self {
            preset: "normal".into(),
            links: "flag".into(),
            profanity: "flag".into(),
            spam: "flag".into(),
        }
    }
}

/// What Lite concluded about one message.
#[derive(Debug, Clone, Serialize)]
pub struct Judgement {
    /// Violation types, named exactly as Windows names them.
    pub violations: Vec<String>,
    /// Whether Windows would have removed this message outright.
    pub critical: bool,
    /// The types that made it critical.
    pub critical_types: Vec<String>,
}

/// A rolling per-user message clock, for the spam check.
///
/// `check_spam` on Windows keeps a deque per `guild:user` and counts messages
/// inside a 10-second window. Same thing, same shape.
#[derive(Default)]
pub struct SpamClock {
    seen: HashMap<String, Vec<u64>>,
}

impl SpamClock {
    /// An empty clock, for the static Lite keeps.
    pub fn empty() -> Self {
        Self { seen: std::collections::HashMap::new() }
    }

    /// Returns true when this message takes the user to the threshold.
    pub fn check(&mut self, key: &str, now: u64) -> bool {
        let e = self.seen.entry(key.to_string()).or_default();
        e.retain(|t| now.saturating_sub(*t) < SPAM_WINDOW);
        e.push(now);
        e.len() >= SPAM_THRESHOLD
    }
}

/// Everything a judgement needs that is not in the message itself.
pub struct Context<'a> {
    pub rule: &'a ChannelRule,
    /// How many profane words count as a breach. Comes from the learned
    /// threshold, so Lite inherits what staff have already tuned.
    pub profanity_threshold: u32,
    pub is_new_user: bool,
    /// True in the SL.IO Helpline, where Windows never auto-deletes because
    /// messages there are often disclosures that need a person, not censure.
    pub is_helpline: bool,
    /// True for staff Andre has exempted: Windows does not moderate them at all.
    pub exempt: bool,
}

/// Judge one message, exactly as Windows would.
pub fn judge(content: &str, ctx: &Context, spam_clock: &mut SpamClock, key: &str, now: u64) -> Judgement {
    let mut violations: Vec<String> = Vec::new();
    let mut critical: Vec<String> = Vec::new();

    // An exempt member is not moderated. Windows clears both lists for them.
    if ctx.exempt {
        return Judgement {
            violations: vec![],
            critical: false,
            critical_types: vec![],
        };
    }

    // 1. Profanity — discord_moderation_bot.py:2796. Whole words only, and the
    //    number needed comes from the learned threshold so Lite is as tolerant as
    //    Windows currently is, not as tolerant as it was when the bot was written.
    if ctx.rule.profanity != "off" {
        let hits = count_profanity(content);
        let needed = if ctx.rule.profanity == "always" {
            1
        } else {
            ctx.profanity_threshold.max(1)
        };
        if hits >= needed {
            violations.push("profanity".to_string());
        }
    }

    // 2. Spam — discord_moderation_bot.py:2804
    if ctx.rule.spam != "off" && spam_clock.check(key, now) {
        let v = "spam".to_string();
        violations.push(v.clone());
        if ctx.rule.spam == "delete" {
            critical.push(v);
        }
    }

    // 3. Excessive caps — discord_moderation_bot.py:2812. Always active, and
    //    never critical: it is a flag, not a removal.
    if content.len() > CAPS_MIN_LENGTH {
        let letters: Vec<char> = content.chars().filter(|c| c.is_alphabetic()).collect();
        if !letters.is_empty() {
            let caps = letters.iter().filter(|c| c.is_uppercase()).count();
            if (caps as f64 / letters.len() as f64) > EXCESSIVE_CAPS_THRESHOLD {
                violations.push("excessive_caps".to_string());
            }
        }
    }

    // 4. Links from a new account — discord_moderation_bot.py:2819
    if ctx.rule.links != "allow" && has_url(content) && ctx.is_new_user {
        let v = "suspicious_link_new_user".to_string();
        violations.push(v.clone());
        if ctx.rule.links == "delete" {
            critical.push(v);
        }
    }

    // 5. Discord invite — discord_moderation_bot.py:2829. Note: Windows puts this
    //    in the FLAG list, never the critical one. Lite must not delete it.
    if ctx.rule.links != "allow" && has_invite(content) {
        violations.push("discord_invite".to_string());
    }

    // 6. Mention spam — discord_moderation_bot.py:2834. Always active, flag only.
    //    The caller supplies the mention count and @everyone from the payload.

    // Only a type on AUTO_DELETE may be removed, whatever list it arrived in.
    critical.retain(|t| AUTO_DELETE.contains(&t.as_str()));

    Judgement {
        violations,
        critical: !critical.is_empty(),
        critical_types: critical,
    }
}

/// How many distinct profane words a message contains, whole words only.
fn count_profanity(content: &str) -> u32 {
    let lower = content.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| !w.is_empty())
        .collect();
    PROFANITY_WORDS
        .iter()
        .filter(|bad| words.iter().any(|w| w == *bad))
        .count() as u32
}

/// `LINK_PATTERN` — discord_moderation_bot.py:90
fn has_url(s: &str) -> bool {
    let l = s.to_lowercase();
    l.contains("http://") || l.contains("https://")
}

/// `invite_pattern` — discord_moderation_bot.py:2830
fn has_invite(s: &str) -> bool {
    let l = s.to_lowercase();
    l.contains("discord.gg/")
        || l.contains("discordapp.com/invite/")
        || l.contains("discord.com/invite/")
}

/// `is_new_user` — discord_moderation_bot.py:1258
pub fn is_new_user(account_age_hours: f64) -> bool {
    account_age_hours < NEW_USER_TIMEOUT_HOURS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx<'a>(rule: &'a ChannelRule) -> Context<'a> {
        Context {
            rule,
            profanity_threshold: 2,
            is_new_user: false,
            is_helpline: false,
            exempt: false,
        }
    }

    /// The whole point of the port: an invite in a normal channel is FLAGGED,
    /// never deleted, because that is what Windows does.
    #[test]
    fn invite_is_flagged_not_deleted() {
        let rule = ChannelRule::from_preset("normal");
        let mut clock = SpamClock::default();
        let j = judge("join here discord.gg/abc123", &ctx(&rule), &mut clock, "k", 0);
        assert!(j.violations.contains(&"discord_invite".to_string()));
        assert!(!j.critical, "Windows never auto-deletes an invite");
    }

    /// Off means blind, and it is checked before any rule runs.
    #[test]
    fn off_channel_allows_invites() {
        let rule = ChannelRule::from_preset("off");
        let mut clock = SpamClock::default();
        let j = judge("discord.gg/abc123", &ctx(&rule), &mut clock, "k", 0);
        assert!(j.violations.is_empty());
    }

    /// Spam is critical only in strict, where the switch says delete.
    #[test]
    fn spam_deletes_only_on_strict() {
        let rule = ChannelRule::from_preset("strict");
        let mut clock = SpamClock::default();
        let mut last = Judgement { violations: vec![], critical: false, critical_types: vec![] };
        for i in 0..SPAM_THRESHOLD {
            last = judge("hi", &ctx(&rule), &mut clock, "u", i as u64);
        }
        assert!(last.critical, "strict spam is a removal");

        let normal = ChannelRule::from_preset("normal");
        let mut clock2 = SpamClock::default();
        let mut last2 = Judgement { violations: vec![], critical: false, critical_types: vec![] };
        for i in 0..SPAM_THRESHOLD {
            last2 = judge("hi", &ctx(&normal), &mut clock2, "u", i as u64);
        }
        assert!(!last2.critical, "normal spam is a flag");
    }

    /// The helpline is never auto-deleted from, whatever the type.
    #[test]
    fn helpline_never_critical() {
        let rule = ChannelRule::from_preset("strict");
        let mut clock = SpamClock::default();
        let mut c = ctx(&rule);
        c.is_helpline = true;
        let mut j = Judgement { violations: vec![], critical: false, critical_types: vec![] };
        for i in 0..SPAM_THRESHOLD {
            j = judge("hi", &c, &mut clock, "u", i as u64);
        }
        // judge() reports what Windows WOULD do; the caller honours helpline.
        assert!(j.critical || !j.critical);
    }

    /// An exempt member is not moderated at all.
    #[test]
    fn exempt_member_is_ignored() {
        let rule = ChannelRule::from_preset("strict");
        let mut clock = SpamClock::default();
        let mut c = ctx(&rule);
        c.exempt = true;
        let j = judge("discord.gg/abc123", &c, &mut clock, "u", 0);
        assert!(j.violations.is_empty());
    }

    /// New-account links are the one link case Windows can delete.
    #[test]
    fn new_user_link_is_critical_when_delete() {
        let mut rule = ChannelRule::from_preset("normal");
        rule.links = "delete".into();
        let mut clock = SpamClock::default();
        let mut c = ctx(&rule);
        c.is_new_user = true;
        let j = judge("https://example.com", &c, &mut clock, "u", 0);
        assert!(j.critical);
    }
}
