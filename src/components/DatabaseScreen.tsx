import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database,
  RefreshCw,
  Search,
  HardDrive,
  Layers,
  ChevronRight,
  ArrowLeft,
  Copy,
  AlertTriangle,
  Table2,
} from "lucide-react";
import { motionTokens } from "../lib/design";
import { formatShort } from "../lib/time";

type Namespace = {
  ns: string;
  label: string;
  records: number;
  events: number;
  viewable: boolean;
};

type Row = { key?: string; value?: unknown } & Record<string, unknown>;

type Props = {
  apiUrl: string;
  notify: (msg: string, type?: string) => void;
};

const PAGE = 50;

function bytes(n: number) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function when(v: unknown) {
  const s = typeof v === "string" ? v : "";
  if (!s || !/^\d{4}-\d{2}-\d{2}T/.test(s)) return null;
  // The shared formatter, so a stored row reads the same as a violation card.
  return formatShort(s) || null;
}

/** A one-line summary of a row, so a list of them is readable at a glance. */
function summarise(row: Row): string {
  const v = (row.value ?? row) as Record<string, unknown>;
  if (typeof v !== "object" || v === null) return String(v);
  const parts: string[] = [];
  for (const k of ["type", "status", "action", "reason", "guild_name", "user_name", "message_content"]) {
    const val = v[k];
    if (val === undefined || val === null || val === "") continue;
    parts.push(`${k}: ${String(val).slice(0, 60)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(" · ") || Object.keys(v).slice(0, 3).join(", ") || "(empty)";
}

export default function DatabaseScreen({ apiUrl, notify }: Props) {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [dbPath, setDbPath] = useState("");
  const [size, setSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [openNs, setOpenNs] = useState<Namespace | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [shape, setShape] = useState<"records" | "events">("records");
  const [offset, setOffset] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl + "/api/db");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          body.error ||
            "Couldn't read the database. This needs the /api/db endpoint on Babblebot — the bot may be running an older build."
        );
        setNamespaces([]);
      } else {
        setNamespaces(body.namespaces || []);
        setDbPath(body.db_path || "");
        setSize(body.size_bytes || 0);
        setError("");
      }
    } catch {
      setError("Couldn't reach the bot. Check it's online.");
      setNamespaces([]);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const loadRows = useCallback(
    async (ns: Namespace, nextOffset: number, q: string) => {
      setRowsLoading(true);
      setRowsError("");
      try {
        const params = new URLSearchParams({
          limit: String(PAGE),
          offset: String(nextOffset),
        });
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(
          apiUrl + "/api/db/" + encodeURIComponent(ns.ns) + "?" + params.toString()
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setRowsError(body.error || "Couldn't read those rows.");
          setRows([]);
        } else {
          setRows(body.rows || []);
          setShape(body.shape === "events" ? "events" : "records");
        }
      } catch {
        setRowsError("Couldn't reach the bot.");
        setRows([]);
      } finally {
        setRowsLoading(false);
      }
    },
    [apiUrl]
  );

  const open = (ns: Namespace) => {
    if (!ns.viewable) {
      notify?.("That namespace isn't readable from here.", "error");
      return;
    }
    setOpenNs(ns);
    setOffset(0);
    setQuery("");
    setExpanded(null);
    loadRows(ns, 0, "");
  };

  const total = useMemo(() => {
    if (!openNs) return 0;
    return shape === "events" ? openNs.events : openNs.records;
  }, [openNs, shape]);

  const search = () => {
    if (!openNs) return;
    setOffset(0);
    setExpanded(null);
    loadRows(openNs, 0, query);
  };

  const page = (dir: 1 | -1) => {
    if (!openNs) return;
    const next = Math.max(0, offset + dir * PAGE);
    setOffset(next);
    setExpanded(null);
    loadRows(openNs, next, query);
  };

  // ── One namespace ──────────────────────────────────────────────
  if (openNs) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setOpenNs(null)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 hover:border-indigo-500/50 text-sm text-slate-200"
           data-tip="Back to the list of tables">
            <ArrowLeft className="w-4 h-4" /> All namespaces
          </button>
          <div className="flex items-center gap-2">
            <Table2 className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-medium text-slate-100">{openNs.label}</span>
            <span className="text-xs text-slate-500 font-mono">{openNs.ns}</span>
          </div>
          <span className="text-xs text-slate-500">
            {total.toLocaleString()} {shape === "events" ? "events" : "records"}
          </span>
          <button
            onClick={() => loadRows(openNs, offset, query)}
            className="ml-auto flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 hover:border-indigo-500/50 text-sm text-slate-200"
           data-tip="Search this table">
            <RefreshCw className={"w-4 h-4 " + (rowsLoading ? "animate-spin" : "")} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Search keys and values…"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            onClick={search}
            className="px-3 py-2 rounded-xl bg-indigo-500/15 border border-indigo-500/40 text-sm text-indigo-200 hover:bg-indigo-500/25"
          
            data-tip="Search this table">
            Search
          </button>
        </div>

        {rowsError && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-200">{rowsError}</p>
          </div>
        )}

        <div className="space-y-2">
          {rowsLoading && rows.length === 0 && (
            <p className="text-sm text-slate-500 py-8 text-center">Reading…</p>
          )}
          {!rowsLoading && rows.length === 0 && !rowsError && (
            <p className="text-sm text-slate-500 py-8 text-center">
              Nothing here{query ? ` matching “${query}”` : ""}.
            </p>
          )}
          {rows.map((row, i) => {
            const isOpen = expanded === i;
            const stamp = when((row.value as any)?.timestamp ?? row.timestamp);
            return (
              <motion.div
                key={(row.key as string) ?? i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={motionTokens.enter}
                className="rounded-2xl bg-slate-800/40 border border-slate-700/70 overflow-hidden"
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : i)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/70"
                 data-tip="Expand or collapse this row">
                  <ChevronRight
                    className={"w-4 h-4 text-slate-500 shrink-0 transition-transform " + (isOpen ? "rotate-90" : "")}
                  />
                  <span className="min-w-0 flex-1">
                    {row.key !== undefined && (
                      <span className="block text-sm font-mono text-slate-200 truncate">{row.key}</span>
                    )}
                    <span className="block text-xs text-slate-400 truncate">{summarise(row)}</span>
                  </span>
                  {stamp && <span className="text-xs text-slate-500 shrink-0">{stamp}</span>}
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={motionTokens.enter}
                      className="border-t border-slate-700/70"
                    >
                      <div className="flex justify-end p-2 border-b border-slate-800">
                        <button
                          onClick={() => {
                            navigator.clipboard?.writeText(
                              JSON.stringify(row.value ?? row, null, 2)
                            );
                            notify?.("Copied", "success");
                          }}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-700/60"
                         data-tip="Copy this value">
                          <Copy className="w-3.5 h-3.5" /> Copy
                        </button>
                      </div>
                      <pre className="p-4 text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                        {JSON.stringify(row.value ?? row, null, 2)}
                      </pre>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>

        {(offset > 0 || rows.length === PAGE) && (
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => page(-1)}
              disabled={offset === 0}
              className="px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-slate-200 disabled:opacity-40"
             data-tip="Previous page">
              Previous
            </button>
            <span className="text-xs text-slate-500">
              {offset + 1}–{offset + rows.length} of {total.toLocaleString()}
            </span>
            <button
              onClick={() => page(1)}
              disabled={offset + rows.length >= total} data-tip="Next page"
              className="px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-slate-200 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Overview ───────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <HardDrive className="w-4 h-4 text-indigo-400" />
          <span className="font-mono text-xs">{dbPath || "babblebot.db"}</span>
        </div>
        <span className="text-xs text-slate-500">{bytes(size)}</span>
        <button
          onClick={load}
          className="ml-auto flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 hover:border-indigo-500/50 text-sm text-slate-200"
        
            data-tip="Reload the table">
          <RefreshCw className={"w-4 h-4 " + (loading ? "animate-spin" : "")} data-tip="Refresh" />Refresh</button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-amber-200">{error}</p>
            <p className="text-xs text-amber-200/70 mt-1">
              The database screen is read-only — nothing here can change what the bot has stored.
            </p>
          </div>
        </div>
      )}

      {!error && namespaces.length === 0 && !loading && (
        <p className="text-sm text-slate-500 py-8 text-center">The database is empty.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {namespaces.map((ns) => (
          <motion.button
            key={ns.ns}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTokens.enter}
            onClick={() => open(ns)}
            disabled={!ns.viewable}
            className={
              "text-left rounded-2xl border p-4 transition-colors " +
              (ns.viewable
                ? "bg-slate-800/40 border-slate-700/70 hover:border-indigo-500/60 hover:bg-slate-800/70"
                : "bg-slate-900/40 border-slate-800 opacity-60 cursor-not-allowed")
            }
          >
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-sm font-medium text-slate-100 truncate">{ns.label}</span>
              {!ns.viewable && (
                <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-500">internal</span>
              )}
            </div>
            <p className="text-xs text-slate-500 font-mono mt-1">{ns.ns}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
              {ns.records > 0 && (
                <span>
                  <span className="text-slate-200 font-medium">{ns.records.toLocaleString()}</span> records
                </span>
              )}
              {ns.events > 0 && (
                <span>
                  <span className="text-slate-200 font-medium">{ns.events.toLocaleString()}</span> events
                </span>
              )}
              {ns.records === 0 && ns.events === 0 && <span>empty</span>}
            </div>
          </motion.button>
        ))}
      </div>

      <p className="text-xs text-slate-500 flex items-center gap-2">
        <Database className="w-3.5 h-3.5" />
        Read-only view of the bot's SQLite database. Namespaces marked internal aren't browsable.
      </p>
    </div>
  );
}
