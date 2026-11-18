/**
 * The app's one door to the bot.
 *
 * ## Why this exists
 *
 * The fallback address (Tailscale) has never worked from this app, and the
 * reason was not the network. Plain `curl` on the same Mac reached
 * `http://100.121.118.62:8080/api/health` in 53ms with HTTP 200, at the same
 * moment the app got nothing back and the bot's own log showed no request
 * arriving. Same machine, same address, same second.
 *
 * So the webview was the thing failing to make the request, and it was failing
 * silently. This module stops asking it to.
 *
 * ## What it does instead
 *
 * The `bot_http` command in `src-tauri/src/lib.rs` performs the request with
 * `reqwest`, in Rust, and returns the body. There is no capability to satisfy,
 * no allow-scope, no origin, and nothing to negotiate with the webview -- it is
 * a socket, which is what `curl` was doing successfully all along.
 *
 * (The `tauri-plugin-http` route was tried first and made things worse: it took
 * the LAN address down too. A command is not a smaller version of the plugin,
 * it is a different thing -- there is no security model in between to disagree
 * with us.)
 *
 * ## Why the return shape is the same as `fetch`
 *
 * There are ~96 request sites in this app. Rewriting them all to a new shape in
 * one go is how you ship a regression in the ninety-fifth. So `botFetch` returns
 * something that answers `.ok`, `.status`, `.json()`, `.text()` and `.headers.get()`
 * exactly like the object the call sites already use -- the swap is one word per
 * line, and any site left un-swapped keeps working through the webview.
 *
 * ## One thing it fixes on the way past
 *
 * A failed `fetch` and a server that answered with an error were both a throw,
 * so "nothing answered at all" and "the bot said 500" were reported identically
 * to the user. `status: 0` now means the request never completed; a real status
 * means the bot answered and said no. Those are different problems.
 */

/** What `botFetch` hands back. Enough of `Response` for every call site here. */
export type BotResponse = {
  ok: boolean;
  status: number;
  /** The body, already read. Parsed if it is JSON, `{}` if it was empty. */
  json: () => Promise<any>;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
};

/**
 * How long a request to the bot may take.
 *
 * The bot lives on a laptop that can be asleep, on 98% memory, or mid-restart.
 * Twenty seconds is long enough that a slow answer arrives and short enough that
 * a dead one gives the UI back instead of leaving a spinner forever.
 */
import { trace } from "./trace";
import { queueRequest, counted } from "./queue";

const TIMEOUT_MS = 20_000;

/** The Rust side: one command, called directly. */
type Invoke = (cmd: string, args?: any) => Promise<any>;

let cachedInvoke: Invoke | null | undefined;

/**
 * Tauri's `invoke`, if this is a real Tauri window.
 *
 * `undefined` means "not asked yet"; `null` means "asked, and there is no
 * Tauri" -- which is the case in a plain browser (`npm run dev`).
 */
async function rustInvoke(): Promise<Invoke | null> {
  if (cachedInvoke !== undefined) return cachedInvoke;
  try {
    const mod = await import("@tauri-apps/api/core");
    cachedInvoke = typeof mod.invoke === "function" ? (mod.invoke as unknown as Invoke) : null;
  } catch {
    cachedInvoke = null;
  }
  return cachedInvoke;
}

/** Strip a trailing slash so paths do not double up. */
export const trimUrl = (u: string) => (u || "").trim().replace(/\/+$/, "");

/**
 * One request to the bot, through Rust.
 *
 * Accepts the same arguments as `fetch` for the parts this app uses: a URL, and
 * an init with `method`, `headers`, `body` and `signal`. Anything else is
 * ignored rather than silently changing behaviour.
 */
export async function botFetch(
  input: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    signal?: AbortSignal | null;
    /**
     * Skip the shared queue.
     *
     * Only for the connection probe, and only because a probe's timeout is
     * measured from when it is created. Queued behind eleven polling screens it
     * can spend its whole 3 seconds waiting and then be reported as "local
     * network unreachable" -- which is what happened, on a machine answering in
     * 20ms. A probe is one tiny request; it does not need to take a turn.
     */
    unqueued?: boolean;
  } = {},
): Promise<BotResponse> {
  const url = /^https?:\/\//i.test(input) ? input : trimUrl(input);
  const headers: Record<string, string> = { ...(init.headers || {}) };
  // A cached answer from an earlier session must never read as "alive now", and
  // the webview's own cache is not consulted by the Rust path anyway -- this is
  // for the plain-browser path.
  if (!("Cache-Control" in headers)) headers["Cache-Control"] = "no-store";

  const invoke = await rustInvoke();

  let status = 0;
  let ok = false;
  let text = "";
  let hdrs: { get: (n: string) => string | null } = { get: () => null };

  if (invoke) {
    try {
      // One at a time. See src/lib/queue.ts: the bot is a 6 GB laptop at 98%
      // memory, and eleven polling screens plus two probes is more sockets than
      // it can answer quickly, which makes every one of them slower.
      const call = () =>
        invoke("bot_http", {
          url,
          method: init.method || "GET",
          body: typeof init.body === "string" ? init.body : undefined,
          headers,
          timeoutMs: TIMEOUT_MS,
        });
      const reply = init.unqueued
        ? await counted(() => call())
        : await queueRequest(() => counted(() => call()));
      status = Number(reply?.status ?? 0);
      ok = !!reply?.ok;
      text = String(reply?.body ?? "");
    } catch (e: any) {
      // The command rejects with a plain string when the request did not
      // complete: no socket, no route, refused, or the timeout. That string now
      // carries reqwest's whole cause chain, so it names the layer.
      const why = String(e?.message || e || "no answer");
      trace("error", `${(init.method || "GET")} ${url} failed: ${why}`);
      return failed(why);
    }
  } else {
    try {
      // Serialised for the same reason as the Rust path: one bot, one laptop,
      // and no reason for the browser dev build to behave differently.
      const res = await queueRequest(() =>
        counted(() =>
          fetch(url, {
        method: init.method || "GET",
        headers,
        body: init.body,
        cache: "no-store",
        signal: init.signal,
          }),
        ),
      );
      status = res.status;
      ok = res.ok;
      text = await res.text();
      hdrs = { get: (n: string) => res.headers.get(n) };
    } catch (e: any) {
      return failed(String(e?.message || e || "no answer"));
    }
  }

  let parsed: any;
  let parsedDone = false;
  const parse = () => {
    if (parsedDone) return parsed;
    parsedDone = true;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    return parsed;
  };

  return {
    ok,
    status,
    json: async () => parse(),
    text: async () => text,
    headers: hdrs,
  };
}

/** The request never completed: no socket, no route, or a timeout. */
function failed(message: string): BotResponse {
  return {
    ok: false,
    status: 0,
    json: async () => ({ error: message }),
    text: async () => message,
    headers: { get: () => null },
  };
}

/** Shorthand for a GET. */
export const botGet = (apiUrl: string, path: string) =>
  botFetch(trimUrl(apiUrl) + path);

/** Shorthand for a JSON POST. */
export const botPost = (apiUrl: string, path: string, body: unknown) =>
  botFetch(trimUrl(apiUrl) + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Just tell me whether that address is alive, and how fast.
 *
 * Separate from the connection probe on purpose: the probe needs to know about
 * the network as well, while this is a bare "does it answer".
 */
export async function pingBot(
  url: string,
  timeoutMs = 8_000,
): Promise<{ ok: boolean; ms: number; status: number }> {
  const started = Date.now();
  const r = await botFetch(trimUrl(url) + "/api/health", {
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { ok: r.ok, ms: Date.now() - started, status: r.status };
}

/**
 * BabbleBot Lite: start or stop the emergency bot on this Mac.
 *
 * Deliberately a single command with two verbs rather than separate ones, so
 * there is one place that knows Lite exists and one place the safety checks
 * live. The checks themselves are in Rust -- they must not depend on the screen
 * being open or on anything the webview can be talked into.
 */
export type LiteResult = {
  running: boolean;
  /** Why it refused, when it did. Empty on success. */
  error?: string;
  /** What it is doing now, in one line, for the screen. */
  detail?: string;
};

export async function liteCommand(action: "start" | "stop" | "status"): Promise<LiteResult> {
  const invoke = await rustInvoke();
  if (!invoke) return { running: false, error: "Not running inside the app." };
  try {
    const r = await invoke("babblebot_lite", { action });
    return { running: !!r?.running, error: r?.error, detail: r?.detail };
  } catch (e: any) {
    return { running: false, error: String(e?.message || e) };
  }
}

/**
 * The bot token, kept in the macOS Keychain and never in the app's own files.
 *
 * The screen can store one and can ask whether one exists; it can never read it
 * back. That is not paranoia about Andre -- it is that a token in a JSON file
 * ends up in a Time Machine backup, a screenshot of the settings screen, and a
 * bug report, and this one cannot be rotated without breaking four servers.
 */
export async function liteTokenStore(token: string): Promise<{ ok: boolean; error?: string }> {
  const invoke = await rustInvoke();
  if (!invoke) return { ok: false, error: "Not running inside the app." };
  try {
    await invoke("lite_token_store", { token });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function liteTokenStatus(): Promise<{ present: boolean; reason?: string; service?: string }> {
  const invoke = await rustInvoke();
  if (!invoke) return { present: false, reason: "not running inside the app" };
  try {
    const r = await invoke("lite_token_status");
    return { present: !!r?.present, reason: r?.reason, service: r?.service };
  } catch (e: any) {
    return { present: false, reason: String(e?.message || e) };
  }
}

export async function liteTokenClear(): Promise<void> {
  const invoke = await rustInvoke();
  if (!invoke) return;
  try {
    await invoke("lite_token_clear");
  } catch {
    /* nothing to report: the point of clearing is that nothing is left */
  }
}

/** Where Lite's API is listening, so the app can point itself at it. */
export async function liteUrl(): Promise<string> {
  const invoke = await rustInvoke();
  if (!invoke) return "http://127.0.0.1:8099";
  try {
    return await invoke("lite_url");
  } catch {
    return "http://127.0.0.1:8099";
  }
}

/**
 * Tell Lite to re-read its rules now, because something it copies has just
 * changed on Windows.
 *
 * Called after an edit this app made itself: the dashboard is the one thing that
 * knows a troll was added or a rule changed, so waiting up to twenty minutes for
 * the timer would leave Lite enforcing yesterday's settings at the moment it
 * mattered most. Never waits, never throws: a nudge that fails is a nudge the
 * timer will cover.
 */
export async function liteSyncNow(): Promise<void> {
  const invoke = await rustInvoke();
  if (!invoke) return;
  try {
    await invoke("lite_sync_now");
  } catch {
    /* the timer is the backstop */
  }
}

/** Take a read-only copy of the Windows database, while Windows is up. */
export async function liteDbSnapshot(apiUrl: string, fallbackUrl?: string): Promise<{ ok: boolean; error?: string; bytes?: number; servedBy?: string }> {
  const invoke = await rustInvoke();
  if (!invoke) return { ok: false, error: "Not running inside the app." };
  try {
    const r = await invoke("lite_db_snapshot", { apiUrl, fallbackUrl: fallbackUrl || null });
    return { ok: !!r?.ok, error: r?.error, bytes: r?.bytes, servedBy: r?.served_by };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function liteDbStatus(): Promise<{ exists: boolean; bytes?: number }> {
  const invoke = await rustInvoke();
  if (!invoke) return { exists: false };
  try {
    const r = await invoke("lite_db_status");
    return { exists: !!r?.exists, bytes: r?.bytes };
  } catch {
    return { exists: false };
  }
}

/** A ticket Lite opened while Windows was down. */
export type LiteTicket = {
  id: string;
  kind: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  channel_name: string;
  guild_id: string;
  opened_at: number;
  status: string;
  notes: string;
  transferred: boolean;
};

export async function liteTickets(): Promise<LiteTicket[]> {
  const invoke = await rustInvoke();
  if (!invoke) return [];
  try {
    const r = await invoke("lite_tickets");
    return r?.tickets || [];
  } catch {
    return [];
  }
}

export async function liteTicketOpen(t: Omit<LiteTicket, "id" | "opened_at" | "status" | "notes" | "transferred">) {
  const invoke = await rustInvoke();
  if (!invoke) return { ok: false, error: "Not running inside the app." };
  try {
    const r = await invoke("lite_ticket_open", { ...t });
    return { ok: !!r?.ok, ticket: r?.ticket };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function liteTicketsMarkTransferred(ids: string[]) {
  const invoke = await rustInvoke();
  if (!invoke) return { ok: false, marked: 0 };
  try {
    const r = await invoke("lite_tickets_mark_transferred", { ids });
    return { ok: !!r?.ok, marked: r?.marked || 0, error: r?.error };
  } catch (e: any) {
    return { ok: false, marked: 0, error: String(e?.message || e) };
  }
}

/**
 * The verification ticket's opening message, word for word from the Windows side.
 *
 * Shown in Settings so it can be compared with what the bot posts. If these two
 * drift, members get instructions that do not match what staff check.
 */
export async function liteVerifyMessage(): Promise<string> {
  const invoke = await rustInvoke();
  if (!invoke) return "";
  try {
    return await invoke("lite_verify_message");
  } catch {
    return "";
  }
}

/**
 * Copy a token from any Keychain service name into the app's own.
 *
 * A Keychain item carries the permissions of whoever created it, so a token put
 * there by the `security` command belongs to an item this app can be refused
 * access to. This re-creates it from the app, which fixes that, and the value
 * never leaves Rust.
 */
export async function liteTokenSync(): Promise<{ ok: boolean; changed?: boolean; message?: string; error?: string }> {
  const invoke = await rustInvoke();
  if (!invoke) return { ok: false, error: "Not running inside the app." };
  try {
    const r = await invoke("lite_token_sync");
    return { ok: !!r?.ok, changed: !!r?.changed, message: r?.message, error: r?.error };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Keep this Mac awake while Lite is in charge.
 *
 * An idle Mac would sleep mid-shift and take Lite with it, leaving the server
 * unmoderated by a laptop that dozed off. The assertion is released when Lite
 * stops, so nothing is held awake for a bot that has finished.
 */
export async function keepAwake(on: boolean): Promise<{ ok: boolean; error?: string }> {
  const invoke = await rustInvoke();
  if (!invoke) return { ok: false, error: "Not running inside the app." };
  try {
    const r = await invoke(on ? "keep_awake_on" : "keep_awake_off");
    return { ok: r?.awake !== undefined, error: r?.error };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Is Lite's Discord client actually connected?
 *
 * The screen must never guess this. "Lite is running" and "Lite is watching
 * Discord" are different claims, and only the second one protects a server.
 */
export async function liteClientState(): Promise<{
  connected: boolean;
  bot?: string;
  guilds?: string[];
  seen?: number;
  error?: string;
}> {
  try {
    const r = await fetch("http://127.0.0.1:8099/api/lite/client", {
      cache: "no-store",
    });
    if (!r.ok) return { connected: false, error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e: any) {
    return { connected: false, error: String(e?.message || e) };
  }
}

/**
 * Refresh Lite's rules from the live Windows bot.
 *
 * Lite's flag system comes from a snapshot taken at handover. If staff have since
 * approved or rejected flags on Windows, that snapshot is stale — and a stale flag
 * system is worse than none, because it flags messages Windows would have left
 * alone, and the member told off for nothing is the one who leaves.
 */
export async function liteRulesSync(
  apiUrl: string,
  fallbackUrl?: string
): Promise<{ ok: boolean; served_by?: string; bytes?: number; loaded?: any; error?: string }> {
  const invoke = await rustInvoke();
  if (!invoke) return { ok: false, error: "Not running inside the app." };
  try {
    return await invoke("lite_rules_sync", { apiUrl, fallbackUrl });
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Start the background refresh of Lite's copy from Windows.
 *
 * Called on launch, before any outage, because the value is in the refresh that
 * already happened. Harmless when Windows is down: the request fails and the last
 * good copy stays.
 */
export async function liteAutoSyncStart(apiUrl: string, fallbackUrl?: string) {
  const invoke = await rustInvoke();
  if (!invoke) return;
  try {
    await invoke("lite_auto_sync_start", { apiUrl, fallbackUrl });
  } catch {
    /* the timer is a convenience; failing to start it must not break the app */
  }
}

/**
 * Tell the Rust side which address the app is actually connected through.
 *
 * The sync used to pick its own road (LAN, then Tailscale) and pay four seconds
 * for a LAN that this Mac cannot route to, then print that failure next to a
 * sync that had worked over Tailscale. The app already knows; say so.
 */
export async function liteSetLiveRoad(url?: string | null): Promise<void> {
  const invoke = await rustInvoke();
  if (!invoke) return;
  try {
    await invoke("lite_set_live_road", { url: url || null });
  } catch {
    /* a missing hint only costs the sync its old guessing, never its correctness */
  }
}

/** When Lite last refreshed itself, and why it failed if it did. */
export async function liteSyncState(): Promise<{
  last_sync?: number;
  last_error?: string;
  interval_seconds?: number;
}> {
  try {
    const r = await fetch("http://127.0.0.1:8099/api/lite/sync", { cache: "no-store" });
    if (!r.ok) return {};
    return await r.json();
  } catch {
    return {};
  }
}

/**
 * What Lite is actually enforcing right now.
 *
 * Shown so a stale copy is visible rather than assumed: the channel-rule count and
 * the learned profanity threshold are the numbers that decide whether a message
 * gets flagged, and they should match Windows.
 */
export async function liteRulesSummary(): Promise<{
  servers?: number;
  channel_rules?: number;
  by_preset?: Record<string, number>;
  off_channels?: number;
  ticket_types?: number;
  exempt_users?: number;
  profanity_threshold?: number;
  helpline?: boolean;
}> {
  try {
    const r = await fetch("http://127.0.0.1:8099/api/lite/rules", { cache: "no-store" });
    if (!r.ok) return {};
    return await r.json();
  } catch {
    return {};
  }
}

/**
 * Check Lite's records against what Windows already holds.
 *
 * A ticket or verification done during an outage exists in Discord either way.
 * What must never happen is Windows not knowing about it, so this reads Windows'
 * own tickets namespace and marks what is already there, leaving the rest named
 * rather than assumed away. Read-only against Windows.
 */
export async function liteMergeReconcile(
  apiUrl: string,
  fallbackUrl?: string
): Promise<{
  ok: boolean;
  already_on_windows?: number;
  still_pending?: Array<{ kind: string; user_name: string; channel_id: string }>;
  error?: string;
}> {
  const invoke = await rustInvoke();
  if (!invoke) return { ok: false, error: "Not running inside the app." };
  try {
    return await invoke("lite_merge_reconcile", { apiUrl, fallbackUrl });
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Find the bot instead of assuming where it is.
 *
 * Tries what worked last time, then a single broadcast on the network this Mac is
 * actually on, then the fallback (Tailscale). Returns which road found it, so the
 * top bar can say LAN or Tailscale rather than just "connected".
 *
 * `found: false` is deliberately not a verdict: only the caller knows whether
 * every road was tried, and calling a healthy bot down starts a second process on
 * the same Discord token.
 */
export async function discoverBot(
  remembered?: string,
  fallback?: string
): Promise<{
  found: boolean;
  via?: "remembered" | "lan" | "tailscale";
  url?: string;
  tried?: Array<{ url: string; why: string }>;
}> {
  const invoke = await rustInvoke();
  if (!invoke) return { found: false };
  try {
    return await invoke("discover_bot", { remembered, fallback });
  } catch {
    return { found: false };
  }
}

/**
 * Tell Lite which address to check when looking for Windows to come back.
 *
 * Lite holds the Discord session while it covers, so Windows cannot start until
 * Lite lets go -- which means waiting for a human to notice is how a laptop ends
 * up moderating for days. The watcher asks this address every minute and steps
 * down once it gets two clean answers in a row.
 */
export async function liteSetWatchAddress(url: string | null): Promise<void> {
  try {
    const invoke = await rustInvoke();
    if (!invoke) return;
    await invoke("lite_set_watch_address", { url });
  } catch {
    /* the watcher simply never fires; Lite still covers, it just will not step
       down on its own until the app is on a working road again */
  }
}
