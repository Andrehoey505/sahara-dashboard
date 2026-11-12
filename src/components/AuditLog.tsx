import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { formatShort, formatTitle } from "../lib/time";
import { RefreshCw, UserPlus, ShieldAlert, FileText, Search } from "lucide-react";
import { motionTokens, severity } from "../lib/design";

type Entry = {
  timestamp: string;
  type: string;
  guild_name?: string;
  guild_id?: string;
  channel_name?: string;
  author_name?: string;
  author_id?: string;
  member_name?: string;
  member_id?: string;
  action?: string;
  reason?: string;
  violations?: any[];
  message_content?: string;
  content?: string;
  error?: string;
  [key: string]: any;
};

type Props = {
  apiUrl: string;
  notify: (msg: string, type?: string) => void;
};

const FILTERS: { id: string; label: string; types: string }[] = [
  { id: "all", label: "Everything", types: "" },
  { id: "bans", label: "Bans & kicks", types: "member_banned,member_unbanned,troll_banned,member_kicked" },
  { id: "actions", label: "Mod actions", types: "action_taken,action_failed" },
  { id: "decisions", label: "Violation decisions", types: "violation_resolved" },
  { id: "flags", label: "Flags", types: "violation_detected,flag_for_review" },
  { id: "messages", label: "Messages", types: "message_deleted,message_edited" },
  { id: "members", label: "Joins & leaves", types: "member_joined,member_left" },
  { id: "server", label: "Server changes", types: "role_created,role_deleted,channel_created,channel_deleted" },
];

function describe(e: Entry): { title: string; detail: string; tone: string; target?: string; targetName?: string } {
  const toneOf = (sev: keyof typeof severity) => severity[sev].text;

  switch (e.type) {
    case "member_banned":
      return {
        title: "Member banned",
        detail: `${e.user_name || e.user_id || "someone"}${e.reason ? ` — ${e.reason}` : ""}`,
        tone: toneOf("critical"),
        target: e.user_id,
        targetName: e.user_name,
      };
    case "member_unbanned":
      return { title: "Member unbanned", detail: e.user_name || e.user_id || "", tone: toneOf("low"), target: e.user_id, targetName: e.user_name };
    case "troll_banned":
      return { title: "Troll banned", detail: `${e.member_name || e.author_name || ""} — known troll list`, tone: toneOf("critical"), target: e.member_id || e.author_id, targetName: e.member_name || e.author_name };
    case "action_taken":
      return {
        title: `Action: ${e.action || "unknown"}`,
        detail: `${e.author_name || ""}${e.reason ? ` — ${e.reason}` : ""}${e.violations ? ` (${(e.violations as any[]).join(", ")})` : ""}`,
        tone: toneOf("high"),
        target: e.author_id,
        targetName: e.author_name,
      };
    case "action_failed":
      return { title: `Action failed: ${e.action || "unknown"}`, detail: e.error || "", tone: toneOf("high"), target: e.author_id, targetName: e.author_name };
    case "violation_detected":
    case "flag_for_review": {
      const types = (e.violations || []).map((v: any) => v.type).filter(Boolean);
      return {
        title: e.is_critical ? "Critical violation" : "Flagged",
        detail: `${e.author_name || ""}${types.length ? ` — ${types.join(", ")}` : ""}${e.message_content ? `: "${String(e.message_content).slice(0, 80)}"` : ""}`,
        tone: toneOf(e.is_critical ? "critical" : "medium"),
        target: e.author_id,
        targetName: e.author_name,
      };
    }
    case "message_deleted": {
      const text = e.content_snippet || e.content || e.message_content || "";
      return {
        title: "Message deleted",
        detail: `${e.author_name || "someone"}${e.channel_name ? ` in #${e.channel_name}` : ""}${text ? `: “${String(text).slice(0, 120)}”` : " — content not recorded"}`,
        tone: toneOf("medium"),
        target: e.author_id,
        targetName: e.author_name,
      };
    }
    case "message_edited": {
      const before = e.before_content || e.content_snippet || e.content || "";
      const after = e.after_content || "";
      return {
        title: "Message edited",
        detail: `${e.author_name || "someone"}${e.channel_name ? ` in #${e.channel_name}` : ""}${before ? `: was “${String(before).slice(0, 100)}”` : ""}${after ? ` → now “${String(after).slice(0, 100)}”` : ""}`,
        tone: toneOf("low"),
        target: e.author_id,
        targetName: e.author_name,
      };
    }
    case "member_joined":
      return { title: "Member joined", detail: `${e.member_name || ""}${e.account_age_hours != null ? ` — account ${Math.round(e.account_age_hours)}h old` : ""}`, tone: toneOf("low"), target: e.member_id, targetName: e.member_name };
    case "member_left":
      return { title: "Member left", detail: e.member_name || "", tone: "text-slate-400", target: e.member_id, targetName: e.member_name };
    case "role_created":
      return { title: "Role created", detail: e.role_name || "", tone: toneOf("low") };
    case "role_deleted":
      return { title: "Role deleted", detail: e.role_name || "", tone: toneOf("medium") };
    case "channel_created":
      return { title: "Channel created", detail: `#${e.channel_name || ""}`, tone: toneOf("low") };
    case "channel_deleted":
      return { title: "Channel deleted", detail: `#${e.channel_name || ""}`, tone: toneOf("high") };
    case "violation_resolved":
      return {
        title: e.action === "deny" ? "Violation denied" : "Violation approved",
        detail: `${e.author_name || "someone"}${e.violation_type ? ` — ${e.violation_type}` : ""}${e.reason ? `: “${String(e.reason).slice(0, 100)}”` : ""}`,
        tone: toneOf(e.action === "deny" ? "low" : "medium"),
        target: e.author_id,
        targetName: e.author_name,
      };
    case "verification_complete":
      return { title: "Verified", detail: `${e.verified_user_name || ""} by ${e.verifier_name || ""}`, tone: toneOf("low"), target: e.verified_user_id, targetName: e.verified_user_name };
    default:
      return { title: e.type, detail: "", tone: "text-slate-400" };
  }
}

export default function AuditLog({ apiUrl, notify, serverId }: Props & { serverId?: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const types = FILTERS.find((f) => f.id === filter)?.types || "";
    const params = new URLSearchParams({ limit: "200" });
    if (types) params.set("type", types);
    // The screen shows a server picker, so it has to actually narrow to it.
    if (serverId) params.set("guild_id", serverId);
    try {
      const res = await fetch(apiUrl + "/api/audit?" + params.toString());
      if (!res.ok) throw new Error("bad status");
      const data = await res.json().catch(() => ({}));
      setEntries(data.entries || []);
      setError("");
    } catch {
      setError(
        "Couldn't load the audit log. This needs the /api/audit endpoint on Babblebot — the bot may also be offline."
      );
    } finally {
      setLoading(false);
    }
  }, [apiUrl, filter, serverId]);

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const addTroll = async (e: Entry, target: string, name?: string) => {
    setBusy(target);
    try {
      const res = await fetch(apiUrl + "/api/trolls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: target,
          reason: `${e.type}${e.reason ? `: ${e.reason}` : ""}`.slice(0, 200),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        notify(`${name || target} added to the troll list`, "success");
      } else {
        notify(data.error || "Couldn't add that user", "error");
      }
    } catch {
      notify("Connection failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
  }, [entries, query]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Server log</h2>
          <p className="text-sm text-slate-400 mt-1">
            What happened, who did it, and why. Newest first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the log"
              aria-label="Search the audit log"
              className="pl-9 pr-3 py-2 w-56 rounded-lg bg-slate-800/60 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition"
            />
          </div>
          <button
            onClick={load}
            aria-label="Refresh the log"
            className="p-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
          
            data-tip="Reload the audit log">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={
              "px-3 py-1.5 rounded-lg text-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 " +
              (filter === f.id
                ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-200"
                : "bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-700/50")
            }
           data-tip="Filter the log">
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl p-4 bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {!loading && !error && filtered.length === 0 && (
        <div className="glass rounded-2xl p-10 text-center border border-dashed border-slate-700">
          <FileText className="w-8 h-8 mx-auto text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">
            {entries.length === 0 ? "Nothing logged for this filter yet." : "No matches for that search."}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        {filtered.map((e, i) => {
          const d = describe(e);
          const when = e.timestamp ? new Date(e.timestamp) : null;
          return (
            <div
              key={`${e.timestamp}-${i}`}
              className="glass rounded-xl px-4 py-3 flex items-center gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={"text-sm font-medium " + d.tone}>{d.title}</span>
                  {e.guild_name && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400">
                      {e.guild_name}
                    </span>
                  )}
                  {e.channel_name && (
                    <span className="text-xs text-slate-500">#{e.channel_name}</span>
                  )}
                </div>
                {d.detail && (
                  <p
                    className={
                      "text-sm text-slate-400 mt-0.5 " +
                      (e.type === "message_deleted" || e.type === "message_edited"
                        ? "break-words"
                        : "truncate")
                    }
                  >
                    {d.detail}
                  </p>
                )}
              </div>

              <span className="shrink-0 text-xs text-slate-600 tabular-nums">
                {when
                  ? formatShort(e.timestamp)
                  : ""}
              </span>

              {d.target && (
                <button
                  onClick={() => addTroll(e, String(d.target), d.targetName)}
                  disabled={busy !== null}
                  title="Add this user to the troll list" data-tip="Add this user to the troll list"
                  aria-label={`Add ${d.targetName || d.target} to the troll list`}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 disabled:opacity-40 transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Troll
                </button>
              )}
            </div>
          );
        })}
      </div>
    </motion.section>
  );
}
