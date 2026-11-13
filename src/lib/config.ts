/**
 * Everything a server can configure, described once.
 *
 * The list of settings, their labels, defaults and which kind of control each
 * one needs comes from the bot (`/api/config/schema`) so the two sides cannot
 * drift apart. If the bot is unreachable this local copy keeps the screen
 * usable instead of showing an empty form.
 */

export type SettingKind = "bool" | "list" | "channel" | "role" | "text";

export type Schema = {
  defaults: Record<string, any>;
  labels: Record<string, string>;
  sections: Record<string, string[]>;
  channel_keys: string[];
  role_keys: string[];
  bool_keys: string[];
  list_keys: string[];
  text_keys: string[];
};

/** Used until the bot answers, and if it never does. */
export const FALLBACK_SCHEMA: Schema = {
  defaults: {
    prefix: "bb!",
    log_channel: "",
    log_events: ["violation_detected", "action_taken", "member_banned", "member_joined"],
    welcome_channel: "",
    welcome_message: "Welcome {user} to {server}!",
    goodbye_message: "",
    hitl_enabled: true,
    troll_watch_enabled: true,
    ticket_category: "",
    ticket_staff_role: "",
    ticket_panel_channel: "",
    ticket_open_message: "Thanks — a member of staff will be with you shortly.",
    ticket_transcript: true,
  },
  labels: {
    prefix: "Command prefix",
    log_channel: "Mod log channel",
    log_events: "Events sent to the log",
    welcome_channel: "Welcome channel",
    welcome_message: "Welcome message",
    goodbye_message: "Goodbye message",
    hitl_enabled: "Approve before acting",
    troll_watch_enabled: "Watch suspicious joins",
    ticket_category: "Ticket category",
    ticket_staff_role: "Ticket staff role",
    ticket_panel_channel: "Ticket panel channel",
    ticket_open_message: "Message when a ticket opens",
    ticket_transcript: "Save a transcript on close",
  },
  sections: {
    general: ["prefix"],
    logging: ["log_channel", "log_events"],
    welcome: ["welcome_channel", "welcome_message", "goodbye_message"],
    automod: ["hitl_enabled", "troll_watch_enabled"],
    // tickets_enabled used to head this list. Nothing respected it — each ticket
    // type has its own switch on the Tickets screen — so it has been removed from
    // the bot and from here rather than left as a toggle that changes nothing.
    tickets: [
      "ticket_category",
      "ticket_staff_role",
      "ticket_panel_channel",
      "ticket_open_message",
      "ticket_transcript",
    ],
  },
  channel_keys: ["log_channel", "welcome_channel", "ticket_category", "ticket_panel_channel"],
  role_keys: ["ticket_staff_role"],
  bool_keys: [
    "hitl_enabled",
    "troll_watch_enabled",
    "ticket_transcript",
  ],
  list_keys: ["log_events"],
  text_keys: [
    "prefix",
    "welcome_message",
    "goodbye_message",
    "ticket_open_message",
  ],
};

export function kindOf(key: string, schema: Schema): SettingKind {
  if (schema.bool_keys.includes(key)) return "bool";
  if (schema.list_keys.includes(key)) return "list";
  if (schema.channel_keys.includes(key)) return "channel";
  if (schema.role_keys.includes(key)) return "role";
  return "text";
}

export const SECTION_LABELS: Record<string, string> = {
  general: "General",
  logging: "Logging",
  welcome: "Welcomes",
  automod: "Safety",
  tickets: "Tickets",
  verification: "Verification",
  extras: "Extras",
};

export const SECTION_HINTS: Record<string, string> = {
  general: "How people talk to the bot in this server.",
  logging: "Where moderation events are posted, and which ones.",
  welcome: "What a new member sees when they join.",
  automod: "Whether the bot watches suspicious joins, and whether you approve before it acts.",
  tickets: "Staff support. Members open a ticket and get their own channel.",
  verification: "A gate before people can post.",
  extras: "Optional features. Turning one off stops the bot offering it.",
};

/** The events automod can post about, so the picker isn't a free-text guess. */
export const LOG_EVENTS = [
  "violation_detected",
  "action_taken",
  "action_failed",
  "flag_for_review",
  "member_banned",
  "member_unbanned",
  "member_joined",
  "member_left",
  "message_deleted",
  "message_edited",
  "troll_banned",
  "verification_complete",
];

export const AUTOMOD_CHECKS = [
  "profanity",
  "nsfw",
  "spam",
  "invites",
  "links",
  "caps",
  "mentions",
];

/** Human wording for the stored event names. */
export const EVENT_LABELS: Record<string, string> = {
  violation_detected: "Violation detected",
  action_taken: "Action taken",
  action_failed: "Action failed",
  flag_for_review: "Flagged for review",
  member_banned: "Member banned",
  member_unbanned: "Member unbanned",
  member_joined: "Member joined",
  member_left: "Member left",
  message_deleted: "Message deleted",
  message_edited: "Message edited",
  troll_banned: "Troll banned",
  verification_complete: "Verified",
  profanity: "Profanity",
  nsfw: "NSFW",
  spam: "Spam",
  invites: "Discord invites",
  links: "Links",
  caps: "Excessive caps",
  mentions: "Mass mentions",
};
