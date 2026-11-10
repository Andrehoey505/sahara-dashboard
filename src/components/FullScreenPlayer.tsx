import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, SkipForward, SkipBack, X, Mic2, Music2, Minimize2 } from "lucide-react";
import { motionTokens } from "../lib/design";
import type { NowPlaying } from "../lib/spotify";
import Lyrics from "./Lyrics";

type Props = {
  open: boolean;
  now: NowPlaying | null;
  position: number;
  onClose: () => void;
  onTransport: (action: "play" | "pause" | "next" | "previous") => void;
  busy: boolean;
};

function mmss(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Full screen player.
 *
 * Lyrics take the whole left side at a genuinely large size, with the artwork
 * and track details alongside. No scrolling required to read along.
 */
export default function FullScreenPlayer({ open, now, position, onClose, onTransport, busy }: Props) {
  const [showLyrics, setShowLyrics] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const pct = now?.duration_ms ? Math.min(100, (position / now.duration_ms) * 100) : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTokens.base}
          style={{ position: "fixed", top: 0, left: 0, width: "100dvw", height: "100dvh" }}
          className="z-50 bg-slate-950 overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Full screen player"
        >
          {now?.image && (
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-30 blur-3xl scale-125"
              style={{
                backgroundImage: `url(${now.image})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          )}
          <div className="absolute inset-0 bg-slate-950/70" />

          <div className="relative flex flex-col p-4 sm:p-6" style={{ height: "100%" }}>
            <header className="flex items-center justify-between shrink-0">
              <p className="text-xs uppercase tracking-[0.25em] text-indigo-300/70">
                {now?.is_playing ? "Now playing" : "Paused"}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowLyrics((v) => !v)}
                  className={
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 " +
                    (showLyrics
                      ? "bg-indigo-500/15 text-indigo-300"
                      : "bg-slate-800/60 text-slate-300 hover:bg-slate-700/60")
                  }
                >
                  <Mic2 className="w-4 h-4" /> Lyrics
                </button>
                <button
                  onClick={onClose}
                  aria-label="Close full screen player"
                  className="p-2 rounded-lg bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* Lyrics fill the left, artwork and details the right. */}
            <div className="flex-1 min-h-0 grid lg:grid-cols-[1.6fr_1fr] gap-6 lg:gap-10 mt-3 overflow-hidden">
              {showLyrics && (
                <div className="min-h-0 h-full order-2 lg:order-1 overflow-hidden">
                  <div className="h-full min-h-0 overflow-hidden">
                    <Lyrics
                      variant="fullscreen"
                      track={now?.track}
                      artist={now?.artists}
                      album={now?.album}
                      durationSec={now?.duration_ms ? Math.round(now.duration_ms / 1000) : undefined}
                      progressMs={position}
                      trackKey={`${now?.track || ""}|${now?.artists || ""}`}
                    />
                  </div>
                </div>
              )}

              <div
                className={
                  "min-h-0 flex flex-col items-center justify-center text-center order-1 lg:order-2 " +
                  (showLyrics ? "" : "lg:col-span-2")
                }
              >
                {now?.image ? (
                  <img
                    src={now.image}
                    alt=""
                    className="w-36 h-36 sm:w-48 sm:h-48 lg:w-64 lg:h-64 xl:w-72 xl:h-72 object-cover rounded-2xl shadow-2xl"
                  />
                ) : (
                  <div className="w-36 h-36 sm:w-48 sm:h-48 lg:w-64 lg:h-64 rounded-2xl bg-slate-800 flex items-center justify-center">
                    <Music2 className="w-16 h-16 text-slate-600" />
                  </div>
                )}

                <h1 className="text-xl sm:text-2xl font-bold mt-4 truncate max-w-full">
                  {now?.track || "Nothing playing"}
                </h1>
                <p className="text-base text-slate-300 truncate max-w-full mt-1">
                  {now?.artists || ""}
                </p>
                {now?.album && (
                  <p className="text-sm text-slate-500 truncate max-w-full mt-1">{now.album}</p>
                )}

                <div className="w-full max-w-sm mt-4">
                  <div className="h-1.5 rounded-full bg-slate-700/70 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-400 to-violet-500"
                      style={{ width: `${pct}%`, transition: "width 100ms linear" }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mt-1.5 tabular-nums">
                    <span>{mmss(position)}</span>
                    <span>{now?.duration_ms ? mmss(now.duration_ms) : "0:00"}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-4">
                  <button
                    onClick={() => onTransport("previous")}
                    disabled={busy || !now}
                    aria-label="Previous track"
                    className="p-3 rounded-full bg-slate-800/60 text-slate-300 hover:bg-slate-700/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40 transition-colors"
                  >
                    <SkipBack className="w-6 h-6" />
                  </button>
                  <button
                    onClick={() => onTransport(now?.is_playing ? "pause" : "play")}
                    disabled={busy || !now}
                    className="p-5 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-40 transition shadow-xl shadow-indigo-500/25"
                  >
                    {now?.is_playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7" />}
                  </button>
                  <button
                    onClick={() => onTransport("next")}
                    disabled={busy || !now}
                    aria-label="Next track"
                    className="p-3 rounded-full bg-slate-800/60 text-slate-300 hover:bg-slate-700/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40 transition-colors"
                  >
                    <SkipForward className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
