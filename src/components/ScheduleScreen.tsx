import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Clock,
  Sunrise,
  Utensils,
  Coffee,
  Pill,
  Droplets,
  Gamepad2,
  Brush,
  AlertTriangle,
  RotateCcw,
  Volume2,
  Moon,
  Plus,
  Trash2,
  ChevronDown,
  X,
} from "lucide-react";
import { playCue } from "../lib/audio";
import {
  type Slot,
  type SlotKind,
  type Ticks,
  loadSchedule,
  saveSchedule,
  loadTicks,
  saveTicks,
  tick,
  untick,
  isTicked,
  orderedToday,
  nagState,
  outstanding,
  dayKey,
  mirrorPayload,
  loadMirrorTarget,
  clearDayTicks,
} from "../lib/schedule";

/**
 * The day, as a list you can tick.
 *
 * This is the screen that exists because a plan you remember is a plan you
 * abandon by Wednesday. It shows today, what's outstanding, and what's done —
 * and it nags, with sound, at the times set in here.
 *
 * Three decisions worth stating, because they're the ones that make it work:
 *
 * 1. **The app owns the ticks, not the bot.** Ticking something is the record.
 *    The bot is told so staff can see it, but a staff member ticking in Discord
 *    must never be able to silence Andre's own reminder for something he hasn't
 *    actually done.
 * 2. **Sleep mode means quiet, and nothing is queued.** A nag suppressed by
 *    sleep is dropped, not replayed on waking — four nags at once at 11am is
 *    worse than none. The exception is medication, which is held rather than
 *    dropped, because a dose is not a nudge.
 * 3. **The morning inhaler has no fixed time.** It fires off the wake-up press,
 *    so a 10am wake and a 2pm wake behave identically.
 */

type Props = {
  notify: (message: string, kind?: "success" | "error" | "info") => void;
  /** True while the bot (and therefore the app) considers him asleep. */
  sleeping: boolean;
  /** When the wake-up press happened today, "HH:MM", or null. */
  wakeAt: string | null;
  soundEnabled: boolean;
  /** Where the day is mirrored. Absent means the schedule stays on this Mac. */
  apiUrl?: string;
  servers?: any[];
  selectedServer?: string;
  /** Rendered inside the settings expander, so this file owns no channel pickers. */
  renderSettings?: (props: {
    apiUrl: string;
    notify: (message: string, kind?: "success" | "error" | "info") => void;
    servers: any[];
    selectedServer: string;
  }) => React.ReactNode;
};

const KIND_ICON: Record<SlotKind, typeof Clock> = {
  food: Utensils,
  drink: Coffee,
  medication: Pill,
  selfcare: Droplets,
  free: Gamepad2,
  chore: Brush,
  asneeded: AlertTriangle,
};

const KIND_LABEL: Record<SlotKind, string> = {
  food: "Food",
  drink: "Drink",
  medication: "Medication",
  selfcare: "Self-care",
  free: "Free time",
  chore: "Chore",
  asneeded: "As needed",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dueLabel(slot: Slot): string {
  if (slot.at.type === "wake") return "On waking";
  if (slot.at.type === "manual") return "When needed";
  return slot.at.time;
}

/** Items that are tickable in the main list (not manual/asneeded). */
function isMainListItem(slot: Slot): boolean {
  return slot.at.type !== "manual";
}

/** Items that belong in the "As needed" section. */
function isAsNeededItem(slot: Slot): boolean {
  return slot.at.type === "manual" && slot.enabled;
}

export default function ScheduleScreen({
  notify,
  sleeping,
  wakeAt,
  soundEnabled,
  apiUrl,
  servers = [],
  selectedServer = "",
  renderSettings,
}: Props) {
  const [slots, setSlots] = useState<Slot[]>(() => loadSchedule());
  const [ticks, setTicks] = useState<Ticks>(() => loadTicks());
  const [now, setNow] = useState<Date>(() => new Date());
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Which slots have already had their first nag today, and which have had their
  // repeat. Keyed by day so a nag doesn't carry over from yesterday.
  const naggedRef = useRef<{ day: string; first: Set<string>; repeat: Set<string> }>({
    day: dayKey(),
    first: new Set(),
    repeat: new Set(),
  });

  // A clock that ticks every 20 seconds: fine enough that a nag is never more
  // than a few seconds late, cheap enough to leave running all day.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(id);
  }, []);

  const mainList = useMemo(() => orderedToday(slots, now).filter(isMainListItem), [slots, now]);
  const asNeededList = useMemo(() => slots.filter(isAsNeededItem), [slots]);

  const fire = useCallback(
    (slot: Slot) => {
      playCue(slot.kind === "medication" ? "error" : "violation", soundEnabled);
      notify(
        slot.kind === "medication" ? `${slot.label} — due now` : `${slot.label} — ${dueLabel(slot)}`,
        "info"
      );
    },
    [notify, soundEnabled]
  );

  // The nag loop. One pass every 20 seconds; each slot gets at most a first nag
  // and one repeat, and nothing at all while asleep.
  useEffect(() => {
    const day = dayKey(now);
    if (naggedRef.current.day !== day) {
      naggedRef.current = { day, first: new Set(), repeat: new Set() };
    }

    for (const slot of slots) {
      const state = nagState(slot, now, ticks, { sleeping, wakeAt });
      if (state.state !== "due") continue;

      const { first, repeat } = naggedRef.current;
      if (state.repeat && !repeat.has(slot.id)) {
        repeat.add(slot.id);
        first.add(slot.id);
        fire(slot);
      } else if (!state.repeat && !first.has(slot.id)) {
        first.add(slot.id);
        fire(slot);
      }
    }
  }, [now, slots, ticks, sleeping, wakeAt, fire]);

  // Mirror the day to the bot, so a channel can show how it's going.
  //
  // Debounced rather than fired on every tick: ticking three things in a row is
  // one change to anyone reading, not three edits. A failure here is silent by
  // design — the schedule on this Mac is already correct, and a toast every time
  // the bot is mid-restart would be noise about nothing.
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!apiUrl || !selectedServer) return;
    const target = loadMirrorTarget(selectedServer);
    const serverName = servers.find((x) => x.id === selectedServer)?.name || "";
    if (!serverName) return;

    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      const body = mirrorPayload(slots, ticks, serverName, target.channelId, target.nag, now);
      fetch(apiUrl.replace(/\/$/, "") + "/api/schedule/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    }, 1200);

    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [apiUrl, selectedServer, servers, slots, ticks]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (slot: Slot) => {
    const done = isTicked(ticks, slot.id, now);
    const next = done ? untick(ticks, slot.id, now) : tick(ticks, slot.id, now);
    setTicks(next);
    saveTicks(next);
    if (!done) {
      playCue("success", soundEnabled);
      naggedRef.current.first.add(slot.id);
      naggedRef.current.repeat.add(slot.id);
    } else {
      // Unticking also clears the nag state so it can fire again if needed
      naggedRef.current.first.delete(slot.id);
      naggedRef.current.repeat.delete(slot.id);
    }
  };

  const logAsNeeded = (slot: Slot) => {
    const done = isTicked(ticks, slot.id, now);
    const next = done ? untick(ticks, slot.id, now) : tick(ticks, slot.id, now);
    setTicks(next);
    saveTicks(next);
    playCue("success", soundEnabled);
    notify(done ? `${slot.label} unlogged` : `${slot.label} logged`, done ? "info" : "success");
  };

  const clearToday = () => {
    const cleared = clearDayTicks(ticks, now);
    setTicks(cleared);
    saveTicks(cleared);
    notify("Cleared all ticks for today", "info");
  };

  const updateSlot = (id: string, patch: Partial<Slot>) => {
    const next = slots.map((s) => (s.id === id ? { ...s, ...patch } : s));
    setSlots(next);
    saveSchedule(next);
  };

  const removeSlot = (id: string) => {
    const next = slots.filter((s) => s.id !== id);
    setSlots(next);
    saveSchedule(next);
  };

  const addSlot = () => {
    const id = "custom-" + Date.now().toString(36);
    const next: Slot[] = [
      ...slots,
      { id, label: "New item", kind: "food", at: { type: "time", time: "12:00" }, enabled: true },
    ];
    setSlots(next);
    saveSchedule(next);
    setEditing(true);
  };

  const reset = () => {
    localStorage.removeItem("sahara_schedule_v1");
    localStorage.removeItem("sahara_schedule_ticks_v1");
    setSlots(loadSchedule());
    setTicks(loadTicks());
    setConfirmReset(false);
    notify("Schedule and ticks reset to default", "info");
  };

  const done = mainList.filter((s) => isTicked(ticks, s.id, now)).length;
  const total = mainList.length;
  const left = outstanding(slots, ticks, now);

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" /> Today
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            {total === 0
              ? "Nothing scheduled today."
              : left === 0
              ? "Everything's ticked. That's the day done."
              : `${done} of ${total} done — ${left} to go.`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700/70 transition flex items-center gap-1.5"
            data-tip="Change the times, add or remove items"
          >
            {editing ? "Done editing" : "Edit"}
          </button>
          {total > 0 && (
            <button
              onClick={clearToday}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-200 hover:bg-rose-500/30 transition flex items-center gap-1.5"
              data-tip="Clear all ticks for today — use if something was ticked by accident"
            >
              <X className="w-3.5 h-3.5" /> Clear today
            </button>
          )}
          {renderSettings && apiUrl && (
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700/70 transition"
              data-tip="Where the day is posted, and whether the bot nudges there"
            >
              {showSettings ? "Hide settings" : "Settings"}
            </button>
          )}
        </div>
      </div>

      {sleeping && (
        <div className="mt-3 mb-4 flex items-center gap-2 text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 px-3 py-2">
          <Moon className="w-3.5 h-3.5" />
          Sleep mode is on — no nags fire, and nothing is queued for when you wake.
        </div>
      )}

      <div className="mt-4 space-y-2">
        {mainList.map((slot) => {
          const Icon = KIND_ICON[slot.kind] || Clock;
          const checked = isTicked(ticks, slot.id, now);
          const state = nagState(slot, now, ticks, { sleeping, wakeAt });

          return (
            <motion.div
              key={slot.id}
              layout
              className={
                "rounded-xl border px-3 py-2.5 flex items-center gap-3 transition " +
                (checked
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : state.state === "due"
                  ? "border-amber-500/40 bg-amber-500/5"
                  : "border-slate-700/60 bg-slate-800/40")
              }
            >
              <button
                onClick={() => toggle(slot)}
                className={
                  "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border transition " +
                  (checked
                    ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                    : "border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-200")
                }
                data-tip={checked ? "Mark as not done" : "Mark as done"}
                aria-label={checked ? `Untick ${slot.label}` : `Tick ${slot.label}`}
              >
                <Check className="w-4 h-4" />
              </button>

              <Icon className="w-4 h-4 text-slate-400 shrink-0" />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={"text-sm font-medium " + (checked ? "text-slate-400 line-through" : "text-slate-100")}>
                    {slot.label}
                  </span>
                  {slot.kind === "medication" && !checked && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300">
                      held if you're asleep
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {dueLabel(slot)}
                  {slot.weekday !== undefined ? ` · ${WEEKDAYS[slot.weekday]}` : ""}
                  {slot.durationMinutes ? ` · ${slot.durationMinutes} min` : ""}
                  {slot.detail ? ` · ${slot.detail}` : ""}
                </div>
              </div>

              {checked && (
                <span className="text-xs text-emerald-300/80 shrink-0">{ticks[dayKey(now)]?.[slot.id]}</span>
              )}
            </motion.div>
          );
        })}
      </div>

      {asNeededList.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">As needed</h3>
          <div className="flex flex-wrap gap-2">
            {asNeededList.map((slot) => {
              const checked = isTicked(ticks, slot.id, now);
              return (
                <button
                  key={slot.id}
                  onClick={() => logAsNeeded(slot)}
                  className={
                    "text-xs px-3 py-2 rounded-lg border transition flex items-center gap-1.5 " +
                    (checked
                      ? "bg-rose-500/20 border-rose-500/40 text-rose-200"
                      : "bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-800")
                  }
                  data-tip={checked ? "Unlog this" : "Log this now. Never nags you for it."}
                >
                  <Pill className="w-3.5 h-3.5" /> {slot.label}
                  {checked && (
                    <span className="text-rose-300/70">· {ticks[dayKey(now)]?.[slot.id]}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <AnimatePresence>
        {showSettings && renderSettings && apiUrl && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-6 overflow-hidden"
          >
            <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
              {renderSettings({ apiUrl, notify, servers, selectedServer })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-8 overflow-hidden"
          >
            <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">The schedule</h3>
                <div className="flex gap-2">
                  <button
                    onClick={addSlot}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/30 transition flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                  {confirmReset ? (
                    <button
                      onClick={reset}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-200 hover:bg-rose-500/30 transition"
                    >
                      Really reset?
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmReset(true)}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700/70 transition flex items-center gap-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reset
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {slots.map((slot) => (
                  <div
                    key={slot.id}
                    className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center rounded-lg border border-slate-700/50 bg-slate-800/40 px-2.5 py-2"
                  >
                    <input
                      value={slot.label}
                      onChange={(e) => updateSlot(slot.id, { label: e.target.value })}
                      className="bg-transparent text-sm outline-none border-b border-transparent focus:border-slate-600 min-w-0"
                      aria-label="Item name"
                    />
                    <select
                      value={slot.kind}
                      onChange={(e) => updateSlot(slot.id, { kind: e.target.value as SlotKind })}
                      className="bg-slate-800 text-xs rounded px-1.5 py-1 border border-slate-700"
                      aria-label="Kind"
                    >
                      {(Object.keys(KIND_LABEL) as SlotKind[]).map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                    {slot.at.type === "time" ? (
                      <input
                        type="time"
                        value={slot.at.time}
                        onChange={(e) => updateSlot(slot.id, { at: { type: "time", time: e.target.value } })}
                        className="bg-slate-800 text-xs rounded px-1.5 py-1 border border-slate-700"
                        aria-label="Time"
                      />
                    ) : (
                      <span className="text-xs text-slate-500 px-1.5">
                        {slot.at.type === "wake" ? "on waking" : "as needed"}
                      </span>
                    )}
                    <button
                      onClick={() => removeSlot(slot.id)}
                      className="text-slate-500 hover:text-rose-300 transition p-1"
                      data-tip="Remove this item"
                      aria-label={`Remove ${slot.label}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <p className="text-xs text-slate-500 mt-3">
                Nags fire once at the time, and once more 45 minutes later if it's still not ticked. Nothing
                fires in sleep mode.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
