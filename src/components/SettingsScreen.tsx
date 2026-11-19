import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Server,
  Volume2,
  Settings2,
  RefreshCw,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Palette,
  Bell,
  Activity,
  ExternalLink,
  WifiOff,
  KeyRound,
  ChevronDown,
  ChevronRight,
  Radar,
  FlaskConical,
} from "lucide-react";
import { motionTokens } from "../lib/design";
import { looksLikeTailscale, networkState, type OfflineState, type ConnectionState } from "../lib/connection";
import {
  pingBot,
  liteTokenStore,
  liteTokenStatus,
  liteTokenClear,
  liteTokenSync,
  liteRulesSync,
  liteSyncState,
  liteRulesSummary,
  liteLiveState,
  liteTextCheck,
  liteDbSnapshot,
  liteDbStatus,
  liteTickets,
  liteTicketsMarkTransferred,
  liteMergeReconcile,
  type LiteTicket,
} from "../lib/bot";
import { trace, traceRead, traceWatch, traceClear, type TraceEvent } from "../lib/trace";
import type { AppSettings } from "./SetupScreen";

  /**
 * Refresh Lite's flag system from Windows.
 *
 * Shown in Settings, not in the outage screen, on purpose: the moment to press
 * this is while Windows is HEALTHY. Once the power is out there is nothing left to
 * sync from, and Lite is running on whatever snapshot it had. The age of that
 * snapshot is the number that matters, so it is the number shown.
 */
function LiteRulesPanel({ apiUrl, fallbackUrl }: { apiUrl: string; fallbackUrl?: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [syncedAt, setSyncedAt] = useState<string>("");
  const [auto, setAuto] = useState<{ last_sync?: number; last_error?: string; interval_seconds?: number }>({});
  const [rules, setRules] = useState<Awaited<ReturnType<typeof liteRulesSummary>>>({});

  // Read the background timer's state so "last synced" is a fact, not a hope.
  useEffect(() => {
    let alive = true;
    const ask = async () => {
      const st = await liteSyncState();
      if (alive) setAuto(st);
      const rs = await liteRulesSummary();
      if (alive) setRules(rs);
    };
    void ask();
    const t = setInterval(ask, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const run = async () => {
    setBusy(true);
    setResult("");
    const r = await liteRulesSync(apiUrl, fallbackUrl);
    setBusy(false);
    if (r.ok) {
      setSyncedAt(new Date().toLocaleString());
      // A count of zero is not a success worth reporting as one. If Windows has
      // nothing stored, say that; if Lite could not read something it should have,
      // say that too. The two look identical in a number and mean opposite things.
      const warnings: string[] = (r as any).warnings || [];
      setResult(
        ((r as any).source === "live"
          ? `Read live from ${r.served_by}. `
          : `Synced ${Math.round((r.bytes || 0) / 1024 / 1024)} MB from ${r.served_by}. `) +
          `${r.loaded?.servers ?? 0} servers, ${r.loaded?.channel_rules ?? 0} channel rules, ` +
          `${r.loaded?.ticket_types ?? 0} ticket types.` +
          (warnings.length ? `\n\n${warnings.join("\n")}` : "") +
          // Which address served it, and why the others did not -- but only the
          // ones that were actually tried. The sync follows the app's live
          // connection now, so an address the app already knows is dead is not
          // attempted and must not be reported as a failure. A red line beside a
          // successful sync reads as "something is wrong" when nothing is.
          ((r as any).addresses || [])
            .filter(([u]: [string, string]) => !String(r.served_by || "").startsWith(u))
            .map(([u, why]: [string, string]) => `\n${u}: ${why}`)
            .join("")
      );
    } else {
      setResult(`Could not sync: ${r.error || "no reason given"}`);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-slate-700 bg-slate-800/40 p-3">
      <p className="text-sm font-semibold text-slate-200">Lite&apos;s flag system</p>
      <p className="text-xs text-slate-400 mt-1">
        Lite uses a copy of the Windows rules taken at handover. Press this while Windows is
        healthy so a stale copy can&apos;t flag messages Windows would have left alone.
      </p>
      <button
        onClick={() => void run()}
        disabled={busy}
        className="mt-2 px-3 py-1.5 rounded-lg bg-emerald-600/80 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
      >
        {busy ? "Syncing…" : "Sync flag system from Windows"}
      </button>
      {syncedAt && <p className="text-xs text-slate-500 mt-1">Last manual sync: {syncedAt}</p>}
      <p className="text-xs mt-1">
        {auto.last_sync ? (
          <span className="text-slate-400">
            Background refresh: every {Math.round((auto.interval_seconds || 1200) / 60)} min, last
            worked {new Date(auto.last_sync).toLocaleTimeString()}
          </span>
        ) : (
          <span className="text-slate-500">Background refresh: waiting for its first run</span>
        )}
        {auto.last_error && (
          <span className="text-amber-300/90"> — last attempt failed: {auto.last_error}</span>
        )}
      </p>
      {/*
        A last-sync time that came off the disk is this run's memory being empty,
        not a fresh refresh. Saying "worked 3 minutes ago" over a copy taken
        yesterday is the one way this panel could be confidently wrong.
      */}
      {(auto as { from_disk?: boolean }).from_disk && (
        <p className="text-xs text-slate-500 mt-1">
          That time is from the saved copy, not a refresh this session — Lite has not reached
          Windows since it started.
        </p>
      )}
      {rules.channel_rules !== undefined && (
        <p className="text-xs text-slate-500 mt-1">
          Lite is enforcing: {rules.servers ?? 0} servers, {rules.channel_rules ?? 0} channel rules
          {rules.by_preset
            ? ` (${Object.entries(rules.by_preset)
                .map(([k, v]) => `${v} ${k}`)
                .join(", ")})`
            : ""}
          , {rules.ticket_types ?? 0} ticket types, profanity threshold{" "}
          {rules.profanity_threshold ?? 2}
          {rules.helpline ? ", helpline protected" : ""}.
        </p>
      )}
      {result && (
        <p className={`text-xs mt-1 ${result.startsWith("Could not") ? "text-red-300" : "text-emerald-300"}`}>
          <span className="whitespace-pre-line">{result}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Prove the checker works without waiting for a real breach.
 *
 * Lite enforces a ported copy of the Windows rules. The one thing nobody could
 * show before now is that the copy actually behaves -- the only evidence was a
 * real message getting flagged, which means a real member had to be the test.
 * This runs the SAME `judge` the live path runs, over lines typed here.
 *
 * A clean answer is only worth something if the checker can also say no, so the
 * examples include one that should pass untouched: a bot that flags "my throat is
 * sore" is not protecting anyone.
 */
function CheckerProbe() {
  const SAMPLES: { label: string; text: string }[] = [
    { label: "Someone shouting", text: "THIS IS THE WORST THING I HAVE EVER SEEN" },
    { label: "Repeated invite", text: "join discord.gg/example discord.gg/example discord.gg/example" },
    { label: "Harmless (should pass)", text: "my throat is sore and I am going to bed" },
  ];
  const [text, setText] = useState(SAMPLES[0].text);
  const [result, setResult] = useState<{ breach: string | null; checked: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const run = async () => {
    setBusy(true);
    setResult(null);
    const r = await liteTextCheck(text);
    // null means the Rust side isn't there at all. Saying "clean" over that would
    // be the exact lie this panel exists to avoid.
    setUnavailable(r === null);
    setResult(r);
    setBusy(false);
  };

  return (
    <Card icon={FlaskConical} title="Test the checker">
      <p className="text-xs text-slate-400">
        Runs the same rule engine Lite uses, over one line of text. Worth pressing once after an
        update to prove the ported copy behaves the way Windows does.
      </p>
      <div className="flex flex-wrap gap-1 mt-2">
        {SAMPLES.map((smp) => (
          <button
            key={smp.label}
            onClick={() => {
              setText(smp.text);
              setResult(null);
            }}
            className="px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-700 text-[11px] text-slate-300 hover:border-indigo-500"
          >
            {smp.label}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
        rows={2}
        className="mt-2 w-full rounded-lg bg-slate-800/60 border border-slate-700 px-2 py-1.5 text-[12px] focus:outline-none focus:border-indigo-500"
      />
      <button
        onClick={() => void run()}
        disabled={busy || !text.trim()}
        className="mt-2 px-3 py-1.5 rounded-lg bg-indigo-600/80 text-xs text-white hover:bg-indigo-600 disabled:opacity-50"
      >
        {busy ? "Checking…" : "Run it"}
      </button>
      {unavailable && (
        <p className="text-xs text-amber-300/90 mt-2">
          The app&apos;s own side isn&apos;t answering, so nothing was checked. That is not a clean
          result.
        </p>
      )}
      {result && !unavailable && (
        <p className={`text-xs mt-2 ${result.breach ? "text-amber-300" : "text-emerald-300"}`}>
          {result.breach
            ? `Would flag: ${result.breach}`
            : `Nothing flagged — ${result.checked} character(s) checked, no rule matched.`}
        </p>
      )}
    </Card>
  );
}

/**
 * Lite's own view: who it is logged in as and what it is watching.
 *
 * Separate from anything read over HTTP on purpose. If this answers and the
 * connection log does not, the socket is what is broken, not the app.
 */
function LiteLivePanel() {
  const [live, setLive] = useState<Awaited<ReturnType<typeof liteLiveState>>>(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await liteLiveState();
      if (!alive) return;
      setLive(r);
      setAsked(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card icon={Activity} title="What Lite is connected as">
      {!asked ? (
        <p className="text-xs text-slate-500">Reading…</p>
      ) : !live ? (
        <p className="text-xs text-slate-500">
          The app&apos;s own side isn&apos;t answering, so this is unknown rather than empty.
        </p>
      ) : (
        <div className="text-xs text-slate-400 space-y-1">
          <p>
            <span className={live.connected ? "text-emerald-300" : "text-amber-300"}>
              {live.connected ? "Discord socket is up" : "Discord socket is down"}
            </span>
            {live.bot ? ` as ${live.bot}` : ""}
          </p>
          <p>
            Watching {live.guilds?.length ?? 0} server(s)
            {live.guilds?.length ? `: ${live.guilds.join(", ")}` : ""}
          </p>
          <p>{live.seen ?? 0} message(s) seen this run.</p>
        </div>
      )}
    </Card>
  );
}

function TracePanel() {
    const [events, setEvents] = useState<TraceEvent[]>(() => traceRead());
    useEffect(() => traceWatch(setEvents), []);
    return (
      <Card
        icon={Activity}
        title="Connection log"
        data-tip="What the app actually did"
        blurb="Which address it tried, what answered, and what was saved"
        tone="text-slate-300"
      >
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing recorded yet in this session. Press Test above, or restart the app.
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-auto rounded-xl bg-slate-950/50 border border-slate-800 p-3">
            {events
              .slice()
              .reverse()
              .map((e, i) => (
                <p
                  key={i}
                  className={
                    "text-xs font-mono break-words " +
                    (e.kind === "error"
                      ? "text-rose-300"
                      : e.kind === "chosen"
                        ? "text-emerald-300"
                        : e.kind === "saved"
                          ? "text-indigo-300"
                          : "text-slate-400")
                  }
                >
                  <span className="text-slate-600">{e.at} </span>
                  {e.line}
                </p>
              ))}
          </div>
        )}
        <button
          onClick={() => traceClear()}
          className="mt-2 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700/60"
        >
          Clear
        </button>
      </Card>
    );
  }


/**
 * Settings.
 *
 * The setup wizard is for the first run; this is the screen you come back to.
 * Everything that can be changed lives here grouped by what it affects, rather
 * than behind a five-step pager.
 *
 * The update check is deliberately near the top and always visible: it is the
 * one thing you reach for when something feels stale, and it used to be buried
 * three steps into the wizard.
 */

type Props = {
  settings: AppSettings;
  onSaveSettings: (s: AppSettings) => void;
  apiUrl: string;
  onSaveApiUrl: (url: string) => void;
  theme: string;
  onSaveTheme: (t: string) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  ttsEnabled: boolean;
  onToggleTts: () => void;
  onOpenSetup: () => void;
  /** Which road the app is on right now, for the connection card's one-liner. */
  conn?: ConnectionState | null;
};

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "none" }
  | { status: "found"; version: string }
  | { status: "downloading"; version: string; pct: number | null }
  | { status: "installed"; version: string }
  | { status: "error"; message: string };

const RELEASES = "https://github.com/Andrehoey505/sahara-dashboard/releases/latest";


/**
 * The emergency bot's token.
 *
 * Andre asked for a backup bot, and the hard constraint is that it shares
 * Babblebot's token -- so this Mac has to hold that token in advance, because at
 * 11am when the power is off there is nothing left to fetch it from.
 *
 * It goes into the macOS Keychain. The screen can store one and can say whether
 * one is held; it can never display it again, because a token on screen ends up
 * in a screenshot and a token in a settings file ends up in a backup.
 */
function LiteTokenPanel({ apiUrl, fallbackUrl }: { apiUrl: string; fallbackUrl: string }) {
  const [present, setPresent] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dbExists, setDbExists] = useState(false);
  const [dbBytes, setDbBytes] = useState(0);
  const [litePending, setLitePending] = useState<LiteTicket[]>([]);

  useEffect(() => {
    void liteTickets().then((all) => setLitePending(all.filter((t) => !t.transferred)));
  }, []);

  useEffect(() => {
    void liteDbStatus().then((s) => {
      setDbExists(!!s.exists);
      setDbBytes(s.bytes || 0);
    });
  }, []);

  useEffect(() => {
    void liteTokenStatus().then((s) => {
      setPresent(s.present);
      // Show the real reason instead of a bare "not stored". A refused
      // permission and an empty keychain are different problems.
      if (!s.present && s.reason) setMsg(`Keychain says: ${s.reason} (service ${s.service || "?"})`);
    });
  }, []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const r = await liteTokenStore(draft.trim());
    setBusy(false);
    if (r.ok) {
      setDraft("");
      setPresent(true);
      setMsg("Saved to the Keychain. It cannot be read back — only replaced.");
    } else {
      setMsg(r.error || "Could not save it.");
    }
  };

  return (
    <Card
      icon={KeyRound}
      title="BabbleBot Lite token"
      data-tip="The bot token the emergency bot needs"
      blurb="Held in the macOS Keychain so the backup bot can start when the Windows machine is gone"
      tone="text-amber-300"
    >
      <div className="flex items-center justify-between gap-3 py-2">
        <span className="text-sm text-slate-200">
          {present ? "A token is held on this Mac" : "No token held yet"}
        </span>
        <span className={"text-xs " + (present ? "text-emerald-300" : "text-rose-300")}>
          {present ? "ready" : "backup bot cannot start"}
        </span>
      </div>

      <p className="text-xs text-slate-400 mt-1">
        This has to be done while the Windows machine is up, because there is nowhere else to get it
        from later. Once saved it is never shown again.
      </p>

      <div className="flex gap-2 mt-3">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={present ? "Paste a new token to replace it" : "Paste the bot token"}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-900/70 border border-slate-700 text-xs text-slate-100 font-mono"
        />
        <button
          onClick={() => void save()}
          disabled={busy || draft.trim().length < 20}
          className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-xs text-amber-100 hover:bg-amber-500/30 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {!present && (
          <button
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              const r = await liteTokenSync();
              setBusy(false);
              if (r.ok) {
                setPresent(true);
                setMsg(r.message || "Synced.");
              } else {
                setMsg(r.error || "Nothing to sync.");
              }
            }}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-xs text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
            data-tip="Copy a token from another Keychain entry into this app's own"
          >
            Sync
          </button>
        )}
        {present && (
          <button
            onClick={async () => {
              await liteTokenClear();
              setPresent(false);
              setMsg("Removed from the Keychain.");
            }}
            className="px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700/60"
          >
            Forget
          </button>
        )}
      </div>

      {msg && <p className="text-xs text-slate-300 mt-2">{msg}</p>}

      {/* Tickets Lite opened while Windows was away.
          These exist nowhere else, so this is the one screen that has to be
          unmissable and unlosable: it says how many are waiting, names them, and
          only marks them transferred when Andre presses the button. */}
      {litePending.length > 0 && (
        <div className="mt-4 pt-3 border-t border-amber-500/40">
          <p className="text-sm text-amber-200 font-semibold">
            {litePending.length} ticket{litePending.length === 1 ? "" : "s"} opened while Windows was down
          </p>
          <p className="text-xs text-amber-100/80 mt-1">
            These are held on this Mac only. Windows does not know about them yet. They are not lost
            — but they are not in the real database either until you hand them over.
          </p>
          <div className="mt-2 space-y-1">
            {litePending.slice(0, 8).map((t) => (
              <p key={t.id} className="text-[11px] text-slate-300 flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-slate-800/70 text-slate-400">{t.kind}</span>
                <span className="truncate">{t.user_name}</span>
                <span className="text-slate-500 truncate">{t.channel_name}</span>
                <span className="text-slate-500 shrink-0">{new Date(t.opened_at).toLocaleString()}</span>
              </p>
            ))}
          </div>
          <button
            onClick={async () => {
              const ids = litePending.map((t) => t.id);
              const r = await liteTicketsMarkTransferred(ids);
              if (r.ok) {
                setLitePending([]);
                setMsg(`${r.marked} ticket${r.marked === 1 ? "" : "s"} marked as taken by Windows.`);
              } else {
                setMsg(r.error || "Could not mark them.");
              }
            }}
            className="mt-2 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-xs text-amber-100 hover:bg-amber-500/30"
          >
            Hand these to Windows
          </button>

          {/* Checking is the honest half of handing over. The bot's API can read
              a namespace but not write one, so this proves from Windows' own data
              which records are already there and names the rest, instead of
              claiming a merge that never happened. */}
          <button
            onClick={async () => {
              setBusy(true);
              const r = await liteMergeReconcile(apiUrl, fallbackUrl);
              setBusy(false);
              if (r.ok) {
                const left = r.still_pending?.length || 0;
                const handed = (r as any).handed_over ?? 0;
                const handErr = (r as any).handover_error;
                setMsg(
                  `Checked against Windows: ${r.already_on_windows ?? 0} already there` +
                    (handed ? `, ${handed} handed over` : "") +
                    (handErr ? `\n${handErr}` : "") +
                    (left
                      ? `\n${left} still only on this Mac — ${r.still_pending
                          ?.map((t) => `${t.kind} for ${t.user_name}`)
                          .join(", ")}`
                      : "\nNothing left behind.")
                );
              } else {
                setMsg(r.error || "Could not check against Windows.");
              }
            }}
            disabled={busy}
            className="mt-2 ml-2 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-xs text-slate-200 hover:bg-slate-700/60 disabled:opacity-40"
          >
            Check against Windows
          </button>
        </div>
      )}

      {/* The snapshot is what makes tickets and the troll list work in Lite at
          all. It has to be taken while Windows is up, so it belongs next to the
          token -- the two things that can only be captured in advance. */}
      <div className="mt-4 pt-3 border-t border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-200">Copy of the Windows database</span>
          <span className={"text-xs " + (dbExists ? "text-emerald-300" : "text-slate-500")}>
            {dbExists ? `${(dbBytes / 1024 / 1024).toFixed(1)} MB held` : "not taken yet"}
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          A read-only snapshot, taken while Windows is running. Lite uses it for tickets, the troll
          list and channel rules. Anything that changes minute to minute — violations, mentions —
          is not in it and never will be.
        </p>
        <button
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            const r = await liteDbSnapshot(apiUrl, fallbackUrl);
            setBusy(false);
            if (r.ok) {
              setDbExists(true);
              setDbBytes(r.bytes || 0);
              setMsg(`Copied ${((r.bytes || 0) / 1024 / 1024).toFixed(1)} MB just now.`);
            } else {
              setMsg(r.error || "Could not take the copy.");
            }
          }}
          disabled={busy}
          className="mt-2 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700/60 disabled:opacity-40"
        >
          {busy ? "Working…" : dbExists ? "Take a fresh copy" : "Take a copy now"}
        </button>
      </div>
    </Card>
  );
}

function Card({
  icon: Icon,
  title,
  blurb,
  children,
  tone = "text-indigo-300",
}: {
  icon: typeof Server;
  title: string;
  blurb?: string;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <motion.section {...{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: motionTokens.enter }} className="card p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className={"w-9 h-9 rounded-xl bg-slate-800/70 flex items-center justify-center shrink-0 " + tone}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm">{title}</h3>
          {blurb && <p className="text-xs text-slate-500 mt-0.5">{blurb}</p>}
        </div>
      </div>
      {children}
    </motion.section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-800/60 last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-slate-300">{label}</p>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={
        "relative w-11 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 " +
        (on ? "bg-gradient-to-r from-indigo-500 to-violet-600" : "bg-slate-700")
      }
    
            data-tip="Turn this on or off">
      <span
        className={
          "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 " +
          (on ? "left-[22px]" : "left-0.5")
        }
      />
    </button>
  );
}

export default function SettingsScreen({
  settings,
  onSaveSettings,
  apiUrl,
  onSaveApiUrl,
  theme,
  onSaveTheme,
  soundEnabled,
  onToggleSound,
  ttsEnabled,
  onToggleTts,
  onOpenSetup,
  conn,
}: Props) {
  const [appVersion, setAppVersion] = useState("");
  // The addresses are how you fix a connection, not something to read on a day
  // when it is working. Two boxes and two Test buttons above the useful
  // settings is clutter -- Andre's words: "it would just be ugly". So the card
  // says which road it is on, and the boxes live behind one tap.
  const [showAddresses, setShowAddresses] = useState(false);
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const [pending, setPending] = useState<{ version: string; downloadAndInstall: (cb?: any) => Promise<void> } | null>(null);
  const [apiDraft, setApiDraft] = useState(apiUrl);
  // Which address was just saved. The input already shows what was typed, so
  // without this a successful save is indistinguishable from a save that did
  // nothing at all -- which reads as "it won't save my local IP".
  const [savedWhich, setSavedWhich] = useState<"api" | "fallback" | null>(null);
  const [fallbackDraft, setFallbackDraft] = useState(settings.apiFallbackUrl || "");

  // A draft that drifts from the saved value is the other half of "it won't
  // save": the box shows one address and the app uses another, forever.
  useEffect(() => {
    setApiDraft((d) => (d.trim() === apiUrl.trim() ? d : apiUrl));
  }, [apiUrl]);
  useEffect(() => {
    const saved = settings.apiFallbackUrl || "";
    setFallbackDraft((d) => (d.trim() === saved.trim() ? d : saved));
  }, [settings.apiFallbackUrl]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  /** What this Mac's own network was when the last test ran. */
  const [network, setNetwork] = useState<OfflineState>("unknown");
  const [testingFallback, setTestingFallback] = useState(false);
  const [fallbackResult, setFallbackResult] = useState<"ok" | "fail" | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setAppVersion(await getVersion());
      } catch {
        setAppVersion("");
      }
    })();
  }, []);

  const checkForUpdates = async () => {
    setUpdate({ status: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const found = await check();
      if (found?.available) {
        setUpdate({ status: "found", version: found.version });
        // Keep the handle so the Install button can act on this exact update.
        setPending(found);
      } else {
        setUpdate({ status: "none" });
      }
    } catch (e) {
      setUpdate({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  /**
   * Download and install, reporting progress the whole way.
   *
   * The old version asked for confirmation and then did the work inside the
   * same try block as the check, so any failure after the check looked like a
   * dead button: the version line stayed up and nothing else happened.
   */
  const installUpdate = async () => {
    if (!pending) return;
    const version = pending.version;
    setUpdate({ status: "downloading", version, pct: null });
    try {
      let total = 0;
      let done = 0;
      await pending.downloadAndInstall((event: any) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setUpdate({ status: "downloading", version, pct: total ? 0 : null });
        } else if (event.event === "Progress") {
          done += event.data.chunkLength;
          setUpdate({
            status: "downloading",
            version,
            pct: total ? Math.min(100, Math.round((done / total) * 100)) : null,
          });
        } else if (event.event === "Finished") {
          setUpdate({ status: "downloading", version, pct: 100 });
        }
      });
      setUpdate({ status: "installed", version });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      // Give the success state a moment to be seen before the window goes.
      setTimeout(() => {
        relaunch().catch((e) => {
          setUpdate({
            status: "error",
            message:
              "Installed, but couldn't restart automatically. Quit and reopen the app. (" +
              (e instanceof Error ? e.message : String(e)) +
              ")",
          });
        });
      }, 900);
    } catch (e) {
      setUpdate({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    // Asked first: "it failed" and "this Mac is offline" look identical from a
    // throw, and only one of them is the bot's fault.
    const net = await networkState();
    setNetwork(net);
    if (net === "offline") {
      setTestResult("fail");
      setTesting(false);
      return;
    }
    try {
      const r = await pingBot(apiDraft.replace(/\/$/, ""));
      setTestResult(r.ok ? "ok" : "fail");
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  };

  const testFallback = async () => {
    setTestingFallback(true);
    setFallbackResult(null);
    try {
      const r = await pingBot(fallbackDraft.trim().replace(/\/$/, ""));
      setFallbackResult(r.ok ? "ok" : "fail");
    } catch {
      setFallbackResult("fail");
    } finally {
      setTestingFallback(false);
    }
  };

  /**
   * Save both addresses.
   *
   * `primary` says which field was pressed, so the other one cannot be silently
   * dropped. The bug this fixes: the two fields had one Save between them, and
   * it took the primary from `apiDraft` -- so pressing Save on the fallback
   * rewrote the primary with whatever happened to be in that box. Type the LAN
   * in the primary, Tailscale in the fallback, press Save, and end up with two
   * copies of Tailscale. Which is exactly what "it keeps changing my local
   * address back" looks like.
   */
  const saveAddresses = (primary: "api" | "fallback") => {
    const clean = apiDraft.trim().replace(/\/$/, "");
    const cleanFallback = fallbackDraft.trim().replace(/\/$/, "");
    setApiDraft(clean);
    setFallbackDraft(cleanFallback);
    // Both saved together: the fallback is a property of the bot, not of this
    // laptop, and half a pair is worse than none.
    onSaveSettings({ ...settings, apiFallbackUrl: cleanFallback });
    // The primary only moves when the primary field is what was saved.
    if (primary === "api") onSaveApiUrl(clean);
    trace(
      "saved",
      `saved primary=${clean}${primary === "api" ? "" : " (unchanged)"}, fallback=${cleanFallback || "none"}`,
    );
  };

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    onSaveSettings({ ...settings, [key]: value });

  const checking = update.status === "checking";

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Updates first — it is what people come here for */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionTokens.enter}
        className="card p-5 border-indigo-500/25"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
              <Download className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-semibold">Updates</h3>
              <p className="text-xs text-slate-500">
                {appVersion ? `Version ${appVersion} installed` : "Version unknown"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={checkForUpdates}
              disabled={checking}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            
            data-tip="Check GitHub for a newer version of the app">
              <RefreshCw className={"w-4 h-4 " + (checking ? "animate-spin" : "")} />
              {checking ? "Checking…" : "Check for updates"}
            </button>
            <a
              href={RELEASES}
              target="_blank"
              rel="noreferrer"
              className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              aria-label="Open releases page"
              title="Open releases page" data-tip="Open releases page"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        {update.status === "none" && (
          <p className="mt-3 text-sm text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> You're on the latest version.
          </p>
        )}
        {update.status === "found" && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 bg-indigo-500/10 border border-indigo-500/30">
            <p className="text-sm text-indigo-200 flex items-center gap-2">
              <Download className="w-4 h-4" /> Version {update.version} is available.
            </p>
            <button
              onClick={installUpdate}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 text-sm font-semibold hover:opacity-90 transition-opacity"
             data-tip="Install this update and restart">
              Install and restart
            </button>
          </div>
        )}
        {update.status === "downloading" && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-sm text-indigo-200 mb-1.5">
              <span className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                Downloading {update.version}
              </span>
              <span className="tabular-nums text-slate-400">
                {update.pct == null ? "" : update.pct + "%"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
                style={{ width: (update.pct ?? 8) + "%" }}
              />
            </div>
            <p className="text-xs text-slate-500 mt-1.5">
              Keep the app open — it restarts itself when it's done.
            </p>
          </div>
        )}
        {update.status === "installed" && (
          <p className="mt-3 text-sm text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Installed — restarting…
          </p>
        )}
        {update.status === "error" && (
          <div className="mt-3 rounded-xl p-3 bg-rose-500/10 border border-rose-500/30">
            <p className="text-sm text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Update check failed
            </p>
            <p className="text-xs text-rose-300/80 mt-1 break-words">{update.message}</p>
            <p className="text-xs text-slate-400 mt-2">
              You can still download the latest installer from the releases page.
            </p>
          </div>
        )}
      </motion.section>


      <Card icon={Server} title="Babblebot connection" data-tip="Babblebot connection" blurb="Where the bot's API is listening" tone="text-sky-300">
        {/* Which road the app is on, in one line. This is the whole card when
            everything is working, because "which one is it using" is the only
            question anyone asks while it is. */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            {conn?.status === "connected" ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-slate-200">Connected</span>
                <span
                  className={
                    "text-[10px] px-1.5 py-0.5 rounded font-medium " +
                    (conn.via === "lan"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-violet-500/15 text-violet-300")
                  }
                >
                  {conn.via === "lan" ? "LAN" : "Tailscale"}
                </span>
                {/* The address actually in use. Discovery can choose one the
                    saved settings do not mention, and "which one is it on" is a
                    question the card should answer without opening the panel. */}
                {conn.url && (
                  <span className="text-xs font-mono text-slate-500">{conn.url}</span>
                )}
              </>
            ) : conn?.status === "probing" ? (
              <>
                <RefreshCw className="w-4 h-4 text-sky-300 animate-spin" />
                <span className="text-slate-300">Looking for the bot…</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 text-rose-400" />
                <span className="text-rose-200">Not found</span>
              </>
            )}
          </div>
          <button
            onClick={() => setShowAddresses((v) => !v)}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5"
            data-tip="The addresses the app tries, and where to change them"
          >
            {showAddresses ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {showAddresses ? "Hide addresses" : "Addresses"}
          </button>
        </div>

        {!showAddresses && (
          <p className="mt-2 text-xs text-slate-500 flex items-start gap-1.5">
            <Radar className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {conn?.status === "connected"
              ? "Found by itself on your network, then by Tailscale. Nothing to set up unless it stops working."
              : /* Not connected: the addresses are the only thing that can be wrong,
                   so pointing at a collapsed panel instead of opening it is the
                   difference between "it's broken" and "here's the box". */
                "Not connected — open Addresses below to check or change where the app is looking."}
          </p>
        )}

        {showAddresses && (
          <div className="mt-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={apiDraft}
            onChange={(e) => setApiDraft(e.target.value)}
            placeholder="http://192.168.1.128:8080"
            spellCheck={false}
            className="flex-1 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={testConnection}
            disabled={testing}
            className="px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-slate-300 hover:bg-slate-700/60 disabled:opacity-40 transition-colors"
           data-tip="Test this connection">
            {testing ? "Testing…" : "Test"}
          </button>
          <button
            onClick={() => {
              saveAddresses("api");
              setSavedWhich("api");
              window.setTimeout(() => setSavedWhich(null), 2500);
            }}
            className="px-3 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-sm text-indigo-200 hover:bg-indigo-500/30 transition-colors"
           data-tip="Save these settings">
            {savedWhich === "api" ? "Saved" : "Save"}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          {testResult === "ok" && (
            <span className="text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Bot reachable
            </span>
          )}
          {testResult === "fail" && (
            <span className="text-rose-300 flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5" /> Couldn't reach it — is the Windows machine awake?
            </span>
          )}
          {/* A failed test has two very different causes, and the wrong one sends
              you restarting a bot that was never in trouble. Ask the machine
              itself rather than guessing from the failed request. */}
          {testResult === "fail" && network === "offline" && (
            <span className="text-sky-300 flex items-center gap-1.5 w-full">
              <WifiOff className="w-3.5 h-3.5" />
              This Mac has no internet at all — connect to wifi or your hotspot first
            </span>
          )}
          {testResult === null && (
            <span className="text-slate-500">Local IP for same-network, or a tunnel URL for remote.</span>
          )}
        </div>

        {/* The fallback. Separate from the address above because it is a different
            road, not a different bot: tried only when the local one does not answer,
            so the LAN stays the fast path on a normal day. */}
        <div className="mt-4 pt-3 border-t border-slate-700/60">
          <p className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
            Fallback address
            <span className="text-slate-600">— tried only if the one above fails</span>
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={fallbackDraft}
              onChange={(e) => setFallbackDraft(e.target.value)}
              placeholder="http://100.x.y.z:8080"
              spellCheck={false}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={testFallback}
              disabled={testingFallback || !fallbackDraft.trim()}
              className="px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-slate-300 hover:bg-slate-700/60 disabled:opacity-40 transition-colors"
              data-tip="Test the fallback address on its own"
            >
              {testingFallback ? "Testing…" : "Test"}
            </button>
            {/* Save, right here. It used to be only the Save at the top of the card,
                which looks like it belongs to the primary field — so a fallback typed
                in and never saved is the obvious mistake, and it fails silently. */}
            <button
              onClick={() => saveAddresses("fallback")}
              disabled={fallbackDraft.trim() === (settings.apiFallbackUrl || "").trim()}
              className="px-3 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-sm text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-40 transition-colors"
              data-tip={
                fallbackDraft.trim() === (settings.apiFallbackUrl || "").trim()
                  ? "Already saved"
                  : "Save the fallback address so it survives a restart"
              }
            >
              Save
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
            {fallbackResult === "ok" && (
              <span className="text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Fallback reachable
              </span>
            )}
            {/* The distinction that matters: saved or not. A tested address that was
                never saved is gone after a restart and looks like the app forgot it. */}
            {fallbackDraft.trim() !== (settings.apiFallbackUrl || "").trim() && (
              <span className="text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Not saved yet — press Save
              </span>
            )}
            {fallbackDraft.trim() === (settings.apiFallbackUrl || "").trim() &&
              !!fallbackDraft.trim() && (
                <span className="text-emerald-300/80 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                </span>
              )}
            {fallbackResult === "fail" && (
              <span className="text-rose-300 flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5" /> No answer — is Tailscale connected on both machines?
              </span>
            )}
            {fallbackResult === "fail" && network === "offline" && (
              <span className="text-sky-300 flex items-center gap-1.5 w-full">
                <WifiOff className="w-3.5 h-3.5" />
                This Mac has no internet — a hotspot or wifi is needed before any address can work
              </span>
            )}
            {fallbackResult === null && fallbackDraft.trim() && !looksLikeTailscale(fallbackDraft) && (
              <span className="text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                That does not look like a Tailscale address (100.x.y.z or *.ts.net)
              </span>
            )}
            {fallbackResult === null && (!fallbackDraft.trim() || looksLikeTailscale(fallbackDraft)) && (
              <span className="text-slate-500">
                The bot's Tailscale address. Works from a hotspot or anywhere off your home wifi.
              </span>
            )}
          </div>
        </div>
          </div>
        )}
        <button
          onClick={onOpenSetup}
          className="mt-4 text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5"
        
            data-tip="Open the full setup">
          <Settings2 className="w-3.5 h-3.5" /> Open the full setup wizard
        </button>
      </Card>

      <LiteLivePanel />
      <CheckerProbe />
      <TracePanel />

      <LiteTokenPanel apiUrl={settings.apiUrl} fallbackUrl={settings.apiFallbackUrl || ""} />

      <LiteRulesPanel apiUrl={settings.apiUrl} fallbackUrl={settings.apiFallbackUrl || ""} />

      <Card icon={Activity} title="Health features" data-tip="Health features" blurb="What appears in the Health section" tone="text-rose-300">
        <Row
          label="Emergency department waits"
          hint="Shows the ED Waits tab and turns its spoken alerts on"
        >
          <Switch
            on={settings.edWaitsEnabled}
            label="Emergency department waits"
            onChange={(on) => onSaveSettings({ ...settings, edWaitsEnabled: on, ttsEdDrop: on })}
          />
        </Row>
      </Card>

      <Card icon={Volume2} title="Announcements" data-tip="Announcements" blurb="Which spoken alerts you actually want" tone="text-amber-300">
        <Row label="Voice announcements" hint="Master switch for all spoken alerts">
          <Switch on={ttsEnabled} onChange={onToggleTts} label="Voice announcements" />
        </Row>
        <Row label="Sound effects" hint="Beeps and chimes, no speech">
          <Switch on={soundEnabled} onChange={onToggleSound} label="Sound effects" />
        </Row>
        <Row label="ED wait drops" hint={settings.edWaitsEnabled ? "Announced when the queue shortens" : "Turn on ED waits above first"}>
          <Switch
            on={settings.ttsEdDrop && settings.edWaitsEnabled}
            label="ED wait drops"
            onChange={(on) => onSaveSettings({ ...settings, ttsEdDrop: on })}
          />
        </Row>
        <Row label="New member joins">
          <Switch
            on={settings.ttsNewMember}
            label="New member joins"
            onChange={(on) => onSaveSettings({ ...settings, ttsNewMember: on })}
          />
        </Row>
        <Row label="Mentions while you slept">
          <Switch
            on={settings.ttsAsleepMentions ?? true}
            label="Mentions while you slept"
            onChange={(on) => onSaveSettings({ ...settings, ttsAsleepMentions: on })}
          />
        </Row>
      </Card>

      <Card icon={Palette} title="Appearance" data-tip="Appearance" blurb="How the app looks" tone="text-fuchsia-300">
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: "dark", label: "Dark" },
            { id: "midnight", label: "Midnight" },
            { id: "light", label: "Light" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => onSaveTheme(t.id)}
              className={
                "py-3 rounded-xl text-sm border transition-colors " +
                (theme === t.id
                  ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200"
                  : "bg-slate-800/40 border-slate-700 text-slate-400 hover:bg-slate-700/50")
              }
            
            data-tip="Pick this tab">
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      <Card icon={Bell} title="About" data-tip="About" tone="text-slate-300">
        <Row label="Sahara Dashboard" hint="Front end for Babblebot">
          <span className="text-xs font-mono text-slate-400">{appVersion || "—"}</span>
        </Row>
        <Row label="Repository">
          <a
            href="https://github.com/Andrehoey505/sahara-dashboard"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-indigo-300 hover:text-indigo-200 flex items-center gap-1"
          >
            GitHub <ExternalLink className="w-3 h-3" />
          </a>
        </Row>
      </Card>
    </div>
  );
}
