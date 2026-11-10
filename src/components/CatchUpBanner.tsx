import React from "react";
import { motion } from "framer-motion";
import { Moon, X } from "lucide-react";
import { motionTokens } from "../lib/design";

type Props = {
  flags: number;
  since?: string | null;
  onDismiss: () => void;
};

/** Shown after wake: what happened while the Mac was closed. */
export default function CatchUpBanner({ flags, since, onDismiss }: Props) {
  if (flags <= 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={motionTokens.enter}
      className="rounded-xl p-4 bg-indigo-500/10 border border-indigo-500/30 flex items-start gap-3"
      role="status"
    >
      <Moon className="w-5 h-5 text-indigo-300 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200">
          {flags} {flags === 1 ? "flag" : "flags"} came in while you were asleep.
        </p>
        {since && (
          <p className="text-xs text-slate-400 mt-1">
            Since {new Date(since).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
          </p>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss catch-up notice"
        className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}
