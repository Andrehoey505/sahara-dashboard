/**
 * The daily schedule.
 *
 * Everything here is local: the app owns the schedule and its ticks, so it keeps
 * working with the bot down, mid-restart, or away from the LAN. The bot is told
 * about it (posting the day to a channel and updating it when something is
 * ticked) but it is never the source of truth — otherwise a staff member ticking
 * an item in Discord would silence Andre's own reminder for something he hasn't
 * actually done.
 *
 * Rules that came out of the conversation, and why:
 * - A nag fires at its time, once, and again 45 minutes later if it's still not
 *   ticked. Two chances, then it drops it. A nag that never stops is noise.
 * - Sleep mode suppresses everything and NOTHING is queued. Four nags arriving
 *   at once when he wakes up is worse than none.
 * - A skipped *food* nag is simply lost; a skipped *medication* nag is held and
 *   fires on waking. Food is a nudge, medication is a dose.
 * - The morning inhaler is not a fixed time: it hangs off the "wake up" press,
 *   so a 10am wake and a 2pm wake behave the same.
 * - The as-needed inhaler is never nagged. It is a log button, because the
 *   number a GP wants is how often it was needed, not that he was reminded.
 */

export type SlotKind = "food" | "drink" | "medication" | "selfcare" | "free" | "chore" | "asneeded";

export type Slot = {
  id: string;
  /** What the nag says. Short — it has to be readable on a lock screen. */
  label: string;
  kind: SlotKind;
  /**
   * When it's due.
   * - `time`: a fixed clock time, "HH:MM"
   * - `wake`: fires off the wake-up press, not a clock
   * - `manual`: never nagged; a button that records it
   */
  at: { type: "time"; time: string } | { type: "wake" } | { type: "manual" };
  /** Free-time and chore items are a block, not a moment. */
  durationMinutes?: number;
  /** Which day a chore is meant for; 0 = Sunday. Absent means every day. */
  weekday?: number;
  /** A note shown under the label. */
  detail?: string;
  enabled: boolean;
};

const KEY = "sahara_schedule_v1";

/** Times here are Andre's actual day, not defaults to be admired and ignored. */
export const DEFAULT_SCHEDULE: Slot[] = [
  {
    id: "inhaler-morning",
    label: "Red inhaler",
    kind: "medication",
    at: { type: "wake" },
    detail: "Morning dose — taken when you get up",
    enabled: true,
  },
  {
    id: "breakfast",
    label: "Breakfast",
    kind: "food",
    at: { type: "time", time: "11:00" },
    detail: "Sausage sandwich",
    enabled: true,
  },
  {
    id: "noodles",
    label: "Noodles",
    kind: "food",
    at: { type: "time", time: "14:00" },
    detail: "Add oil or butter — it's the cheap calories",
    enabled: true,
  },
  {
    id: "dinner",
    label: "Dinner",
    kind: "food",
    at: { type: "time", time: "17:00" },
    enabled: true,
  },
  {
    id: "inhaler-evening",
    label: "Red inhaler",
    kind: "medication",
    at: { type: "time", time: "18:00" },
    detail: "Evening dose",
    enabled: true,
  },
  {
    id: "inhaler-needed",
    label: "Inhaler — as needed",
    kind: "asneeded",
    at: { type: "manual" },
    detail: "Press when you need it. Logged, never nagged.",
    enabled: true,
  },
  {
    id: "milk",
    label: "Milk or hot chocolate",
    kind: "drink",
    at: { type: "time", time: "23:00" },
    detail: "Made with whole milk — 350 calories you barely notice",
    enabled: true,
  },
  {
    id: "freetime",
    label: "Free time",
    kind: "free",
    at: { type: "time", time: "19:00" },
    durationMinutes: 120,
    detail: "PS5, or nothing at all",
    enabled: true,
  },
  {
    id: "clean-flat",
    label: "Clean the flat",
    kind: "chore",
    at: { type: "time", time: "13:00" },
    weekday: 0,
    durationMinutes: 120,
    detail: "One fixed slot beats 'sometime'",
    enabled: true,
  },
];

export function loadSchedule(): Slot[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SCHEDULE.map((s) => ({ ...s }));
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_SCHEDULE.map((s) => ({ ...s }));
    // A stored schedule that has lost its shape is worse than the default: it
    // would render an empty day and look like "nothing is scheduled".
    return parsed.filter((s: any) => s && typeof s.id === "string" && typeof s.label === "string");
  } catch {
    return DEFAULT_SCHEDULE.map((s) => ({ ...s }));
  }
}

export function saveSchedule(slots: Slot[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(slots));
  } catch {}
}

// ---------------------------------------------------------------- ticks

/**
 * Ticks, kept per day.
 *
 * Stored as `{ "2026-11-17": { breakfast: "11:04" } }` — the time is kept
 * because "did I actually eat at 11" is the question, not just "did I tick it".
 * Only the last fortnight is kept; the point is today and this week, not an
 * archive.
 */
const TICKS_KEY = "sahara_schedule_ticks_v1";
const KEEP_DAYS = 14;

export type Ticks = Record<string, Record<string, string>>;

export function dayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function loadTicks(): Ticks {
  try {
    const raw = localStorage.getItem(TICKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveTicks(ticks: Ticks) {
  const days = Object.keys(ticks).sort();
  if (days.length > KEEP_DAYS) {
    for (const d of days.slice(0, days.length - KEEP_DAYS)) delete ticks[d];
  }
  try {
    localStorage.setItem(TICKS_KEY, JSON.stringify(ticks));
  } catch {}
}

export function tick(ticks: Ticks, slotId: string, when: Date = new Date()): Ticks {
  const next: Ticks = { ...ticks, [dayKey(when)]: { ...(ticks[dayKey(when)] || {}) } };
  next[dayKey(when)][slotId] = when.toTimeString().slice(0, 5);
  return next;
}

export function untick(ticks: Ticks, slotId: string, when: Date = new Date()): Ticks {
  const day = dayKey(when);
  const next: Ticks = { ...ticks, [day]: { ...(ticks[day] || {}) } };
  delete next[day][slotId];
  return next;
}

export function isTicked(ticks: Ticks, slotId: string, when: Date = new Date()): boolean {
  return Boolean(ticks[dayKey(when)]?.[slotId]);
}

// ---------------------------------------------------------------- due-ness

const NAG_REPEAT_MINUTES = 45;
/** Nothing between midnight and this hour, whoever set what. */
export const QUIET_UNTIL_HOUR = 10;

function minutesOfDay(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Chores only appear on their weekday; everything else is every day. */
export function appliesToday(slot: Slot, d: Date = new Date()): boolean {
  if (!slot.enabled) return false;
  if (slot.weekday === undefined) return true;
  return slot.weekday === d.getDay();
}

export type NagState =
  | { state: "none" }
  | { state: "due"; sinceMinutes: number; repeat: boolean }
  | { state: "held"; reason: "asleep" | "quiet" };

/**
 * Whether a slot wants attention right now.
 *
 * `wakeAt` is when the app last saw a wake-up press today, as "HH:MM" or null.
 * `sleeping` suppresses everything, and nothing is queued — the caller must not
 * remember suppressed nags and replay them.
 */
export function nagState(
  slot: Slot,
  now: Date,
  ticks: Ticks,
  opts: { sleeping: boolean; wakeAt: string | null }
): NagState {
  if (!appliesToday(slot, now)) return { state: "none" };
  if (slot.at.type === "manual") return { state: "none" };
  if (isTicked(ticks, slot.id, now)) return { state: "none" };

  // Sleep wins over everything, and a suppressed nag is dropped rather than
  // queued — except medication, which is held for waking.
  if (opts.sleeping) {
    return slot.kind === "medication" ? { state: "held", reason: "asleep" } : { state: "none" };
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (slot.at.type === "wake") {
    if (!opts.wakeAt) return { state: "held", reason: "asleep" };
    const wakeMin = minutesOfDay(opts.wakeAt);
    if (wakeMin === null) return { state: "none" };
    // A minute after the wake press, so the app has settled.
    if (nowMin < wakeMin + 1) return { state: "none" };
    return { state: "due", sinceMinutes: nowMin - wakeMin, repeat: nowMin - wakeMin >= NAG_REPEAT_MINUTES };
  }

  const due = minutesOfDay(slot.at.time);
  if (due === null) return { state: "none" };
  if (nowMin < due) return { state: "none" };

  if (now.getHours() < QUIET_UNTIL_HOUR) return { state: "held", reason: "quiet" };

  const late = nowMin - due;
  return { state: "due", sinceMinutes: late, repeat: late >= NAG_REPEAT_MINUTES };
}

/** Slots in the order they appear today, sorted by when they're due. */
export function orderedToday(slots: Slot[], now: Date = new Date()): Slot[] {
  const order = (s: Slot) => {
    if (s.at.type === "wake") return -1;
    if (s.at.type === "manual") return 24 * 60 + 1;
    return minutesOfDay(s.at.time) ?? 24 * 60;
  };
  return slots.filter((s) => appliesToday(s, now)).sort((a, b) => order(a) - order(b));
}

/** How many of today's slots are still unticked — the number on the sidebar. */
export function outstanding(slots: Slot[], ticks: Ticks, now: Date = new Date()): number {
  return orderedToday(slots, now).filter((s) => s.at.type !== "manual" && !isTicked(ticks, s.id, now)).length;
}
