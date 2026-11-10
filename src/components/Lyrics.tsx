import React, { useEffect, useRef, useState } from "react";
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
};

/**
 * Lyrics from LRCLIB, highlighted line-by-line when the track has synced
 * timing. Falls back to plain text when it doesn't.
 */
export default function Lyrics({ track, artist, album, durationSec, progressMs, trackKey }: Props) {
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
    ? data.synced.reduce((best, line, i) => (line.time <= seconds + 0.4 ? i : best), -1)
    : -1;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  if (!track) return null;

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Mic2 className="w-4 h-4 text-indigo-300" />
        <h3 className="font-medium">Lyrics</h3>
      </div>

      {loading && <p className="text-sm text-slate-500">Looking for lyrics…</p>}

      {!loading && notFound && (
        <p className="text-sm text-slate-500">
          No lyrics found for this track. LRCLIB covers a lot but not everything.
        </p>
      )}

      {data?.synced.length ? (
        <div className="max-h-72 overflow-y-auto pr-1 space-y-1">
          {data.synced.map((line, i) => (
            <p
              key={i}
              ref={i === activeIndex ? activeRef : null}
              className={
                "text-sm leading-relaxed transition-colors duration-300 " +
                (i === activeIndex
                  ? "text-indigo-200 font-medium"
                  : "text-slate-500")
              }
            >
              {line.text}
            </p>
          ))}
        </div>
      ) : data?.plain ? (
        <pre className="text-sm text-slate-400 leading-relaxed whitespace-pre-wrap font-sans max-h-72 overflow-y-auto">
          {data.plain}
        </pre>
      ) : null}
    </div>
  );
}
