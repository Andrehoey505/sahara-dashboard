import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, Check, X, RefreshCw, UserX, Clock } from "lucide-react";
import { motionTokens } from "../lib/design";

type HitlRequest = {
  id: string;
  member_id: string;
  member_name: string;
  guild_id: string;
  guild_name: string;
  reason: string;
  suggested_action: string;
  evidence?: string;
  timestamp?: string;
  /** "pending" or "expired" — expired stays answerable, but acting is refused. */
  status?: string;
  expires_at?: string;
  expired_at?: string;
};

type Troll = { id?: string; user_id?: string; name?: string; reason?: string };

type Props = { apiUrl: string; notify: (msg: string, type?: string) => void };

/**
 * Human-in-the-loop troll watching. The bot enqueues suspicious joins and
 * waits for a decision; this screen is where that decision is made.
 */
export default function TrollWatch({ apiUrl, notify }: Props) {
  const [pending, setPending] = useState<HitlRequest[]>([]);
  const [trolls, setTrolls] = useState<Troll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl + "/api/troll-watch");
      if (!res.ok) throw new Error("bad status");
      const data = await res.json().catch(() => ({}));
      setPending(data.pending || []);
      setTrolls(data.trolls || []);
      setError("");
    } catch {
      setError("Couldn't reach the bot API — is the Windows laptop awake?");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const respond = async (req: HitlRequest, action: string) => {
    setBusy(req.id);
    try {
      const res = await fetch(apiUrl + "/api/troll-watch/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: req.id, action }),
      });
      // A 500 or a proxy error page is not JSON, so .json() threw and the
      // catch below reported "connection failed" — wrong, and it hid what the
      // bot actually said.
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.error) {
        data.error = `The bot rejected that (HTTP ${res.status}).`;
      }

      // The bot used to leave the request sitting in the pending list after it
      // was answered, so the card stayed put and the button looked broken.
      // Drop it locally whatever the answer, then re-read the server.
      if (data.success) {
        setPending((p) => p.filter((x) => x.id !== req.id));
        notify(
          data.expired
            ? data.message || "Expired — not carried out, review manually"
            : data.already
            ? `Already queued: ${data.queued}`
            : action === "dismiss"
            ? "Dismissed"
            : `Queued: ${data.queued}`,
          data.expired ? "error" : "success"
        );
      } else {
        notify(data.error || "Couldn't send that decision", "error");
      }
    } catch {
      notify("Connection failed — is the bot reachable?", "error");
    } finally {
      setBusy(null);
      load();
    }
  };

  const btn =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40";

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Troll watch</h2>
          <p className="text-sm text-slate-400 mt-1">
            Suspicious joins wait here for a decision before anything happens.
          </p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh troll watch"
          className="p-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="rounded-xl p-4 bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-3">
          Awaiting decision {!loading && `(${pending.length})`}
        </h3>

        {!loading && !error && pending.length === 0 && (
          <div className="glass rounded-2xl p-10 text-center border border-dashed border-slate-700">
            <ShieldAlert className="w-8 h-8 mx-auto text-slate-600 mb-3" />
            <p className="text-sm text-slate-400">Nothing waiting. Quiet on the troll front.</p>
          </div>
        )}

        <div className="space-y-3">
          {pending.map((req) => {
            const expired = req.status === "expired";
            return (
            <div
              key={req.id}
              className={
                "glass rounded-2xl p-5 " +
                (expired ? "border border-slate-600/60 opacity-80" : "")
              }
            >
              {expired && (
                <div className="flex items-start gap-2 rounded-xl bg-slate-700/30 border border-slate-600/50 p-3 mb-4">
                  <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-300">
                    Expired unreviewed — this alert is stale, so the action won't be carried
                    out automatically. Answering it records your decision and asks you to
                    review the account fresh.
                  </p>
                </div>
              )}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium truncate">{req.member_name}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {req.guild_name} · ID {req.member_id}
                  </p>
                  <p className="text-sm text-slate-300 mt-3 max-w-[65ch]">{req.reason}</p>
                  {req.evidence && (
                    <p className="text-xs text-slate-500 mt-2 max-w-[65ch] break-words">
                      {req.evidence}
                    </p>
                  )}
                </div>
                <span
                  className={
                    "shrink-0 text-xs px-2 py-1 rounded border " +
                    (expired
                      ? "bg-slate-600/20 text-slate-300 border-slate-600/50"
                      : "bg-amber-500/15 text-amber-300 border-amber-500/30")
                  }
                >
                  {expired ? "expired" : `suggests ${req.suggested_action}`}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  onClick={() => respond(req, "approve")}
                  disabled={busy === req.id}
                  title={
                    expired
                      ? "The action won't be carried out — answering records your decision and asks for a fresh review"
                      : undefined
                  }
                  className={btn + " bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"}
                >
                  <Check className="w-3.5 h-3.5" />
                  {busy === req.id
                    ? "Sending…"
                    : expired
                    ? `Record ${req.suggested_action} decision`
                    : `Approve ${req.suggested_action}`}
                </button>
                <button
                  onClick={() => respond(req, "dismiss")}
                  disabled={busy === req.id}
                  className={btn + " bg-slate-700/50 text-slate-300 hover:bg-slate-600/60"}
                >
                  <X className="w-3.5 h-3.5" /> Dismiss
                </button>
                <button
                  onClick={() => respond(req, "ban")}
                  disabled={busy === req.id}
                  className={btn + " bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"}
                >
                  <UserX className="w-3.5 h-3.5" /> Ban instead
                </button>
              </div>
            </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-3">
          Known trolls {!loading && `(${trolls.length})`}
        </h3>
        {trolls.length === 0 ? (
          <p className="text-sm text-slate-500">No known trolls on the list.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {trolls.slice(0, 100).map((t, i) => (
              <span
                key={(t.id || t.user_id || String(i)) + i}
                className="text-xs px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300"
                title={t.reason || undefined}
              >
                {t.name || t.user_id || t.id || "unknown"}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.section>
  );
}
