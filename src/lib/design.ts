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
