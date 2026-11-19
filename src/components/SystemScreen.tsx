import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Thermometer,
  Clock,
  Info,
  WifiOff,
} from "lucide-react";
import { motionTokens } from "../lib/design";
import { botFetch } from "../lib/bot";

/**
 * The health of the machine the bot actually runs on.
 *
 * Every "the bot is not responding" this app has ever shown had one of a handful
 * of causes, and they look identical from here: the box is off, the box is asleep,
 * the box is pinned at 100% CPU by a video analysis, or the disk is full. Without
 * this screen the only way to tell them apart was to walk to the other machine.
 *
 * Two rules shape it:
 *
 *   History is kept here, not asked for. Polling gives you one number now; a
 *   sparkline needs the last few minutes, and the bot is not going to grow an
 *   endpoint for that. So the app samples into a ring buffer and the line is
 *   drawn from what it has actually seen.
 *
 *   Old data is shrunk, not frozen. When nothing new arrives the line stays but
 *   greys out and the last-seen time is shown, because a flat line at the last
 *   value would look like a healthy idle machine and it is not the same thing.
 */

type Sample = {
  t: number;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  temp: number | null;
};

type SystemInfo = {
  cpu_percent?: number;
  cpu_name?: string;
  cpu_cores?: number;
  mem_used_bytes?: number;
  mem_total_bytes?: number;
  mem_percent?: number;
  disk_used_bytes?: number;
  disk_total_bytes?: number;
  disk_percent?: number;
  uptime_seconds?: number;
  boot_time?: string;
  temps?: { label: string; celsius: number }[];
  gpu?: { name?: string; percent?: number; temp_celsius?: number } | null;
  bot_online?: boolean;
  api_version?: string;
  error?: string;
};

type Props = {
  apiUrl: string;
  notify: (msg: string, type?: string) => void;
};

/** How often to ask. Cheap enough to be unnoticed, often enough to be current. */
const POLL_MS = 5_000;
/** How many samples are kept: 5s × 120 = ten minutes of history. */
const KEEP = 120;

function bytes(n?: number) {
  if (!n || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function uptime(seconds?: number) {
  if (!seconds || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** A polyline from the samples that exist, skipping gaps rather than inventing them. */
function sparkPath(values: (number | null)[], width: number, height: number, max = 100) {
  const pts: string[] = [];
  const step = values.length > 1 ? width / (values.length - 1) : width;
  values.forEach((v, i) => {
    if (v === null || Number.isNaN(v)) return;
    const x = i * step;
    const y = height - Math.max(0, Math.min(1, v / max)) * height;
    pts.push(`${pts.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return pts.join(" ");
}

function Spark({
  values,
  tone,
  stale,
  max = 100,
}: {
  values: (number | null)[];
  tone: string;
  stale: boolean;
  max?: number;
}) {
  const w = 160;
  const h = 36;
  const path = sparkPath(values, w, h, max);
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <line x1={0} y1={h} x2={w} y2={h} stroke="currentColor" className="text-slate-700" strokeWidth={1} />
      {path && (
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          className={stale ? "text-slate-600" : tone}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={stale ? "3 3" : undefined}
        />
      )}
    </svg>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  values,
  tone,
  stale,
  max,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  sub?: string;
  values: (number | null)[];
  tone: string;
  stale: boolean;
  max?: number;
}) {
  return (
    <div className="glass rounded-xl p-3 flex items-center gap-3">
      <span className={"w-9 h-9 rounded-lg bg-slate-800/70 flex items-center justify-center shrink-0 " + tone}>
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-slate-500">{label}</p>
        <p className="text-sm font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-[10px] text-slate-600 truncate" data-tip={sub}>{sub}</p>}
      </div>
      <Spark values={values} tone={tone} stale={stale} max={max} />
    </div>
  );
}

export default function SystemScreen({ apiUrl, notify }: Props) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await botFetch(apiUrl + "/api/system");
      if (res.status === 404) {
        setMissing(true);
        setError("");
        return;
      }
      const data: SystemInfo = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error || `The bot answered ${res.status}`);
        return;
      }
      setMissing(false);
      setError("");
      setInfo(data);
      const now = Date.now();
      setLastSeen(now);
      setSamples((prev) =>
        [
          ...prev,
          {
            t: now,
            cpu: typeof data.cpu_percent === "number" ? data.cpu_percent : null,
            mem: typeof data.mem_percent === "number" ? data.mem_percent : null,
            disk:
              typeof data.disk_percent === "number"
                ? data.disk_percent
                : data.disk_used_bytes && data.disk_total_bytes
                ? (data.disk_used_bytes / data.disk_total_bytes) * 100
                : null,
            temp: data.temps?.length ? Math.max(...data.temps.map((t) => t.celsius)) : null,
          },
        ].slice(-KEEP),
      );
    } catch {
      // A failed poll is not an error worth a banner on every tick — it is the
      // machine being asleep, which the "last seen" line already says.
      setError("");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (paused) return;
    timer.current = window.setInterval(() => void load(), POLL_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load, paused]);

  /** No new sample in three polls means the box stopped answering. */
  const stale = lastSeen !== null && Date.now() - lastSeen > POLL_MS * 3;
  const series = (key: keyof Omit<Sample, "t">) => samples.map((s) => s[key]);

  if (missing) {
    return (
      <div className="glass rounded-2xl p-5 max-w-xl">
        <div className="flex items-start gap-3">
          <Activity className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">System stats aren't available yet</h3>
            <p className="text-sm text-slate-400 mt-1">
              The bot doesn't have the `/api/system` route yet. The screen is built — it
              starts drawing the moment the bot answers, and the history builds up live
              from there rather than being asked for.
            </p>
            <button
              onClick={() => void load()}
              className="mt-3 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700/60"
            >
              Check again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cpuName = info?.cpu_name || "unknown CPU";
  const memPercent = info?.mem_percent ??
    (info?.mem_used_bytes && info?.mem_total_bytes
      ? (info.mem_used_bytes / info.mem_total_bytes) * 100
      : undefined);
  const diskPercent = info?.disk_percent ??
    (info?.disk_used_bytes && info?.disk_total_bytes
      ? (info.disk_used_bytes / info.disk_total_bytes) * 100
      : undefined);
  const hottest = info?.temps?.length
    ? info.temps.reduce((a, b) => (b.celsius > a.celsius ? b : a))
    : null;

  return (
    <div className="space-y-4 max-w-4xl">
      <motion.div
        {...{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: motionTokens.enter }}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-300" />
          <h3 className="font-semibold text-sm">The machine running the bot</h3>
          {stale && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 flex items-center gap-1">
              <WifiOff className="w-3 h-3" /> not answering — showing what it last said
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastSeen && (
            <span className="text-[11px] text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {stale ? "last heard " : "updated "}
              {Math.max(0, Math.round((Date.now() - lastSeen) / 1000))}s ago
            </span>
          )}
          <button
            onClick={() => setPaused((p) => !p)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700/60"
            data-tip={paused ? "Start reading again" : "Stop reading (saves waking the machine)"}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => void load()}
            className="p-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60"
            data-tip="Read once now"
          >
            <RefreshCw className={"w-4 h-4 " + (loading ? "animate-spin" : "")} />
          </button>
        </div>
      </motion.div>

      {error && (
        <p className="text-xs text-rose-300 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {loading && samples.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Asking the machine…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Stat
              icon={Cpu}
              label="Processor"
              value={typeof info?.cpu_percent === "number" ? `${info.cpu_percent.toFixed(0)}%` : "—"}
              sub={cpuName}
              values={series("cpu")}
              tone={
                (info?.cpu_percent ?? 0) > 85
                  ? "text-rose-300"
                  : (info?.cpu_percent ?? 0) > 60
                  ? "text-amber-300"
                  : "text-emerald-300"
              }
              stale={stale}
            />
            <Stat
              icon={MemoryStick}
              label="Memory"
              value={memPercent !== undefined ? `${memPercent.toFixed(0)}%` : "—"}
              sub={
                info?.mem_used_bytes && info?.mem_total_bytes
                  ? `${bytes(info.mem_used_bytes)} of ${bytes(info.mem_total_bytes)}`
                  : undefined
              }
              values={series("mem")}
              tone={(memPercent ?? 0) > 90 ? "text-rose-300" : "text-sky-300"}
              stale={stale}
            />
            <Stat
              icon={HardDrive}
              label="Disk"
              value={diskPercent !== undefined ? `${diskPercent.toFixed(0)}%` : "—"}
              sub={
                info?.disk_total_bytes
                  ? `${bytes((info.disk_total_bytes || 0) - (info.disk_used_bytes || 0))} free`
                  : undefined
              }
              values={series("disk")}
              tone={(diskPercent ?? 0) > 92 ? "text-rose-300" : "text-violet-300"}
              stale={stale}
            />
            <Stat
              icon={Thermometer}
              label="Temperature"
              value={hottest ? `${hottest.celsius.toFixed(0)}°C` : "—"}
              sub={
                hottest
                  ? hottest.label
                  : "no sensor readings — Windows gives none until LibreHardwareMonitor is running on that machine, then reopen this screen"
              }
              values={series("temp")}
              tone={(hottest?.celsius ?? 0) > 85 ? "text-rose-300" : "text-amber-300"}
              stale={stale}
            />
          </div>

          {(info?.temps?.length ?? 0) > 0 && (
            <div className="glass rounded-xl p-4">
              <p className="text-[11px] text-slate-500 mb-2">
                Every reading
                {info?.temps && info.temps.length > 1 ? " — the hottest is the one above" : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {(info?.temps ?? [])
                  .slice()
                  .sort((a, b) => b.celsius - a.celsius)
                  .map((t, i) => (
                    <span
                      key={i}
                      className={
                        "text-xs px-2 py-1 rounded-lg " +
                        (t.celsius > 85
                          ? "bg-rose-500/15 text-rose-300"
                          : "bg-slate-700/40 text-slate-300")
                      }
                    >
                      {t.label} · {t.celsius.toFixed(0)}°C
                    </span>
                  ))}
              </div>
            </div>
          )}

          <div className="glass rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[11px] text-slate-500">Up for</p>
              <p className="text-sm font-semibold">{uptime(info?.uptime_seconds)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Cores</p>
              <p className="text-sm font-semibold">{info?.cpu_cores ?? "—"}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">GPU</p>
              <p className="text-sm font-semibold truncate" data-tip={info?.gpu?.name}>
                {info?.gpu
                  ? `${info.gpu.percent !== undefined ? `${info.gpu.percent.toFixed(0)}%` : "ok"}`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">History</p>
              <p className="text-sm font-semibold">
                {samples.length === 0
                  ? "—"
                  : `${Math.round((samples.length * POLL_MS) / 60000)} min`}
              </p>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            The line is drawn from what this app has actually seen, not from anything the bot
            stores — so it starts empty after a restart and fills in over ten minutes. Nothing
            here is polled while the app is closed.
          </p>
        </>
      )}
    </div>
  );
}
