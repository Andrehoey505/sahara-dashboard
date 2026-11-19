/**
 * Every screen id the app knows how to render.
 *
 * The main content area renders each screen behind its own `active` check, so
 * this list isn't used to gate rendering — it exists so a nav item with no
 * matching screen is caught in development instead of showing a blank page.
 */
export const SCREENS = [
  "dashboard",
  "schedule",
  "edwaits",
  "livefeed",
  "violations",
  "members",
  "moderation",
  "trollwatch",
  "trolls",
  "audit",
  "music",
  "activities",
  "migraine",
  "armcare",
  "reactionroles",
  "tickets",
  "relay",
  "mentions",
  "database",
  "storage",
  "system",
  "config",
  "settings",
] as const;

export type ScreenId = (typeof SCREENS)[number];
