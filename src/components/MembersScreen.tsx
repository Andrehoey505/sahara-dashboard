import React, { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Search, Users, ShieldAlert, ShieldOff, ShieldCheck } from "lucide-react";
import { motionTokens } from "../lib/design";

type Member = {
  id: string;
  name: string;
  display_name?: string;
  avatar_url?: string;
  joined_at?: string;
  created_at?: string;
  is_troll?: boolean;
  is_exempt?: boolean;
  is_staff?: boolean;
  exempt_reason?: string;
  exempt_reason_label?: string;
  exempt_note?: string;
  guilds?: string[];
  violation_count?: number;
  warning_count?: number;
};

type Props = {
  apiUrl: string;
  onLookupViolations?: (memberId: string) => void;
};

type Reason = { id: string; label: string };

// The API sends this list with /api/exempt-users so the app offers exactly what the
// bot accepts. This is the fallback for an older API, not a second source of truth.
const FALLBACK_REASONS: Reason[] = [
  { id: "staff", label: "Staff or moderator" },
  { id: "trusted", label: "Trusted member" },
  { id: "bot_owner", label: "Server owner" },
  { id: "health", label: "Health or care context" },
  { id: "test", label: "Test account" },
  { id: "other", label: "Other" },
];

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
  // Exempting is a manual, per-person decision: nobody is exempt unless a human
  // put them on the list, and it is saved in the bot's database so the bot reads
  // the same list. Two people clicking at once can't half-apply it.
  const [saving, setSaving] = useState<string>("");
  const [saveError, setSaveError] = useState("");
  const [reasons, setReasons] = useState<Reason[]>(FALLBACK_REASONS);
  // Which member is choosing a reason right now, and what they picked.
  const [choosing, setChoosing] = useState<string>("");
  const [reasonPick, setReasonPick] = useState<string>("staff");
  const [note, setNote] = useState<string>("");

  async function toggleExempt(
    m: Member,
    reason?: string,
    extra?: string,
  ) {
    const next = !m.is_exempt;
    setSaving(m.id);
    setSaveError("");
    try {
      const res = await fetch(apiUrl + `/api/members/${m.id}/exempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exempt: next,
          name: m.display_name || m.name,
          server: (m.guilds || [])[0] || "",
          reason: next ? reason ?? "" : "",
          note: next ? extra ?? "" : "",
        }),
      }).catch(() => null);
      const data = await res?.json().catch(() => ({}));
      if (!res || !res.ok) {
        // Say why. A toggle that silently snaps back is indistinguishable from
        // one that worked and got forgotten.
        throw new Error(data?.error || `the bot API said ${res?.status ?? "nothing"}`);
      }
      const label = reasons.find((r) => r.id === reason)?.label || "";
      setMembers((prev) =>
        prev.map((x) =>
          x.id === m.id
            ? {
                ...x,
                is_exempt: next,
                exempt_reason: next ? reason ?? "" : "",
                exempt_reason_label: next ? label : "",
                exempt_note: next ? extra ?? "" : "",
              }
            : x,
        ),
      );
      setChoosing("");
    } catch (e) {
      setSaveError(
        `Couldn't ${next ? "exempt" : "un-exempt"} ${m.display_name || m.name}: ${
          e instanceof Error ? e.message : "unknown error"
        }`,
      );
    } finally {
      setSaving("");
    }
  }
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch(apiUrl + "/api/exempt-users").catch(() => null);
      const data = await res?.json().catch(() => ({}));
      if (Array.isArray(data?.reasons) && data.reasons.length) setReasons(data.reasons);
    })();
  }, [apiUrl]);

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

      {saveError && (
        <div className="rounded-xl p-3 bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200 mb-4 flex items-start justify-between gap-3">
          <span>{saveError}</span>
          <button
            onClick={() => setSaveError("")}
            className="text-amber-300/80 hover:text-amber-200 shrink-0"
            data-tip="Dismiss"
          >
            ✕
          </button>
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
                  {m.is_exempt && (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                      data-tip={
                        m.exempt_note
                          ? `${m.exempt_reason_label || "Exempt"}: ${m.exempt_note}`
                          : m.exempt_reason_label || "Exempt from being flagged"
                      }
                    >
                      <ShieldCheck className="w-3 h-3" />{" "}
                      {m.exempt_reason_label ? m.exempt_reason_label : "Not flagged"}
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
                onClick={() => {
                  if (m.is_exempt) {
                    // Un-exempting needs no reason, so it takes one press.
                    toggleExempt(m);
                    return;
                  }
                  setChoosing(choosing === m.id ? "" : m.id);
                  setReasonPick(m.exempt_reason || "staff");
                  setNote(m.exempt_note || "");
                }}
                disabled={saving === m.id}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs border transition-colors disabled:opacity-50 ${
                  m.is_exempt
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25"
                    : "bg-slate-700/50 text-slate-300 border-slate-600/40 hover:bg-slate-600/60 hover:text-slate-100"
                }`}
                data-tip={
                  m.is_exempt
                    ? "Stop exempting — the bot will flag their messages again"
                    : "Never flag this member. Manual only: nothing here is automatic"
                }
              >
                {saving === m.id ? "Saving…" : m.is_exempt ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => onLookupViolations?.(m.id)}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs bg-slate-700/50 text-slate-300 hover:bg-slate-600/60 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
               data-tip="Look up this member's violations">
                Violations
                {typeof m.warning_count === "number" && m.warning_count > 0 && (
                  <span className="ml-1.5 text-amber-300" title={`${m.warning_count} warning(s) on record`}>
                    ⚠{m.warning_count}
                  </span>
                )}
                {typeof m.violation_count === "number" && m.violation_count > 0 && (
                  <span className="ml-1.5 text-rose-300">{m.violation_count}</span>
                )}
              </button>

              {choosing === m.id && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="basis-full mt-2 rounded-xl bg-slate-900/60 border border-emerald-500/25 p-3"
                >
                  <p className="text-xs text-slate-400 mb-2">
                    Why is {m.display_name || m.name} exempt? The bot won't flag them at all —
                    a moderator can still act by hand.
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {reasons.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setReasonPick(r.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                          reasonPick === r.id
                            ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/40"
                            : "bg-slate-800/60 text-slate-300 border-slate-700/50 hover:border-slate-600"
                        }`}
                        data-tip={`Exempt: ${r.label}`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 200))}
                    placeholder="Anything worth remembering (optional, 200 characters)"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-800/70 border border-slate-700/60 text-xs text-slate-200 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => toggleExempt(m, reasonPick, note.trim())}
                      disabled={saving === m.id}
                      className="px-3 py-1.5 rounded-lg text-xs bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-50"
                      data-tip="Exempt this member from being flagged"
                    >
                      {saving === m.id ? "Saving…" : "Exempt"}
                    </button>
                    <button
                      onClick={() => setChoosing("")}
                      className="px-3 py-1.5 rounded-lg text-xs bg-slate-700/50 text-slate-300 border border-slate-600/40 hover:bg-slate-600/60"
                      data-tip="Cancel"
                    >
                      Cancel
                    </button>
                    <span className="text-[11px] text-slate-500">
                      {note.length}/200
                    </span>
                  </div>
                </motion.div>
              )}
            </div>
          );
        })}
      </div>
    </motion.section>
  );
}
