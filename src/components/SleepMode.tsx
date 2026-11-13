import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Moon, X, Sun, Check, Pill, Droplets, Sparkles, Brush } from "lucide-react";
import { motionTokens } from "../lib/design";
import { formatDateTime } from "../lib/time";
import type { AsleepMention } from "./CatchUpBanner";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called when sleep mode is engaged — lets the bot queue catch-up items. */
  onSleep?: () => void;

  /** True when the bot says he is asleep. Comes from the API, never from this app. */
  sleeping?: boolean;
  /** When this sleep began, straight from the API. */
  since?: string | null;
  /** Mentions caught during this sleep. */
  mentions?: AsleepMention[];
  onWake?: () => void;
  /** Opens the log of past nights, in the same popup style. */
  onOpenLog?: () => void;
  /** Opens the full list of everything said to him while asleep. */
  onOpenMentions?: () => void;
};

/**
 * Sleep mode.
 *
 * The Mac gets closed overnight, so this is both the last thing shown and the first
 * thing seen again. It is a view of what the BOT thinks — `sleeping`, `since` and the
 * mentions all come from the API, so shutting the Mac, rebooting or losing the network
 * changes nothing: open the app tomorrow and it picks the same sleep back up.
 *
 * Nothing here is remembered locally on purpose. An app that remembered its own sleep
 * state would disagree with the bot the moment one of them was restarted alone, and
 * then you have two answers to "am I asleep" and no way to tell which is right.
 */

// Four items, no more. A bedtime checklist you cannot finish is a bedtime checklist you
// stop opening, and the point is that he does them, not that the list is complete.
const SELF_CARE = [
  { id: "teeth", label: "Brush your teeth", Icon: Brush },
  { id: "symbicort", label: "Symbicort — 2 puffs", Icon: Pill },
  { id: "electrolytes", label: "Electrolytes", Icon: Droplets },
  { id: "sit", label: "Sit on the edge of the bed for 30s before standing", Icon: Sparkles },
];

export default function SleepMode({
  open,
  onClose,
  onSleep,
  sleeping = false,
  since,
  mentions = [],
  onWake,
  onOpenLog,
  onOpenMentions,
}: Props) {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  if (!open) return null;

  const engage = () => {
    onSleep?.();
    onClose();
  };

  const toggle = (id: string) => setTicked((t) => ({ ...t, [id]: !t[id] }));
  const doneCount = SELF_CARE.filter((i) => ticked[i.id]).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sleep-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={motionTokens.enter}
        onClick={(e) => e.stopPropagation()}
        className="glass rounded-2xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        <div className="relative">
          <button
            onClick={onClose}
            aria-label="Close sleep mode"
            className="absolute top-3 right-3 p-2 rounded-lg bg-slate-950/60 text-slate-300 hover:text-white hover:bg-slate-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
            data-tip="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          <div className="flex items-center gap-2 mb-2">
            <Moon className="w-4 h-4 text-indigo-300" />
            <h3 id="sleep-title" className="font-semibold text-lg">
              {sleeping ? "Asleep" : "Before you sleep"}
            </h3>
          </div>

          {sleeping ? (
            <>
              <p className="text-sm text-slate-300 leading-relaxed max-w-[65ch]">
                Asleep since {since ? formatDateTime(since) : "just now"}. Anything that
                mentions you is being kept for the morning rather than waking you.
              </p>

              <div className="mt-4 rounded-xl bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400 mb-2">
                  {mentions.length === 0
                    ? "Nobody's asked for you yet."
                    : `${mentions.length} ${mentions.length === 1 ? "person has" : "people have"} asked for you.`}
                </p>
                <ul className="space-y-2">
                  {mentions.slice(0, 6).map((m, i) => (
                    <li key={i} className="text-[13px] text-slate-200">
                      <span className="text-slate-300 font-medium">{m.author_name}</span>
                      {m.channel_name && <span className="text-slate-500"> · #{m.channel_name}</span>}
                      <p className="text-slate-300 break-words">{m.text || "(no text)"}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={() => { onClose(); onOpenMentions?.(); }}
                  className="text-xs text-indigo-300 hover:text-indigo-200 underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 rounded transition-colors"
                  data-tip="Everything anyone said to you while you slept">
                  All mentions
                </button>
                <button
                  onClick={() => { onClose(); onOpenLog?.(); }}
                  className="text-xs text-slate-400 hover:text-slate-200 underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 rounded transition-colors"
                  data-tip="Every night you've slept, and who asked for you">
                  Past nights
                </button>
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => {
                    onWake?.();
                    onClose();
                  }}
                  className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-semibold hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition"
                  data-tip="Wake up — read out anything you missed">
                  <Sun className="w-4 h-4 inline -mt-0.5 mr-1.5" />
                  I'm awake
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-300 leading-relaxed max-w-[65ch]">
                Sleeping will also tell Babblebot you&apos;re away, so anything missed
                while you&apos;re asleep is waiting for you when you wake.
              </p>

              <ul className="mt-4 space-y-1.5">
                {SELF_CARE.map(({ id, label, Icon }) => (
                  <li key={id}>
                    <button
                      onClick={() => toggle(id)}
                      className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
                      data-tip={`Tick off: ${label}`}>
                      <span
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                          ticked[id]
                            ? "bg-indigo-500 border-indigo-400"
                            : "border-slate-600 bg-slate-900/40"
                        }`}>
                        {ticked[id] && <Check className="w-3.5 h-3.5 text-white" />}
                      </span>
                      <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                      <span
                        className={`text-sm ${ticked[id] ? "text-slate-500 line-through" : "text-slate-200"}`}>
                        {label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <AnimatePresence>
                {doneCount === SELF_CARE.length && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-xs text-emerald-300 mt-2">
                    All four done. Night 🫂
                  </motion.p>
                )}
              </AnimatePresence>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={engage}
                  className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 font-semibold hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition"
                  data-tip="Put the dashboard to sleep">
                  Go to sleep
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-lg bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
                  data-tip="Stay awake">
                  Not yet
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
