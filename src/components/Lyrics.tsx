import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Mic2 } from "lucide-react";
import { getLyrics, type Lyrics as LyricsData } from "../lib/spotify";

type Props = {
  track?: string;
  artist?: string;
  album?: string;
  /** Track length in seconds — improves the exact LRCLIB match. */
  durationSec?: number;
  /** Playback position in ms, updated by the parent's poll. */
  progressMs?: number;
  /** Changing track keys the component so state resets cleanly. */
  trackKey: string;
  /** "card" is the compact sidebar version; "large" is for the full-screen player. */
  variant?: "card" | "large";
};

/**
 * Lyrics from LRCLIB, highlighted line-by-line when the track has synced
 * timing. Falls back to plain text when it doesn't.
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
  const activeRef = useRef<HTMLParagraphElement | null>(null);

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

  const seconds = progressMs != null ? progressMs / 1000 : 0;
  const activeIndex = data?.synced.length
    ? data.synced.reduce((best, line, i) => (line.time <= seconds + 0.25 ? i : best), -1)
    : -1;

  // Distance from the active line, so nearby lines can fade rather than snap.
  const distance = (i: number) => (activeIndex < 0 ? 99 : Math.abs(i - activeIndex));

  // Scroll the active line into view. Scrolls the container rather than using
  // scrollIntoView, which can also scroll the page behind the overlay.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = scrollRef.current;
    const el = activeRef.current;
    if (!container || !el) return;
    const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeIndex]);

  if (!track) return null;

  const large = variant === "large";
  const lineClass = (i: number) =>
    large
      ? i === activeIndex
        ? "text-2xl sm:text-3xl font-semibold text-indigo-200 transition-colors duration-200"
        : "text-2xl sm:text-3xl font-semibold text-slate-600 transition-colors duration-200"
      : i === activeIndex
        ? "text-sm text-indigo-200 font-medium transition-colors duration-200"
        : "text-sm text-slate-500 transition-colors duration-200";

  const body = (
    <>
      {loading && (
        <p className={large ? "text-lg text-slate-500" : "text-sm text-slate-500"}>
          Looking for lyrics…
        </p>
      )}

      {!loading && notFound && (
        <p className={large ? "text-lg text-slate-500" : "text-sm text-slate-500"}>
          No lyrics found for this track. LRCLIB covers a lot but not everything.
        </p>
      )}

      {data?.synced.length ? (
        <div
          ref={scrollRef}
          className={
            "overflow-y-auto pr-1 scroll-smooth " + (large ? "h-full" : "max-h-72")
          }
        >
          {data.synced.map((line, i) => {
            const d = distance(i);
            const isActive = i === activeIndex;
            return (
              <motion.p
                key={i}
                ref={isActive ? activeRef : null}
                animate={{
                  opacity: isActive ? 1 : d <= 1 ? 0.65 : d <= 3 ? 0.35 : 0.18,
                  scale: isActive ? 1 : 0.97,
                  y: isActive ? 0 : 0,
                }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className={
                  (large ? "leading-snug py-2 origin-left " : "leading-relaxed py-0.5 origin-left ") +
                  lineClass(i)
                }
              >
                {line.text}
              </motion.p>
            );
          })}
        </div>
      ) : data?.plain ? (
        <pre
          className={
            "whitespace-pre-wrap font-sans overflow-y-auto " +
            (large
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
    return <div className="h-full">{body}</div>;
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
