import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, Plus, Trash2, RefreshCw, Search, X } from "lucide-react";
import { motionTokens } from "../lib/design";
import { formatShort } from "../lib/time";

type Troll = {
  user_id: string;
  name: string;
  reason: string;
  added_at: string;
  added_by: string;
  servers: string[];
};

type Props = { apiUrl: string; notify: (msg: string, type?: string) => void };

/**
 * The troll list — read and written through the bot's API, so it's the same
 * list the bot enforces from rather than a local copy.
 */
export default function TrollsScreen({ apiUrl, notify }: Props) {
  const [trolls, setTrolls] = useState<Troll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");
  const [newReason, setNewReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState<
    { user_id: string; removed_at: string; removed_by: string; reason_given: string }[]
  >([]);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl + "/api/trolls");
      if (!res.ok) throw new Error("bad status");
      const data = await res.json().catch(() => ({}));
      setTrolls(Array.isArray(data) ? data : data.trolls || []);
      setHistory(Array.isArray(data.removal_history) ? data.removal_history : []);
      setError("");
    } catch {
      setError(
        "Couldn't load the troll list. This needs the /api/trolls endpoint on Babblebot — the bot may also be offline."
      );
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    const id = newId.trim();
    if (!/^\d{5,25}$/.test(id)) {
      notify("That doesn't look like a Discord user ID", "error");
      return;
    }
    if (newReason.trim().length < 3) {
      notify("A reason is required — it's what makes the entry auditable", "error");
      return;
    }
    setBusy("add");
    try {
      const res = await fetch(apiUrl + "/api/trolls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: id, reason: newReason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        notify(`${data.name || id} added to the troll list`, "success");
        setNewId("");
        setNewReason("");
        setAdding(false);
        load();
      } else if (res.status === 404) {
        notify("The bot doesn't have /api/trolls yet — pull and restart Babblebot", "error");
      } else {
        notify(data.error || `Couldn't add that user (HTTP ${res.status})`, "error");
      }
    } catch (e: any) {
      notify(`Can't reach the bot at ${apiUrl} — ${e?.message || "network error"}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (t: Troll) => {
    setBusy(t.user_id);
    try {
      const res = await fetch(apiUrl + "/api/trolls/" + encodeURIComponent(t.user_id), {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        notify(`${t.name || t.user_id} removed`, "success");
        setTrolls((prev) => prev.filter((x) => x.user_id !== t.user_id));
      } else if (res.status === 404) {
        notify("The bot doesn't have /api/trolls yet — pull and restart Babblebot", "error");
      } else {
        notify(data.error || `Couldn't remove that user (HTTP ${res.status})`, "error");
      }
    } catch (e: any) {
      notify(`Can't reach the bot at ${apiUrl} — ${e?.message || "network error"}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? trolls.filter(
        (t) =>
          t.user_id.includes(q) ||
          (t.name || "").toLowerCase().includes(q) ||
          (t.reason || "").toLowerCase().includes(q)
      )
    : trolls;

  const field =
    "w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition";

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Troll list</h2>
          <p className="text-sm text-slate-400 mt-1">
            Enforced by the bot on every join and in its 15-minute sweep.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, ID or reason"
              aria-label="Search troll list"
              className="pl-9 pr-3 py-2 w-56 rounded-lg bg-slate-800/60 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition"
            />
          </div>
          <button
            onClick={load}
            aria-label="Refresh troll list"
            className="p-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className={
              "px-3 py-2 rounded-lg text-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 " +
              (showHistory
                ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-200"
                : "bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-700/50")
            }
           data-tip="Show or hide the join history">
            History{history.length ? ` (${history.length})` : ""}
          </button>
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
           data-tip="Add someone to the troll list">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      {adding && (
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">Add a user</h3>
            <button
              onClick={() => setAdding(false)}
              aria-label="Close add form"
              className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="troll-id" className="block text-sm font-medium text-slate-300 mb-2">
                Discord user ID
              </label>
              <input
                id="troll-id"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="Right-click a user → Copy ID"
                spellCheck={false}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="troll-reason" className="block text-sm font-medium text-slate-300 mb-2">
                Reason
              </label>
              <input
                id="troll-reason"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder="Why they're on the list — required"
                className={field}
              />
            </div>
          </div>
          <button
            onClick={add}
            disabled={busy !== null || !newId.trim() || newReason.trim().length < 3}
            className="mt-4 px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-indigo-500 to-violet-600 font-semibold hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-40 transition"
          >
            {busy === "add" ? "Adding…" : "Add to list"}
          </button>
        </div>
      )}

      {showHistory && (
        <div className="glass rounded-2xl p-5">
          <h3 className="font-medium mb-3">Removed from the list</h3>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">Nobody has been removed yet.</p>
          ) : (
            <div className="space-y-2">
              {history.slice().reverse().map((h, i) => (
                <div
                  key={`${h.user_id}-${i}`}
                  className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-mono truncate">{h.user_id}</p>
                    {h.reason_given && (
                      <p className="text-xs text-slate-500 truncate">had: {h.reason_given}</p>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 shrink-0">
                    {formatShort(h.removed_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl p-4 bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="glass rounded-2xl p-10 text-center border border-dashed border-slate-700">
          <ShieldAlert className="w-8 h-8 mx-auto text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">
            {trolls.length === 0 ? "The troll list is empty." : "No matches for that search."}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((t) => (
          <div
            key={t.user_id}
            className="glass rounded-xl p-4 flex items-center gap-4"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{t.name || "Unknown user"}</p>
              <p className="text-xs text-slate-500 font-mono truncate">{t.user_id}</p>
              {t.reason ? (
                <p className="text-sm text-slate-400 mt-1.5 max-w-[65ch]">{t.reason}</p>
              ) : (
                <button
                  onClick={() => {
                    const reason = window.prompt(
                      `Why is ${t.name || t.user_id} on the troll list?`,
                      ""
                    );
                    if (reason && reason.trim().length >= 3) {
                      fetch(apiUrl + "/api/trolls/" + encodeURIComponent(t.user_id) + "/reason", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ reason: reason.trim() }),
                      })
                        .then(async (r) => {
                          const d = await r.json().catch(() => ({}));
                          if (r.ok && d.success) {
                            notify("Reason saved", "success");
                            load();
                          } else {
                            notify(d.error || "Couldn't save that reason", "error");
                          }
                        })
                        .catch(() => notify("Connection failed", "error"));
                    }
                  }}
                  className="mt-1.5 text-xs px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 transition-colors"
                >
                  No reason recorded — add one
                </button>
              )}
              <p className="text-xs text-slate-600 mt-1">
                {t.servers?.length ? t.servers.join(", ") : "no recorded servers"}
                {t.added_at ? ` · added ${t.added_at.slice(0, 10)}` : ""}
              </p>
            </div>
            <button
              onClick={() => remove(t)}
              disabled={busy !== null}
              aria-label={`Remove ${t.name || t.user_id} from the troll list`}
              className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 disabled:opacity-40 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </motion.section>
  );
}
