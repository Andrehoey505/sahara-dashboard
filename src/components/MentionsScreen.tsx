import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, MessageCircle, Trash2, RefreshCw } from "lucide-react";
import { motionTokens } from "../lib/design";
import { formatDateTime } from "../lib/time";

export type Mention = {
  timestamp: string;
  author_name: string;
  author_id?: string;
  text: string;
  channel_name: string;
  guild_name?: string;
  jump_url?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  apiUrl: string;
  /** Say something through the relay — the message waits for approval before posting. */
  notify?: (msg: any, type?: string) => void;
  /** Inline: rendered as a page rather than a popup. Same list, same buttons. */
  inline?: boolean;
};

/**
 * Everything anyone said to him while he was asleep.
 *
 * The morning card is a notification, not a place: dismiss it and the mentions only
 * existed in the database. This is the place — same words, but they stay until he
 * clears them, with a link to each message so he can answer it where it was asked.
 *
 * It works two ways from the same code: a popup from the sleep card, and a page of its
 * own in the nav. A second copy of this list would be a second place to fix.
 */
export default function MentionsScreen({ open, onClose, apiUrl, notify, inline = false }: Props) {
  const [mentions, setMentions] = useState<Mention[] | null>(null);
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState("");

  const base = apiUrl.replace(/\/$/, "");

  const load = React.useCallback(() => {
    setError("");
    fetch(base + "/api/mentions")
      .then((r) => r.json())
      .then((d) => setMentions(Array.isArray(d?.mentions) ? d.mentions : []))
      .catch(() => setError("Couldn't reach Babblebot for the list."));
  }, [base]);

  useEffect(() => {
    if (!open && !inline) return;
    setMentions(null);
    load();
  }, [open, inline, load]);

  const clearAll = () => {
    setClearing(true);
    // "until" the newest one on screen: anything that arrived while he was reading stays
    // for next time instead of being swept away unseen.
    const until = mentions && mentions.length
      ? mentions.reduce((a, m) => (m.timestamp > a ? m.timestamp : a), mentions[0].timestamp)
      : "";
    fetch(base + "/api/mentions/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ until }),
    })
      .then((r) => r.json())
      .then(() => setMentions([]))
      .catch(() => setError("Couldn't clear the list — nothing was removed."))
      .finally(() => setClearing(false));
  };

  const sendDraft = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError("");
    setSent("");
    fetch(base + "/api/relay/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }))
      .then(({ ok, status, data }) => {
        if (!ok) {
          // 403 is the switch, and the switch's own words are better than mine.
          setSendError(
            status === 403
              ? data?.error || "The Texan relay is switched off."
              : data?.error || `Couldn't queue that (${status}).`,
          );
          return;
        }
        setDraft("");
        setSent("Queued — it's waiting for your yes in Texan Relay.");
        notify?.("Queued for approval", "success");
      })
      .catch(() => setSendError("Couldn't reach Babblebot — nothing was queued."))
      .finally(() => setSending(false));
  };

  if (!open && !inline) return null;

  const body = (
    <>
      <div className={inline ? "" : "p-6 pb-3 shrink-0"}>
        {!inline && (
          <button
            onClick={onClose}
            aria-label="Close the mentions list"
            className="absolute top-3 right-3 p-2 rounded-lg bg-slate-950/60 text-slate-300 hover:text-white hover:bg-slate-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
            data-tip="Close">
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-indigo-300" />
          <h3 id="mentions-title" className="font-semibold text-lg">
            While you were asleep
          </h3>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <p className="text-xs text-slate-400">
            {mentions === null ? "Loading…" : `${mentions.length} waiting`}
          </p>
          <button
            onClick={load}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 rounded transition-colors"
            data-tip="Check again">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          {!!(mentions && mentions.length) && (
            <button
              onClick={clearAll}
              disabled={clearing}
              className="text-xs text-rose-300 hover:text-rose-200 flex items-center gap-1 ml-auto disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 rounded transition-colors"
              data-tip="Clear the list — the messages stay in Discord">
              <Trash2 className="w-3 h-3" /> {clearing ? "Clearing…" : "Clear all"}
            </button>
          )}
        </div>
      </div>


        <div className="mt-4 rounded-xl bg-slate-950/40 p-3 border border-slate-800/60">
          <p className="text-xs text-slate-400 mb-2">
            Say something to a server. It waits in Texan Relay until you approve it — nothing
            posts on its own.
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={1900}
            placeholder="Type the message…"
            className="w-full rounded-lg bg-slate-900/70 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 resize-y"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={sendDraft}
              disabled={!draft.trim() || sending}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 text-sm font-semibold hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition"
              data-tip="Queue it for your approval">
              {sending ? "Queuing…" : "Queue it"}
            </button>
            <span className="text-[11px] text-slate-500">{draft.length}/1900</span>
            {sent && <span className="text-[11px] text-emerald-300">{sent}</span>}
            {sendError && <span className="text-[11px] text-rose-300">{sendError}</span>}
          </div>
        </div>

      <div className={inline ? "mt-3" : "px-6 pb-6 overflow-y-auto"}>
        {error && <p className="text-sm text-rose-300">{error}</p>}

        {!error && mentions !== null && mentions.length === 0 && (
          <p className="text-sm text-slate-400">
            Nobody's asked for you. Anything that arrives while you're asleep lands here.
          </p>
        )}

        <ul className="space-y-2">
          {(mentions || []).map((m, i) => (
            <li key={i} className="rounded-xl bg-slate-950/40 px-3 py-2.5 border border-slate-800/60">
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="font-medium text-slate-300">{m.author_name}</span>
                {m.channel_name && <span>· #{m.channel_name}</span>}
                <span>· {formatDateTime(m.timestamp)}</span>
              </div>
              <p className="text-[13px] text-slate-200 mt-1 whitespace-pre-wrap break-words">
                {m.text || "(no text)"}
              </p>
              {m.jump_url && (
                <a
                  href={m.jump_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-indigo-300 hover:text-indigo-200 mt-1 inline-block">
                  Answer it in Discord →
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );

  if (inline) {
    return (
      <div className="glass rounded-2xl p-6 max-w-3xl">
        {body}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mentions-title">
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={motionTokens.enter}
        onClick={(e) => e.stopPropagation()}
        className="glass rounded-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col relative">
        {body}
      </motion.div>
    </div>
  );
}
