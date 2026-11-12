import React, { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Search, Users, ShieldAlert } from "lucide-react";
import { motionTokens } from "../lib/design";

type Member = {
  id: string;
  name: string;
  display_name?: string;
  avatar_url?: string;
  joined_at?: string;
  created_at?: string;
  is_troll?: boolean;
  guilds?: string[];
  violation_count?: number;
};

type Props = {
  apiUrl: string;
  onLookupViolations?: (memberId: string) => void;
};

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.floor((Date.now() - ms) / 86400000);
}

function ago(days: number | null): string {
  if (days == null) return "—";
  if (days < 1) return "today";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} yr`;
}

export default function MembersScreen({ apiUrl, onLookupViolations }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(apiUrl + "/api/members");
        if (!res.ok) throw new Error("bad status");
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setMembers(Array.isArray(data) ? data : data.members || []);
      } catch {
        if (!cancelled) setError("Couldn't reach the bot API — is the Windows laptop awake?");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name?.toLowerCase().includes(q) ||
        m.display_name?.toLowerCase().includes(q) ||
        m.id?.includes(q)
    );
  }, [members, query]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="glass rounded-2xl p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold">Members</h2>
          <p className="text-sm text-slate-400 mt-1">
            {loading ? "Loading…" : `${filtered.length} of ${members.length}`}
          </p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, display name or ID"
            aria-label="Search members"
            className="pl-9 pr-3 py-2 w-64 rounded-lg bg-slate-800/60 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-4 bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200 mb-4">
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-xl p-10 text-center border border-dashed border-slate-700">
          <Users className="w-8 h-8 mx-auto text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">
            {members.length === 0 ? "No members returned by the bot." : "No matches for that search."}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((m) => {
          const ageDays = daysSince(m.created_at);
          const joinedDays = daysSince(m.joined_at);
          return (
            <div
              key={m.id}
              className="flex items-center gap-4 p-3 rounded-xl bg-slate-800/40 border border-slate-700/40 hover:border-slate-600/60 transition-colors"
            >
              {m.avatar_url ? (
                <img
                  src={m.avatar_url}
                  alt=""
                  className="w-10 h-10 rounded-full object-cover bg-slate-700"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-sm text-slate-300">
                  {(m.display_name || m.name || "?").slice(0, 1).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{m.display_name || m.name}</p>
                  {m.is_troll && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                      <ShieldAlert className="w-3 h-3" /> Troll
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {m.name} · {m.id}
                </p>
              </div>

              <div className="hidden sm:block text-xs text-slate-400 text-right shrink-0">
                <p>Joined {ago(joinedDays)}</p>
                <p className="text-slate-500">Account {ago(ageDays)}</p>
              </div>

              <div className="hidden md:block text-xs text-slate-400 w-40 truncate shrink-0">
                {(m.guilds || []).join(", ") || "—"}
              </div>

              <button
                onClick={() => onLookupViolations?.(m.id)}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs bg-slate-700/50 text-slate-300 hover:bg-slate-600/60 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
              >
                Violations
                {typeof m.violation_count === "number" && m.violation_count > 0 && (
                  <span className="ml-1.5 text-rose-300">{m.violation_count}</span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </motion.section>
  );
}
