/**
 * Shared design tokens.
 *
 * One spacing scale, one accent, a small type scale. Every screen pulls from
 * here so the app stays consistent as it grows, instead of each section
 * inventing its own values.
 */

/** Spacing scale — use these, don't improvise. */
export const space = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  xxl: "32px",
  xxxl: "48px",
  huge: "64px",
} as const;

/** Motion timings. Local feedback is quick; entrances are slightly slower. */
export const motionTokens = {
  fast: { duration: 0.15, ease: "easeOut" },
  base: { duration: 0.2, ease: "easeOut" },
  enter: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
  exit: { duration: 0.15, ease: "easeIn" },
} as const;

/** The single accent used for the primary action on any screen. */
export const accent = {
  from: "from-indigo-500",
  to: "to-violet-600",
  text: "text-indigo-300",
  ring: "ring-indigo-500/40",
} as const;

/** Semantic colours. Always paired with a word or icon, never colour alone. */
export const severity = {
  critical: { text: "text-rose-300", bg: "bg-rose-500/10", border: "border-rose-500/30", label: "Critical" },
  high: { text: "text-orange-300", bg: "bg-orange-500/10", border: "border-orange-500/30", label: "High" },
  medium: { text: "text-amber-300", bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Medium" },
  low: { text: "text-sky-300", bg: "bg-sky-500/10", border: "border-sky-500/30", label: "Low" },
} as const;

export type SeverityKey = keyof typeof severity;

/** ED wait colour ramp: calm green, amber, then rose. Always shown with "min". */
export function waitTone(minutes?: number | null): string {
  if (minutes == null) return "text-slate-500";
  if (minutes < 90) return "text-emerald-400";
  if (minutes < 180) return "text-amber-400";
  return "text-rose-400";
}

/** "Updated 12 min ago" — absolute time stays in the title attribute. */
export function relativeMinutes(fromMs: number, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - fromMs) / 60000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? "1 hr ago" : `${hrs} hr ago`;
}

/** Respect the OS reduced-motion setting. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Per-area colour identity.
 *
 * Each section of the app owns a hue so you can tell at a glance where you are:
 * the health screens feel warm and clinical, moderation feels like an alarm,
 * media feels like a player. Every tone is a set of class strings rather than a
 * raw colour so light/dark/midnight themes keep working.
 */
export const areaTone = {
  overview: {
    name: "Overview",
    grad: "from-indigo-500 to-violet-600",
    text: "text-indigo-300",
    soft: "bg-indigo-500/12",
    border: "border-indigo-500/30",
    glow: "shadow-indigo-500/20",
    dot: "bg-indigo-400",
  },
  health: {
    name: "Health",
    grad: "from-rose-500 to-orange-500",
    text: "text-rose-300",
    soft: "bg-rose-500/12",
    border: "border-rose-500/30",
    glow: "shadow-rose-500/20",
    dot: "bg-rose-400",
  },
  server: {
    name: "Server",
    grad: "from-sky-500 to-cyan-500",
    text: "text-sky-300",
    soft: "bg-sky-500/12",
    border: "border-sky-500/30",
    glow: "shadow-sky-500/20",
    dot: "bg-sky-400",
  },
  moderation: {
    name: "Moderation",
    grad: "from-amber-500 to-rose-500",
    text: "text-amber-300",
    soft: "bg-amber-500/12",
    border: "border-amber-500/30",
    glow: "shadow-amber-500/20",
    dot: "bg-amber-400",
  },
  media: {
    name: "Media",
    grad: "from-fuchsia-500 to-purple-600",
    text: "text-fuchsia-300",
    soft: "bg-fuchsia-500/12",
    border: "border-fuchsia-500/30",
    glow: "shadow-fuchsia-500/20",
    dot: "bg-fuchsia-400",
  },
  settings: {
    name: "Settings",
    grad: "from-slate-500 to-slate-700",
    text: "text-slate-300",
    soft: "bg-slate-500/12",
    border: "border-slate-500/30",
    glow: "shadow-slate-500/20",
    dot: "bg-slate-400",
  },
} as const;

export type AreaKey = keyof typeof areaTone;

/** Map a screen id onto the area it belongs to, for nav colouring and headers. */
export const screenArea: Record<string, AreaKey> = {
  dashboard: "overview",
  migraine: "health",
  armcare: "health",
  edwaits: "health",
  livefeed: "server",
  members: "server",
  activities: "server",
  reactionroles: "server",
  moderation: "moderation",
  violations: "moderation",
  trollwatch: "moderation",
  trolls: "moderation",
  audit: "moderation",
  music: "media",
  spotify: "media",
  settings: "settings",
};

export function areaFor(screenId: string): (typeof areaTone)[AreaKey] {
  return areaTone[screenArea[screenId] ?? "overview"];
}

/** Staggered entrance for lists of cards. */
export const stagger = (i: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, delay: Math.min(i * 0.04, 0.3), ease: [0.16, 1, 0.3, 1] as const },
});
