import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  HardDrive,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Trash2,
  Eye,
  Info,
  FolderOpen,
  Clock,
  ShieldCheck,
  X,
} from "lucide-react";
import { motionTokens } from "../lib/design";
import { botFetch } from "../lib/bot";

/**
 * What the bot is keeping on its disk, and what it should stop keeping.
 *
 * The laptop that runs Babblebot has a small disk, and a moderation bot that
 * stores every image it ever looked at will fill it. That is not a hypothetical:
 * it is the reason this screen exists. But the obvious fix — delete everything
 * old — assumes the files are all the same, and they are not.
 *
 * Three tiers, and the top one does not appear here at all:
 *
 *   always-kept   Records a decision depends on. Deleting one breaks a pending
 *                 violation, so it is not offered and never totals up into a
 *                 "safe to free" number. It is not counted as reclaimable space,
 *                 because it is not space you can have back.
 *   flagged       Attachments worth a look before they go: the thing a violation
 *                 card points at. Deletable, one at a time, with a thumbnail on
 *                 the confirm — deletion is the last chance to see it.
 *   expired       Past the retention window and not attached to anything open.
 *                 Deletable in bulk; this is where the space actually is.
 *
 * Nothing here deletes on its own. The bot's standing rule is that a human
 * decides, and a cleanup button is still a button a human presses.
 */

/**
 * The bot's own four tiers, in its words.
 *
 * This screen used to speak in two names -- "flagged" and "expired" -- that the
 * bot does not use, so its answer was read as a guess: an unrecognised tier fell
 * through to `expired`, which is the tier with the bulk delete button on it.
 * That is a screen offering to delete something it does not understand.
 *
 * `attached` is the important one. It is what a violation card points at: the
 * picture a decision depends on. The bot never offers it for deletion and neither
 * does this screen, because deleting it is how a pending violation loses its
 * evidence.
 */
type Tier = "attached" | "always-kept" | "flagged" | "expired";

/** Anything the bot says that this screen does not know is treated as kept. */
const KNOWN_TIERS: Tier[] = ["attached", "always-kept", "flagged", "expired"];

type Item = {
  /** What to send back to the API when this one is deleted. */
  id: string;
  /** File name, or the record it belongs to when there is no single file. */
  name: string;
  tier: Tier;
  bytes: number;
  /** ISO timestamp of the oldest thing in the group, for the "how old" column. */
  oldest?: string;
  /** How many files this row stands for — 1 for a single attachment. */
  count?: number;
  /** Only present on flagged items: what this would break if it went. */
  protected?: boolean;
  /** A thumbnail URL the bot can serve while the bytes still exist. */
  thumb_url?: string;
  /** Why it is held, in the bot's words. */
  note?: string;
};

type Summary = {
  total_bytes: number;
  by_tier?: Record<string, number>;
  counts?: Record<string, number>;
  root?: string;
  retention_days?: number;
};

type Props = {
  apiUrl: string;
  notify: (msg: string, type?: string) => void;
};

const TIER_ORDER: Tier[] = ["attached", "flagged", "expired", "always-kept"];

const TIER_META: Record<
  Tier,
  { label: string; blurb: string; tone: string; canDelete: boolean }
> = {
  attached: {
    label: "Evidence — kept",
    blurb:
      "Attachments a violation card points at. They are what a decision rests on, so they are never deleted from here.",
    tone: "text-rose-300",
    canDelete: false,
  },
  flagged: {
    label: "Waiting for you",
    blurb:
      "Attachments a violation card points at. Deleting one is the last chance to look at it, so the confirm shows the picture first.",
    tone: "text-amber-300",
    canDelete: true,
  },
  expired: {
    label: "Past the retention window",
    blurb:
      "Older than the retention period and attached to nothing open. This is where the space actually is.",
    tone: "text-sky-300",
    canDelete: true,
  },
  "always-kept": {
    label: "Kept — not offered",
    blurb:
      "Records a decision depends on. They cannot be deleted from here, because deleting one would break a pending violation.",
    tone: "text-slate-400",
    canDelete: false,
  },
};

function bytes(n: number) {
  if (!n || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function age(iso?: string) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

export default function StorageScreen({ apiUrl, notify }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** Not built yet on the bot side — said plainly rather than as a blank screen. */
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string>("");
  const [confirming, setConfirming] = useState<Item | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setMissing(false);
    try {
      const res = await botFetch(apiUrl + "/api/storage");
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setMissing(true);
        setSummary(null);
        setItems([]);
        return;
      }
      if (!res.ok || data.error) {
        setError(data.error || `The bot answered ${res.status}`);
        return;
      }
      setSummary({
        total_bytes: Number(data.total_bytes) || 0,
        by_tier: data.by_tier || {},
        counts: data.counts || {},
        root: data.root,
        retention_days: data.retention_days,
      });
      const list: Item[] = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.files)
        ? data.files
        : [];
      setItems(
        list.map((raw: any, i: number) => ({
          id: String(raw.id ?? raw.path ?? raw.name ?? i),
          name: String(raw.name ?? raw.path ?? "(unnamed)"),
          // Unknown means kept. The old fallback was `expired`, which put
          // anything the bot had not named in front of the bulk delete button.
          tier: (KNOWN_TIERS.includes(raw.tier) ? raw.tier : "always-kept") as Tier,
          bytes: Number(raw.bytes ?? raw.size) || 0,
          oldest: raw.oldest || raw.created_at || raw.mtime,
          count: raw.count,
          protected: !!raw.protected,
          thumb_url: raw.thumb_url,
          note: raw.note,
        })),
      );
    } catch {
      setError("Could not reach the bot — is it running?");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const out: Record<Tier, Item[]> = {
      attached: [],
      flagged: [],
      expired: [],
      "always-kept": [],
    };
    for (const it of items) out[it.tier].push(it);
    return out;
  }, [items]);

  /** Only what the bot said can go. Not "everything old". */
  const reclaimable = useMemo(
    () =>
      (["flagged", "expired"] as Tier[]).reduce(
        (n, t) => n + groups[t].reduce((s, i) => s + i.bytes, 0),
        0,
      ),
    [groups],
  );

  const remove = async (item: Item) => {
    setBusy(item.id);
    try {
      const res = await botFetch(apiUrl + "/api/storage/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, tier: item.tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        notify(data.error || `That did not delete (${res.status})`, "error");
        return;
      }
      // A delete that silently removed more than asked for is worse than one that
      // failed, so the freed figure comes from the bot and is quoted as given.
      notify(
        data.freed_bytes
          ? `Deleted ${item.name} — ${bytes(Number(data.freed_bytes))} freed.`
          : `Deleted ${item.name}.`,
        "success",
      );
      setConfirming(null);
      await load();
    } catch {
      notify("Connection failed — is the bot running?", "error");
    } finally {
      setBusy("");
    }
  };

  const removeExpired = async () => {
    setBusy("__bulk__");
    try {
      const res = await botFetch(apiUrl + "/api/storage/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Deliberately the tier, not a list of ids: the bot decides what is
        // expired at the moment it acts, so a stale screen cannot order the
        // deletion of something that has since become protected.
        body: JSON.stringify({ tier: "expired" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        notify(data.error || `That did not work (${res.status})`, "error");
        return;
      }
      notify(
        `Deleted ${data.deleted ?? 0} file${data.deleted === 1 ? "" : "s"}, ${bytes(
          Number(data.freed_bytes) || 0,
        )} freed.${data.skipped ? ` ${data.skipped} kept because something still points at them.` : ""}`,
        "success",
      );
      setBulkConfirm(false);
      await load();
    } catch {
      notify("Connection failed — is the bot running?", "error");
    } finally {
      setBusy("");
    }
  };

  if (missing) {
    return (
      <div className="glass rounded-2xl p-5 max-w-xl">
        <div className="flex items-start gap-3">
          <HardDrive className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">Storage isn't available yet</h3>
            <p className="text-sm text-slate-400 mt-1">
              The bot doesn't have the `/api/storage` route yet, so there is nothing to
              show. The screen is built and will fill in the moment it does — it is on
              the list for the bot side.
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

  return (
    <div className="space-y-4 max-w-4xl">
      {/* The headline number, and what it actually means. */}
      <motion.div
        {...{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: motionTokens.enter }}
        className="card p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center shrink-0">
              <HardDrive className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-semibold">
                {loading ? "Reading the disk…" : bytes(summary?.total_bytes || 0)}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {loading
                  ? "Asking the bot what it is holding."
                  : `${bytes(reclaimable)} of that can be freed. The rest is records you need.`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {summary?.root && (
              <span
                className="text-[11px] text-slate-500 flex items-center gap-1.5 max-w-[22rem] truncate"
                data-tip={summary.root}
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{summary.root}</span>
              </span>
            )}
            <button
              onClick={() => void load()}
              disabled={loading}
              className="p-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60 disabled:opacity-40"
              data-tip="Read the disk again"
            >
              <RefreshCw className={"w-4 h-4 " + (loading ? "animate-spin" : "")} />
            </button>
          </div>
        </div>

        {summary?.retention_days ? (
          <p className="mt-3 text-[11px] text-slate-500 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Attachments are kept for {summary.retention_days} days unless a violation still
            points at them.
          </p>
        ) : null}

        {error && (
          <p className="mt-3 text-xs text-rose-300 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {error}
          </p>
        )}
      </motion.div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading the disk…
        </div>
      ) : (
        TIER_ORDER.map((tier) => {
          const meta = TIER_META[tier];
          const list = groups[tier];
          const total = list.reduce((s, i) => s + i.bytes, 0);
          return (
            <motion.div
              key={tier}
              {...{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: motionTokens.enter }}
              className="glass rounded-2xl p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  {tier === "always-kept" ? (
                    <ShieldCheck className={"w-4 h-4 " + meta.tone} />
                  ) : (
                    <HardDrive className={"w-4 h-4 " + meta.tone} />
                  )}
                  <h3 className="font-semibold text-sm">{meta.label}</h3>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800/70 text-slate-400">
                    {list.length} · {bytes(total)}
                  </span>
                </div>
                {meta.canDelete && tier === "expired" && list.length > 0 && (
                  <button
                    onClick={() => setBulkConfirm(true)}
                    disabled={busy === "__bulk__"}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-200 hover:bg-rose-500/25 disabled:opacity-40 flex items-center gap-1.5"
                    data-tip="Delete everything past the retention window that nothing points at"
                  >
                    {busy === "__bulk__" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    Delete all {list.length}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mb-3">{meta.blurb}</p>

              {list.length === 0 ? (
                <p className="text-xs text-slate-600 py-2">
                  {tier === "flagged"
                    ? "Nothing waiting — no attachment is held for review."
                    : "Nothing here."}
                </p>
              ) : (
                <div className="space-y-1">
                  {list.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/40"
                    >
                      <span className="text-xs text-slate-300 truncate flex-1" data-tip={item.name}>
                        {item.name}
                        {item.count && item.count > 1 ? (
                          <span className="text-slate-500"> ×{item.count}</span>
                        ) : null}
                      </span>
                      {item.note && (
                        <span className="text-[10px] text-amber-300/80 shrink-0" data-tip={item.note}>
                          held
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500 shrink-0 w-24 text-right">
                        {age(item.oldest)}
                      </span>
                      <span className="text-[11px] text-slate-400 shrink-0 w-20 text-right">
                        {bytes(item.bytes)}
                      </span>
                      {meta.canDelete ? (
                        <button
                          onClick={() => setConfirming(item)}
                          disabled={busy === item.id}
                          className="p-1.5 rounded text-rose-300/80 hover:bg-rose-500/15 disabled:opacity-40 shrink-0"
                          data-tip={
                            item.thumb_url
                              ? "Look at it, then decide — deleting is the last chance to see it"
                              : "Delete this and free its space"
                          }
                        >
                          {busy === item.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : item.thumb_url ? (
                            <Eye className="w-3.5 h-3.5" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="w-6 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })
      )}

      {/* Single-item confirm, with the picture when there is one. */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="glass rounded-2xl p-5 max-w-md w-full">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="font-semibold text-sm">Delete this file?</h3>
              <button
                onClick={() => setConfirming(null)}
                className="p-1 rounded text-slate-400 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {confirming.thumb_url && (
              <img
                src={confirming.thumb_url}
                alt="The attachment about to be deleted"
                className="w-full rounded-lg mb-3 bg-slate-900"
                style={{ maxHeight: 260, objectFit: "contain" }}
              />
            )}
            <p className="text-xs text-slate-400">
              <span className="text-slate-200">{confirming.name}</span> — {bytes(confirming.bytes)}
              {confirming.oldest ? `, ${age(confirming.oldest)}` : ""}.
            </p>
            <p className="text-xs text-amber-200/90 mt-2 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {confirming.thumb_url
                ? "This is the last chance to see it. Once it is gone, the violation record still exists but the picture does not."
                : "The record stays; only the stored file goes."}
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => void remove(confirming)}
                disabled={busy === confirming.id}
                className="flex-1 px-3 py-2 rounded-lg bg-rose-500/20 border border-rose-500/40 text-sm text-rose-200 hover:bg-rose-500/30 disabled:opacity-40"
              >
                {busy === confirming.id ? "Deleting…" : "Delete it"}
              </button>
              <button
                onClick={() => setConfirming(null)}
                className="px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700 text-sm text-slate-300 hover:bg-slate-700/60"
              >
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="glass rounded-2xl p-5 max-w-md w-full">
            <h3 className="font-semibold text-sm">Delete everything past retention?</h3>
            <p className="text-xs text-slate-400 mt-2">
              {groups.expired.length} file{groups.expired.length === 1 ? "" : "s"}, about{" "}
              {bytes(groups.expired.reduce((s, i) => s + i.bytes, 0))}. The bot checks each one
              as it goes and skips anything a violation still points at, so nothing pending
              breaks.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => void removeExpired()}
                disabled={busy === "__bulk__"}
                className="flex-1 px-3 py-2 rounded-lg bg-rose-500/20 border border-rose-500/40 text-sm text-rose-200 hover:bg-rose-500/30 disabled:opacity-40"
              >
                {busy === "__bulk__" ? "Deleting…" : "Delete them"}
              </button>
              <button
                onClick={() => setBulkConfirm(false)}
                className="px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700 text-sm text-slate-300 hover:bg-slate-700/60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
