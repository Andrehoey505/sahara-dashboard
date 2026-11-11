import React from "react";
import { motion } from "framer-motion";
import { Moon, X } from "lucide-react";
import { motionTokens } from "../lib/design";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called when sleep mode is engaged — lets the bot queue catch-up items. */
  onSleep?: () => void;
};

/**
 * Sleep mode.
 *
 * The Mac gets closed overnight, so this is the last thing shown. Its job is
 * telling the bot that Andre is going to sleep so anything missed can be
 * surfaced on wake.
 */
export default function SleepMode({ open, onClose, onSleep }: Props) {
  if (!open) return null;

  const engage = () => {
    onSleep?.();
    onClose();
  };

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
        className="glass rounded-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="relative">
          <button
            onClick={onClose}
            aria-label="Close sleep mode"
            className="absolute top-3 right-3 p-2 rounded-lg bg-slate-950/60 text-slate-300 hover:text-white hover:bg-slate-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          <div className="flex items-center gap-2 mb-2">
            <Moon className="w-4 h-4 text-indigo-300" />
            <h3 id="sleep-title" className="font-semibold text-lg">
              Before you sleep
            </h3>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed max-w-[65ch]">
            Sleeping will also tell Babblebot you&apos;re away, so anything missed overnight is
            waiting for you in the morning.
          </p>

          <div className="flex gap-3 mt-6">
            <button
              onClick={engage}
              className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 font-semibold hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition"
            >
              Go to sleep
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
            >
              Not yet
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
