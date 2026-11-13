import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Moon, X, MessageCircle, Clock } from "lucide-react";
import { motionTokens } from "../lib/design";
import { formatDateTime } from "../lib/time";

type Night = {
  asleep_at: string;
  woke_at: string;
  mention_count: number;
  flag_count: number;
  mentions?: { author_name?: string; channel_name?: string; text?: string; jump_url?: string }[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  apiUrl: string;
};

/** How long a night lasted, said the way a person would say it. */
function duration(asleep?: string, woke?: string) {
  if (!asleep || !woke) return "";
  const ms = new Date(woke).getTime() - new Date(asleep).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * The sleep log.
 *
 * Same shape as the sleep card it opens from — a centred popup over a dim backdrop —
 * because it is the same subject and should not feel like a different app. One entry
 * per night: how long he slept, and who was waiting when he woke.
 *
 * Read from the API, never cached: the log is the bot's record, and a copy kept here
 * would be one more thing to go stale.
 */
export default function SleepLog({ open, onClose, apiUrl }: Props) {
  const [nights, setNights] = useState<Night[] | null>(null);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setNights(null);
    setError("");
    fetch(apiUrl.replace(/\/$/, "") + "/api/sleep-log")
      .then((r) => r.json())
      .then((d) => {
        setNights(Array.isArray(d?.nights) ? d.nights : []);
        setHint(d?.hint || "");
      })
      .catch(() => setError("Couldn't reach Babblebot for the log."));
  }, [open, apiUrl]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sleep-log-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={motionTokens.enter}
        onClick={(e) => e.stopPropagation()}
        className="glass rounded-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="relative p-6 pb-3 shrink-0">
          <button
            onClick={onClose}
            aria-label="Close the sleep log"
            className="absolute top-3 right-3 p-2 rounded-lg bg-slate-950/60 text-slate-300 hover:text-white hover:bg-slate-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
            data-tip="Close">
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <Moon className="w-4 h-4 text-indigo-300" />
            <h3 id="sleep-log-title" className="font-semibold text-lg">
              Sleep log
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            One line per night. Nothing here is scored — it is a record, not a score.
          </p>
        </div>

        <div className="px-6 pb-6 overflow-y-auto">
          {error && <p className="text-sm text-rose-300">{error}</p>}

          {!error && nights === null && (
            <p className="text-sm text-slate-400">Loading…</p>
          )}

          {!error && nights !== null && nights.length === 0 && (
            <p className="text-sm text-slate-400">{hint || "No nights logged yet."}</p>
          )}

          <ul className="space-y-2">
            {(nights || []).map((n, i) => (
              <li
                key={i}
                className="rounded-xl bg-slate-950/40 px-3 py-2.5 border border-slate-800/60">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-200">
                    {formatDateTime(n.asleep_at)} → {formatDateTime(n.woke_at)}
                  </span>
                  <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0">
                    <Clock className="w-3 h-3" />
                    {duration(n.asleep_at, n.woke_at)}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <MessageCircle className="w-3 h-3" />
                    {n.mention_count || 0} mentioned you
                  </span>
                  {(n.flag_count || 0) > 0 && <span>{n.flag_count} flags</span>}
                </div>
                {!!(n.mentions && n.mentions.length) && (
                  <ul className="mt-2 space-y-1">
                    {n.mentions.slice(0, 5).map((m, j) => (
                      <li key={j} className="text-[12px] text-slate-300 break-words">
                        <span className="text-slate-400">{m.author_name}</span>
                        {m.channel_name && <span className="text-slate-600"> · #{m.channel_name}</span>}
                        {m.text && <span> — {m.text}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      </motion.div>
    </div>
  );
}
