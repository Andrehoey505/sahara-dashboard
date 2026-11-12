import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Ticket,
  RefreshCw,
  Search,
  Lock,
  Clock,
  User,
  Hash,
  FileText,
  CircleDot,
  CircleCheck,
  Inbox,
  AlertTriangle,
  TicketCheck,
  Settings2,
} from "lucide-react";
import { motionTokens } from "../lib/design";
import type { Server } from "../lib/servers";
import { formatShort } from "../lib/time";

type Ticket = {
  channel_id: string;
  guild_id: string;
  user_id: string;
  user_name: string;
  number: number;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
  transcript_path: string | null;
};

type Panel = { channel_id: string; message_id: string; posted_at: string };

type Props = {
  apiUrl: string;
  server: Server | undefined;
  servers: Server[];
  notify: (msg: string, type?: string) => void;
  onOpenConfig?: () => void;
};

const card = "rounded-2xl border border-slate-700/60 bg-slate-900/60 backdrop-blur";

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatShort(iso);
}

function duration(from: string, to: string | null): string {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const mins = Math.max(0, Math.floor((end - start) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

export default function TicketScreen({ apiUrl, server, servers, notify, onOpenConfig }: Props) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [panels, setPanels] = useState<Record<string, Panel>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"open" | "closed" | "all">("open");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // One request for every ticket, then filter locally: switching tabs should
      // not go back to the bot, and the counts are needed for both tabs anyway.
      const [tRes, pRes] = await Promise.all([
        fetch(apiUrl + "/api/tickets"),
        fetch(apiUrl + "/api/ticket-panels"),
      ]);
      if (!tRes.ok) throw new Error(`the bot answered ${tRes.status}`);
      const data = await tRes.json();
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
      if (pRes.ok) {
        const p = await pRes.json();
        setPanels(p.panels || {});
      }
    } catch (e: any) {
      setError(
        e?.message?.includes("fetch")
          ? "Couldn't reach the bot — check the API address in Settings."
          : e?.message || "Couldn't load tickets."
      );
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const scoped = useMemo(
    () => (server ? tickets.filter((t) => String(t.guild_id) === String(server.id)) : tickets),
    [tickets, server]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter((t) => {
      if (tab === "open" && t.status !== "open") return false;
      if (tab === "closed" && t.status !== "closed") return false;
      if (!q) return true;
      return (
        String(t.number).includes(q) ||
        t.user_name?.toLowerCase().includes(q) ||
        t.channel_id.includes(q)
      );
    });
  }, [scoped, tab, query]);

  const openCount = scoped.filter((t) => t.status === "open").length;
  const closedCount = scoped.filter((t) => t.status === "closed").length;
  const panel = server ? panels[String(server.id)] : undefined;
  const channelName = (id: string) => `#${id}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="space-y-5"
    >
      {/* Header: counts, refresh, and the one thing that actually needs doing. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <CircleDot className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-sm text-emerald-300 font-medium">{openCount} open</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/60 border border-slate-700">
            <CircleCheck className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-sm text-slate-300">{closedCount} closed</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-slate-200 hover:bg-slate-700/60 transition"
          >
            <RefreshCw className={"w-4 h-4 " + (loading ? "animate-spin" : "")} />
            Refresh
          </button>
          {onOpenConfig && (
            <button
              onClick={onOpenConfig}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-600/20 border border-indigo-500/40 text-sm text-indigo-200 hover:bg-indigo-600/30 transition"
            >
              <Settings2 className="w-4 h-4" />
              Ticket settings
            </button>
          )}
        </div>
      </div>

      {/* The panel is how tickets get opened at all, so its state is not a detail. */}
      <div className={card + " p-4"}>
        <div className="flex items-start gap-3">
          <div className={"p-2 rounded-xl " + (panel ? "bg-emerald-500/10" : "bg-amber-500/10")}>
            {panel ? (
              <TicketCheck className="w-5 h-5 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-100">
              {panel ? "Panel is posted" : "No panel posted yet"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {panel
                ? `Posted ${timeAgo(panel.posted_at)} in channel ${channelName(panel.channel_id)}.`
                : "Nobody can open a ticket until the button is posted."}
            </p>
            {!panel && (
              <p className="text-xs text-slate-500 mt-2">
                In Discord run{" "}
                <code className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">bb!tickets panel</code>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-800/50 border border-slate-700/60">
          {(["open", "closed", "all"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "px-3 py-1.5 rounded-lg text-sm capitalize transition " +
                (tab === t
                  ? "bg-indigo-600/30 text-indigo-100"
                  : "text-slate-400 hover:text-slate-200")
              }
            >
              {t}
              {t === "open" && openCount > 0 && (
                <span className="ml-1.5 text-xs text-emerald-300">{openCount}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ticket number, name or channel id"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* List */}
      {loading && tickets.length === 0 ? (
        <div className={card + " p-10 text-center text-slate-400 text-sm"}>Loading tickets…</div>
      ) : filtered.length === 0 ? (
        <div className={card + " p-10 flex flex-col items-center gap-3 text-center"}>
          <Inbox className="w-8 h-8 text-slate-600" />
          <p className="text-sm text-slate-400">
            {tab === "open"
              ? "No open tickets. Quiet is good."
              : tab === "closed"
              ? "Nothing closed yet."
              : "No tickets at all yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {filtered.map((t) => (
              <motion.div
                key={t.channel_id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className={
                  card +
                  " p-4 flex flex-wrap items-center gap-4 " +
                  (t.status === "open" ? "border-l-2 border-l-emerald-500" : "border-l-2 border-l-slate-600")
                }
              >
                <div className="flex items-center gap-3 min-w-[180px] flex-1">
                  <div
                    className={
                      "w-9 h-9 rounded-xl flex items-center justify-center text-xs font-semibold " +
                      (t.status === "open"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-slate-700/50 text-slate-400")
                    }
                  >
                    #{t.number}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-100 truncate flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      {t.user_name}
                    </p>
                    <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                      <Hash className="w-3 h-3 shrink-0" />
                      {t.channel_id}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    opened {timeAgo(t.opened_at)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {t.status === "open" ? (
                      <>
                        <CircleDot className="w-3.5 h-3.5 text-emerald-400" />
                        {duration(t.opened_at, null)} old
                      </>
                    ) : (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        {duration(t.opened_at, t.closed_at)}
                      </>
                    )}
                  </span>
                  {t.status === "closed" && (
                    <span
                      className={
                        "flex items-center gap-1.5 " +
                        (t.transcript_path ? "text-slate-300" : "text-amber-400/80")
                      }
                      title={t.transcript_path || "No transcript was saved"}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {t.transcript_path ? "transcript saved" : "no transcript"}
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {servers.length > 1 && (
        <p className="text-xs text-slate-500">
          Showing {server ? server.name : "every server"}. Change it in the bar above.
        </p>
      )}
    </motion.div>
  );
}
