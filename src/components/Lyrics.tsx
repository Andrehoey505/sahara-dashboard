import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Mic2 } from "lucide-react";
import { getLyrics, type Lyrics as LyricsData } from "../lib/spotify";

type Props = {
  track?: string;
  artist?: string;
  album?: string;
  /** Track length in seconds — improves the exact LRCLIB match. */
  durationSec?: number;
  /** Playback position in ms, updated by the parent's ticker. */
  progressMs?: number;
  /** Changing track keys the component so state resets cleanly. */
  trackKey: string;
  /**
   * "card" is the compact inline version, "large" a medium panel, and
   * "fullscreen" the big scrolling lyrics in the full screen player.
   */
  variant?: "card" | "large" | "fullscreen";
};

/**
 * Lyrics from LRCLIB, highlighted line-by-line when the track has synced
 * timing. Falls back to plain text when it doesn't.
 *
 * The active line glows and, in the full screen view, the word being sung is
 * emphasised by interpolating between the current line's start and the next
 * line's start — LRCLIB gives line timings, not per-word ones.
 */
export default function Lyrics({
  track,
  artist,
  album,
  durationSec,
  progressMs,
  trackKey,
  variant = "card",
}: Props) {
  const [data, setData] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setNotFound(false);
    if (!track || !artist) return;

    setLoading(true);
    getLyrics(track, artist, album, durationSec)
      .then((res) => {
        if (cancelled) return;
        if (res.source === "none") setNotFound(true);
        else setData(res);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  const fullscreen = variant === "fullscreen";
  const large = variant === "large" || fullscreen;

  const seconds = progressMs != null ? progressMs / 1000 : 0;
  const lines = data?.synced ?? [];

  const activeIndex = lines.length
    ? lines.reduce((best, line, i) => (line.time <= seconds + 0.25 ? i : best), -1)
    : -1;

  // Progress through the active line, used to pick which word to emphasise.
  let wordProgress = 0;
  if (activeIndex >= 0 && activeIndex < lines.length) {
    const start = lines[activeIndex].time;
    const end = activeIndex + 1 < lines.length ? lines[activeIndex + 1].time : start + 4;
    const span = Math.max(0.4, end - start);
    wordProgress = Math.min(1, Math.max(0, (seconds - start) / span));
  }

  // Keep the active line centred. Re-centres on resize as well, so opening the
  // full screen view doesn't leave the line off-screen.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToActive = () => {
    const container = scrollRef.current;
    const el = activeRef.current;
    if (!container || !el) return;
    const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  };

  useEffect(() => {
    scrollToActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => scrollToActive());
    ro.observe(container);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, variant]);

  if (!track) return null;

  const lineClass = (i: number) => {
    const isActive = i === activeIndex;
    if (fullscreen) {
      return isActive
        ? "text-2xl sm:text-3xl xl:text-4xl font-bold text-white"
        : "text-2xl sm:text-3xl xl:text-4xl font-bold text-slate-500/50";
    }
    if (large) {
      return isActive
        ? "text-2xl sm:text-3xl font-semibold text-indigo-200"
        : "text-2xl sm:text-3xl font-semibold text-slate-600";
    }
    return isActive ? "text-sm text-indigo-200 font-medium" : "text-sm text-slate-500";
  };

  /** Render a line, emphasising the word currently being sung. */
  const renderLine = (text: string, isActive: boolean) => {
    if (!fullscreen || !isActive) return text;
    const words = text.split(/(\s+)/);
    const spoken = words.filter((w) => w.trim().length > 0);
    if (spoken.length === 0) return text;
    const cutoff = Math.floor(wordProgress * spoken.length);

    let seen = -1;
    return words.map((w, idx) => {
      if (!w.trim()) return <span key={idx}>{w}</span>;
      seen += 1;
      const isCurrent = seen === cutoff;
      return (
        <span
          key={idx}
          className={isCurrent ? "text-white" : undefined}
          style={
            isCurrent
              ? {
                  textShadow:
                    "0 0 18px rgba(165,180,252,0.85), 0 0 42px rgba(129,140,248,0.55), 0 0 80px rgba(99,102,241,0.35)",
                }
              : undefined
          }
        >
          {w}
        </span>
      );
    });
  };

  const body = (
    <>
      {loading && (
        <p className={fullscreen ? "text-xl text-slate-500" : large ? "text-lg text-slate-500" : "text-sm text-slate-500"}>
          Looking for lyrics…
        </p>
      )}

      {!loading && notFound && (
        <p className={fullscreen ? "text-xl text-slate-500" : large ? "text-lg text-slate-500" : "text-sm text-slate-500"}>
          No lyrics found for this track. LRCLIB covers a lot but not everything.
        </p>
      )}

      {lines.length ? (
        <div
          ref={scrollRef}
          className={
            "overflow-y-auto overflow-x-hidden pr-2 scroll-smooth " +
            (fullscreen ? "h-full" : large ? "h-full" : "max-h-72")
          }
          style={
            fullscreen
              ? {
                  paddingTop: "22vh",
                  paddingBottom: "22vh",
                  maskImage:
                    "linear-gradient(to bottom, transparent, black 14%, black 86%, transparent)",
                  WebkitMaskImage:
                    "linear-gradient(to bottom, transparent, black 14%, black 86%, transparent)",
                }
              : undefined
          }
        >
          {lines.map((line, i) => {
            const isActive = i === activeIndex;
            const d = activeIndex < 0 ? 99 : Math.abs(i - activeIndex);
            return (
              <motion.div
                key={i}
                ref={isActive ? activeRef : null}
                animate={{
                  opacity: isActive ? 1 : d <= 1 ? 0.6 : d <= 3 ? 0.3 : 0.15,
                  scale: isActive ? 1 : 0.98,
                }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className={
                  "origin-left break-words " +
                  (fullscreen
                    ? "leading-tight py-2.5 "
                    : large
                      ? "leading-snug py-2 "
                      : "leading-relaxed py-0.5 ") +
                  lineClass(i)
                }
                style={
                  isActive
                    ? { textShadow: "0 0 26px rgba(129,140,248,0.45)" }
                    : undefined
                }
              >
                {renderLine(line.text, isActive)}
              </motion.div>
            );
          })}
        </div>
      ) : data?.plain ? (
        <pre
          className={
            "whitespace-pre-wrap font-sans overflow-y-auto " +
            (fullscreen
              ? "text-lg leading-relaxed text-slate-400 h-full"
              : large
                ? "text-xl leading-relaxed text-slate-400 h-full"
                : "text-sm leading-relaxed text-slate-400 max-h-72")
          }
        >
          {data.plain}
        </pre>
      ) : null}
    </>
  );

  if (large) {
    return <div className="h-full min-h-0">{body}</div>;
  }

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Mic2 className="w-4 h-4 text-indigo-300" />
        <h3 className="font-medium">Lyrics</h3>
      </div>
      {body}
    </div>
  );
}
