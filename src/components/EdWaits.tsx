import React, { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { RefreshCw, ExternalLink, TriangleAlert } from "lucide-react";
import { motionTokens, waitTone, relativeMinutes } from "../lib/design";

type Waits = { Mater?: number; "Royal Victoria"?: number };

type Props = {
  apiUrl: string;
  /** Full-screen page (own nav item) rather than the compact dashboard card. */
  variant?: "page" | "card";
};

const CACHE_KEY = "sahara_ed_waits";

export default function EdWaits({ apiUrl, variant = "page" }: Props) {
  const [waits, setWaits] = useState<Waits>({});
  const [lastUpdated, setLastUpdated] = useState("");
  const [lastFetch, setLastFetch] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [stale, setStale] = useState(false);
  const [offline, setOffline] = useState(false);
  const [hasCache, setHasCache] = useState(false);
  const [busy, setBusy] = useState(false);

  // Keep the relative timestamp honest without re-fetching.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const fetchEd = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(apiUrl + "/api/ed-waits");
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      if (data.waits && Object.keys(data.waits).length) {
        setWaits(data.waits);
        if (data.last_updated) setLastUpdated(data.last_updated);
        setStale(!!data.stale);
        setOffline(false);
        setHasCache(true);
        setLastFetch(Date.now());
        try {
          localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ waits: data.waits, last_updated: data.last_updated, fetch: Date.now() })
          );
        } catch {}
      } else {
        setStale(true);
      }
    } catch {
      // Bot API unreachable (Windows box asleep?) — fall back to the last good values.
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        if (cached && cached.waits) {
          setWaits(cached.waits);
          if (cached.last_updated) setLastUpdated(cached.last_updated);
          setLastFetch(cached.fetch || 0);
          setHasCache(true);
        }
      } catch {}
      setStale(true);
      setOffline(true);
    } finally {
      setBusy(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchEd();
    const t = setInterval(fetchEd, 60 * 60 * 1000);
    return () => clearInterval(t);
  }, [fetchEd]);

  const isPage = variant === "page";
  const hospitals: { label: string; key: keyof Waits }[] = [
    { label: "Mater", key: "Mater" },
    { label: "Royal Victoria", key: "Royal Victoria" },
  ];

  const statusLine = offline
    ? hasCache
      ? `API offline — last known values, ${lastFetch ? relativeMinutes(lastFetch, now) : "unknown"}`
      : "API offline — no data yet"
    : lastFetch
      ? `Updated ${relativeMinutes(lastFetch, now)}`
      : "";

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="glass rounded-2xl p-6"
    >
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className={isPage ? "text-xl font-semibold" : "font-semibold"}>Emergency Department</h2>
          <p className="text-sm text-slate-400 mt-1">
            Median arrival-to-clinician, Belfast. Patients are seen by triage priority, not arrival order.
          </p>
        </div>
        <button
          onClick={fetchEd}
          disabled={busy}
          aria-label="Refresh waiting times"
          className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700 text-sm text-slate-300 hover:bg-slate-700/60 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={"w-4 h-4 " + (busy ? "animate-spin" : "")} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <div className={"grid gap-4 " + (isPage ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2")}>
        {hospitals.map(({ label, key }) => (
          <div
            key={key}
            className={
              "rounded-xl p-5 bg-slate-800/40 border border-slate-700/50 " + (stale ? "opacity-70" : "")
            }
          >
            <p className="text-sm text-slate-300">{label}</p>
            <p
              className={
                (isPage ? "text-6xl" : "text-4xl") +
                " font-bold mt-2 tabular-nums " +
                waitTone(waits[key])
              }
            >
              {waits[key] ?? "—"}
              <span className="text-base font-normal text-slate-500 ml-2">min</span>
            </p>
          </div>
        ))}
      </div>

      {statusLine && (
        <p
          className="text-xs text-slate-400 mt-4"
          title={lastUpdated || undefined}
          role="status"
        >
          {stale && "⚠️ "}
          {statusLine}
        </p>
      )}

      <a
        href="https://www.nidirect.gov.uk/articles/minor-injury-units"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200 mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 rounded"
      >
        Minor Injury Units &amp; Urgent Care — often quieter <ExternalLink className="w-3 h-3" />
      </a>

      <details className="mt-4 group">
        <summary className="flex items-center gap-2 text-xs text-rose-300/90 cursor-pointer hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 rounded w-fit">
          <TriangleAlert className="w-3.5 h-3.5" />
          Not medical advice — when to go in person
        </summary>
        <p className="text-xs text-rose-200/80 mt-2 max-w-[65ch] leading-relaxed">
          New numbness or tingling in the fingers, can&apos;t lift the arm, pain getting sharper
          instead of settling, or visible swelling or deformity — go in person rather than checking
          the app.
        </p>
      </details>
    </motion.section>
  );
}
