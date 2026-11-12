import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Hand, CheckCircle2, AlertCircle } from "lucide-react";
import { motionTokens } from "../lib/design";
import { formatShort } from "../lib/time";

/**
 * Arm care.
 *
 * Replaces the old sling reminders, which only made sense while a sling was
 * actually being worn. The forearm injury (a sore spot on the radial bone from
 * a knock) is past the sling stage, so what is useful now is load management:
 * a timer that prompts a break, a quick daily check, and a log of how the arm
 * felt so a trend is visible rather than guessed at.
 *
 * Everything here is local to the machine — no API, nothing leaves the app.
 */

type Check = {
  at: string;
  soreness: number;
  tiredness: number;
  note: string;
};

const STORAGE = "sahara_arm_care_log";
const REMIND_KEY = "sahara_arm_reminder_mins";

const load = (): Check[] => {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
};

const save = (rows: Check[]) => {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(rows.slice(-200)));
  } catch {}
};

const levelColour = (n: number) => {
  if (n <= 2) return "text-emerald-300";
  if (n <= 5) return "text-amber-300";
  if (n <= 7) return "text-orange-300";
  return "text-rose-300";
};

const levelBg = (n: number) => {
  if (n <= 2) return "bg-emerald-500/15 border-emerald-500/40 text-emerald-200";
  if (n <= 5) return "bg-amber-500/15 border-amber-500/40 text-amber-200";
  if (n <= 7) return "bg-orange-500/15 border-orange-500/40 text-orange-200";
  return "bg-rose-500/15 border-rose-500/40 text-rose-200";
};

const fmt = (iso: string) => formatShort(iso);

export default function ArmCareScreen() {
  const [log, setLog] = useState<Check[]>(() => load());
  const [soreness, setSoreness] = useState(2);
  const [tiredness, setTiredness] = useState(3);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [reminderMins, setReminderMins] = useState<number>(() => {
    const raw = localStorage.getItem(REMIND_KEY);
    return raw ? Number(raw) : 45;
  });

  useEffect(() => {
    save(log);
  }, [log]);

  useEffect(() => {
    try {
      localStorage.setItem(REMIND_KEY, String(reminderMins));
    } catch {}
  }, [reminderMins]);

  const add = () => {
    setLog((rows) => [
      ...rows,
      { at: new Date().toISOString(), soreness, tiredness, note: note.trim() },
    ]);
    setNote("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const trend = useMemo(() => {
    if (log.length < 2) return null;
    const recent = log.slice(-5);
    const older = log.slice(-10, -5);
    if (older.length === 0) return null;
    const avg = (rows: Check[], k: "soreness" | "tiredness") =>
      rows.reduce((a, r) => a + r[k], 0) / rows.length;
    return {
      soreness: avg(recent, "soreness") - avg(older, "soreness"),
      tiredness: avg(recent, "tiredness") - avg(older, "tiredness"),
    };
  }, [log]);

  const card = "glass rounded-2xl p-5";

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="space-y-4"
    >
      <div>
        <h2 className="text-xl font-semibold">Arm care</h2>
        <p className="text-sm text-slate-400 mt-1">
          Load management for the forearm — no sling unless it flares.
        </p>
      </div>

      {/* Guidance card */}
      <div className={card + " border border-indigo-500/20"}>
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/15 shrink-0">
            <Hand className="w-5 h-5 text-indigo-300" />
          </div>
          <div className="text-sm space-y-2">
            <p className="font-medium text-slate-200">Where you are</p>
            <p className="text-slate-400">
              Bruising has yellowed and the sore spot has settled — that's healing, not
              damage. Full normal use is fine. Build back gradually rather than going
              straight to full press-ups.
            </p>
            <div className="flex items-start gap-2 pt-1">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-200/80">
                Sling only if it gets sore or tired. Sharp pain, numbness, or a spot that
                gets worse rather than better is worth a GP look.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Reminder interval */}
      <div className={card}>
        <div className="flex items-center gap-3">
          <Activity className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">Break reminder</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Prompts you to rest the arm after this much continuous use.
            </p>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          {[30, 45, 60, 90].map((m) => (
            <button
              key={m}
              onClick={() => setReminderMins(m)}
              className={
                "flex-1 py-2 rounded-lg text-xs border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 " +
                (reminderMins === m
                  ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200"
                  : "bg-slate-800/40 border-slate-700 text-slate-400 hover:bg-slate-700/50")
              }
             data-tip="Set how often to be reminded">
              {m} min
            </button>
          ))}
        </div>
      </div>

      {/* Quick check */}
      <div className={card + " space-y-4"}>
        <p className="text-sm font-medium">Today's check</p>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-500">Soreness</span>
            <span className={"text-sm font-semibold " + levelColour(soreness)}>{soreness}/10</span>
          </div>
          <input
            type="range"
            min={0}
            max={10}
            value={soreness}
            onChange={(e) => setSoreness(Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-500">Tires quickly</span>
            <span className={"text-sm font-semibold " + levelColour(tiredness)}>{tiredness}/10</span>
          </div>
          <input
            type="range"
            min={0}
            max={10}
            value={tiredness}
            onChange={(e) => setTiredness(Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What you did with it today (optional)"
          className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
        />

        <button
          onClick={add}
          className="w-full py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 font-semibold hover:opacity-90 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
        >
          {saved ? (
            <>
              <CheckCircle2 className="w-4 h-4" /> Saved
            </>
          ) : (
            "Save check"
          )}
        </button>
      </div>

      {/* Trend */}
      {trend && (
        <div className={card}>
          <p className="text-sm font-medium mb-2">Trend</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-500">Soreness</p>
              <p className={trend.soreness <= 0 ? "text-emerald-300" : "text-amber-300"}>
                {trend.soreness <= 0 ? "↓ improving" : "↑ worse"} ({trend.soreness > 0 ? "+" : ""}
                {trend.soreness.toFixed(1)})
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Tiring</p>
              <p className={trend.tiredness <= 0 ? "text-emerald-300" : "text-amber-300"}>
                {trend.tiredness <= 0 ? "↓ improving" : "↑ worse"} ({trend.tiredness > 0 ? "+" : ""}
                {trend.tiredness.toFixed(1)})
              </p>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {log.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 px-1">History</p>
          {[...log].reverse().map((c, i) => (
            <div key={c.at + i} className="glass rounded-xl p-3 flex items-center gap-3">
              <span className="text-xs text-slate-500 tabular-nums shrink-0">{fmt(c.at)}</span>
              <span className={"px-2 py-0.5 rounded-full text-xs border " + levelBg(c.soreness)}>
                sore {c.soreness}
              </span>
              <span className={"px-2 py-0.5 rounded-full text-xs border " + levelBg(c.tiredness)}>
                tired {c.tiredness}
              </span>
              {c.note && <span className="text-xs text-slate-400 truncate">{c.note}</span>}
            </div>
          ))}
        </div>
      )}
    </motion.section>
  );
}
