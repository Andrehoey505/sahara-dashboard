import React from "react";
import { motion } from "framer-motion";
import { Play, Pause, SkipForward, SkipBack, Maximize2, Music2 } from "lucide-react";
import { motionTokens } from "../lib/design";
import type { NowPlaying } from "../lib/spotify";

type Props = {
  now: NowPlaying | null;
  position: number;
  onTransport: (action: "play" | "pause" | "next" | "previous") => void;
  onExpand: () => void;
  busy: boolean;
};

function mmss(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The centrepiece: artwork, track, artist, scrubbable-looking progress and
 * transport. Clicking the artwork opens the full-screen player.
 */
export default function NowPlayingHero({ now, position, onTransport, onExpand, busy }: Props) {
  const pct = now?.duration_ms ? Math.min(100, (position / now.duration_ms) * 100) : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="relative rounded-2xl overflow-hidden accent-wash border border-slate-700/50"
    >
      {/* Blurred artwork wash behind everything */}
      {now?.image && (
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-20 blur-3xl scale-110"
          style={{ backgroundImage: `url(${now.image})`, backgroundSize: "cover", backgroundPosition: "center" }}
        />
      )}

      <div className="relative p-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <button
            onClick={onExpand}
            aria-label="Open full screen player"
            className="group relative shrink-0 rounded-xl overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition"
          >
            {now?.image ? (
              <img
                src={now.image}
                alt=""
                className="w-40 h-40 sm:w-48 sm:h-48 object-cover rounded-xl shadow-2xl transition-transform duration-300 group-hover:scale-[1.02]"
              />
            ) : (
              <div className="w-40 h-40 sm:w-48 sm:h-48 rounded-xl bg-slate-800 flex items-center justify-center">
                <Music2 className="w-12 h-12 text-slate-600" />
              </div>
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-slate-950/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
              <Maximize2 className="w-6 h-6" />
            </span>
          </button>

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-xs uppercase tracking-widest text-indigo-300/80 mb-2">
              {now?.is_playing ? "Now playing" : now ? "Paused" : "Nothing playing"}
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold truncate">{now?.track || "—"}</h2>
            <p className="text-slate-300 truncate mt-1">{now?.artists || "Pick something to play"}</p>
            {now?.album && <p className="text-sm text-slate-500 truncate mt-1">{now.album}</p>}

            <div className="mt-5">
              <div className="h-1.5 rounded-full bg-slate-700/70 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-400 to-violet-500"
                  style={{ width: `${pct}%`, transition: "width 250ms linear" }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500 mt-1.5 tabular-nums">
                <span>{mmss(position)}</span>
                <span>{now?.duration_ms ? mmss(now.duration_ms) : "0:00"}</span>
              </div>
            </div>

            <div className="flex items-center justify-center sm:justify-start gap-3 mt-5">
              <button
                onClick={() => onTransport("previous")}
                disabled={busy || !now}
                aria-label="Previous track"
                className="p-2.5 rounded-full bg-slate-800/60 text-slate-300 hover:bg-slate-700/70 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40 transition-colors"
               data-tip="Previous track">
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                onClick={() => onTransport(now?.is_playing ? "pause" : "play")}
                disabled={busy || !now}
                className="p-4 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-40 transition shadow-lg shadow-indigo-500/20"
              >
                {now?.is_playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
              </button>
              <button
                onClick={() => onTransport("next")}
                disabled={busy || !now}
                aria-label="Next track"
                className="p-2.5 rounded-full bg-slate-800/60 text-slate-300 hover:bg-slate-700/70 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40 transition-colors"
               data-tip="Next track">
                <SkipForward className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
