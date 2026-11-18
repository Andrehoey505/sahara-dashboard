/**
 * Which address the app is talking to, and what to do when none of them answer.
 *
 * There are two ways to reach the bot and they fail for different reasons:
 *
 *   LAN        http://192.168.1.128:8080 — fast, but only while this machine is on
 *              the same network as the Windows box.
 *   Fallback   the bot's Tailscale address (100.x.y.z). Works from anywhere the
 *              Mac has internet, including a phone hotspot, which is the whole
 *              point of it: a power cut takes the Windows box and the router with
 *              it, and the Mac falls back to mobile data.
 *
 * A failed LAN probe is NOT the same as "the bot is down" — the commonest cause is
 * that this laptop changed network. So the two are probed separately and the
 * state says which: that sentence is the difference between "your bot is in
 * trouble" and "you're on a hotspot".
 *
 * Nothing here starts anything. The emergency-bot decision is made by the caller
 * and only ever as an offer — a second Discord process logging in while the
 * first is alive kicks the first one off its session.
 */

import { botFetch } from "./bot";
import { trace } from "./trace";

export type AddressKind = "lan" | "fallback";

/**
 * Why the app cannot see the bot. Three states, and they are not the same thing.
 *
 *   offline   this machine has no network at all. Nothing can be reached and
 *             nothing should be offered: the answer is "get back online", not
 *             "let's start a second bot".
 *   bot-down  this machine is online and neither address answers. The bot is
 *             genuinely gone, which is the only case where BabbleBot Lite makes
 *             sense to offer.
 *   unknown   the probe could not tell (a browser that will not say). Treated as
 *             bot-down for wording, never for starting anything.
 *
 * A failed fetch cannot distinguish these on its own: a dead wifi looks exactly
 * like a dead bot. So the machine is asked directly instead of inferring it.
 */
export type OfflineState = "online" | "offline" | "unknown";

/** What this machine's own network says. Cheap, and never throws. */
export async function networkState(): Promise<OfflineState> {
  try {
    const nav = (globalThis as any).navigator;
    if (nav && typeof nav.onLine === "boolean") {
      return nav.onLine ? "online" : "offline";
    }
  } catch {
    // fall through
  }
  return "unknown";
}

export type ProbeResult = {
  kind: AddressKind;
  url: string;
  ok: boolean;
  /** Round-trip in ms when ok. */
  ms?: number;
  /** Why it failed, in words the UI can show. */
  error?: string;
};

export type ConnectionState =
  | { status: "probing"; results: ProbeResult[] }
  | { status: "connected"; via: AddressKind; url: string; results: ProbeResult[] }
  | {
      status: "unreachable";
      results: ProbeResult[];
      /** Whether this machine had a network while the probes ran. */
      network?: OfflineState;
    };

/** Retries and patience per address. Three tries over ~90s, as agreed. */
export const TRIES_PER_ADDRESS = 3;
export const TOTAL_BUDGET_MS = 120_000;
/** A single request may not hang for the whole budget. */
const PER_TRY_TIMEOUT_MS = 8_000;
/** A quick first knock at each so a lost packet doesn't cost the whole budget. */
const QUICK_PROBE_MS = 3_000;

const trim = (u: string) => (u || "").trim().replace(/\/+$/, "");

/** Every address worth trying, in order, without duplicates or blanks. */
export function addresses(lan: string, fallback?: string): { kind: AddressKind; url: string }[] {
  const out: { kind: AddressKind; url: string }[] = [];
  const seen = new Set<string>();
  const lanUrl = trim(lan);
  const fbUrl = trim(fallback || "");
  if (lanUrl) {
    out.push({ kind: "lan", url: lanUrl });
    seen.add(lanUrl);
  }
  // The same URL typed twice is one address, not a fallback.
  if (fbUrl && !seen.has(fbUrl)) out.push({ kind: "fallback", url: fbUrl });
  return out;
}

/**
 * One short request to one address. Resolves, never throws.
 *
 * Goes through `botRequest`, which performs the request in Rust. The webview's
 * own fetch could not reach the fallback address at all -- a plain curl on the
 * same machine answered in 53ms while this got nothing back and the bot saw no
 * request arrive -- so the probe uses the path that actually works.
 */
async function hit(url: string, timeoutMs: number): Promise<ProbeResult & { kind: AddressKind }> {
  const started = Date.now();
  const kind: AddressKind = "lan";
  // `unqueued`: a probe's timeout runs from its creation, so waiting behind the
  // polling screens burns it and turns a 20ms LAN into "unreachable".
  const r = await botFetch(url + "/api/health", {
    signal: AbortSignal.timeout(timeoutMs),
    unqueued: true,
  });
  const ms = Date.now() - started;
  trace(
    "probe",
    `probe ${url} → ${r.status === 0 ? "no answer" : "HTTP " + r.status} in ${ms}ms`,
  );
  if (r.ok) {
    // A 200 is not the same as a bot.
    //
    // `/api/health` is answered by the API process, which can be running while the
    // Discord session is dead -- a half-alive state where the machine is up, the
    // port is open, and nobody is moderating. Treating that as "connected" is the
    // one thing a controlled test must never do, because the alarm would stay
    // silent while the server was unprotected.
    let botOnline: boolean | null = null;
    try {
      const h = await r.json();
      botOnline = typeof h?.bot_online === "boolean" ? h.bot_online : null;
    } catch {
      botOnline = null;
    }
    if (botOnline === false) {
      trace("probe", `probe ${url} → API up but bot_online false`);
      return {
        kind,
        url,
        ok: false,
        ms,
        error: "the API is answering but the bot is not connected to Discord",
      };
    }
    return { kind, url, ok: true, ms };
  }
  return {
    kind,
    url,
    ok: false,
    ms,
    error:
      r.status === 0
        ? ms >= timeoutMs
          ? "no answer in time"
          : "could not connect"
        : `answered but not healthy (HTTP ${r.status})`,
  };
}

/**
 * Probe every address once, quickly, in parallel.
 *
 * Used on load and on every retry: it answers "which road works right now" in a
 * few seconds instead of walking the addresses one at a time. LAN wins a tie —
 * it is the faster road when it exists.
 */
export async function probeOnce(lan: string, fallback?: string): Promise<ConnectionState> {
  const list = addresses(lan, fallback);
  // Asked before the probes, because an offline machine fails every address in
  // the same way and the answer is not "probe harder".
  const network = await networkState();
  if (network === "offline") return { status: "unreachable", results: [], network };
  if (list.length === 0) return { status: "unreachable", results: [], network };

  // Knocked at together, then judged in order.
  //
  // They used to be raced and the winner taken by how the array happened to be
  // sorted, which meant a Tailscale address that happened to answer 30ms sooner
  // won over a LAN address sitting right there. Whichever road answered first is
  // not the question. LAN first is: it is the same room, it cannot be metered,
  // and it does not depend on a VPN being up.
  // Knocked at ONE AFTER ANOTHER, not together.
  //
  // `botFetch` serialises through a single queue (see queue.ts), so a parallel
  // Promise.all never actually raced: both probes entered the queue and ran
  // sequentially anyway, while each still carried its own 3-second timeout
  // counted from when it was created. The LAN probe then sat behind whatever the
  // screens had queued, and by the time its turn came its timeout had already
  // expired -- reported as "local network unreachable" while a plain curl on the
  // same machine answered in 20ms. Tailscale, asked second, then got the free
  // queue and won.
  //
  // Asking in order costs one timeout in the worst case and is honest: LAN is
  // tried first, with its full timeout, on a queue that is empty of it.
  const probed: Array<ProbeResult & { kind: AddressKind }> = [];
  for (const a of list) {
    probed.push({ ...(await hit(a.url, QUICK_PROBE_MS)), kind: a.kind });
    // A local answer ends the search: it is the road we want.
    if (probed[probed.length - 1].ok) break;
  }
  const results = list.map((a) => probed.find((r) => r.kind === a.kind && r.url === a.url)!);

  // First address that answered, in the order the list is in -- which is LAN,
  // then fallback.
  const anyHit = results.find((r) => r.ok);
  if (anyHit) {
    trace("chosen", `using ${anyHit.kind} → ${anyHit.url}`);
    return { status: "connected", via: anyHit.kind, url: anyHit.url, results };
  }
  trace("error", `nothing answered (${results.length} address${results.length === 1 ? "" : "es"} tried)`);
  return { status: "unreachable", results, network };
}

/**
 * The patient version: three tries per address, inside one overall budget.
 *
 * The budget is shared, not per address, so a bad network cannot keep the app
 * waiting twice as long before it tells anyone anything. `onTick` reports each
 * attempt so the UI can count down instead of showing a spinner that means
 * nothing.
 */
export async function waitForBot(
  lan: string,
  fallback: string | undefined,
  opts: {
    onTick?: (attempt: number, of: number, result: ProbeResult) => void;
    budgetMs?: number;
    tries?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ConnectionState> {
  const list = addresses(lan, fallback);
  const budget = opts.budgetMs ?? TOTAL_BUDGET_MS;
  const tries = opts.tries ?? TRIES_PER_ADDRESS;
  const deadline = Date.now() + budget;
  const results: ProbeResult[] = [];
  const total = list.length * tries;
  let attempt = 0;

  // Nothing to wait for on a machine with no network. Retrying three times per
  // address over two minutes tells the user nothing they cannot see for
  // themselves, and it is the moment the app most needs to be quick.
  const startNetwork = await networkState();
  if (startNetwork === "offline") {
    return { status: "unreachable", results, network: startNetwork };
  }

  let offlineMidway = false;
  for (let round = 0; round < tries; round++) {
    for (const a of list) {
      if (opts.signal?.aborted) {
        return { status: "unreachable", results, network: startNetwork };
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        return {
          status: "unreachable",
          results,
          network: offlineMidway ? "offline" : startNetwork,
        };
      }
      attempt++;
      const r = await hit(a.url, Math.min(PER_TRY_TIMEOUT_MS, left));
      const result: ProbeResult = { ...r, kind: a.kind };
      results.push(result);
      opts.onTick?.(attempt, total, result);
      if (result.ok) {
        return { status: "connected", via: a.kind, url: a.url, results };
      }
      // The network can drop mid-probe (a hotspot that timed out, a lid closed).
      // Noticing that is the difference between "you went offline" and a long
      // list of failed addresses that blames the bot.
      if ((await networkState()) === "offline") offlineMidway = true;
      // A short gap between tries, but never past the deadline.
      const pause = Math.min(2_000, Math.max(0, deadline - Date.now()));
      if (pause > 0 && round < tries - 1) {
        await new Promise((res) => setTimeout(res, pause));
      }
    }
  }
  return {
    status: "unreachable",
    results,
    network: offlineMidway ? "offline" : startNetwork,
  };
}

/**
 * What to tell a person, in one sentence, about why the app cannot see the bot.
 *
 * The distinction matters: "both addresses failed" usually means the bot or the
 * machine behind it is gone, while "the fallback failed too" often means this
 * laptop is on a network that cannot see either. Either way it never claims to
 * know more than the probes did.
 */
export function explain(state: ConnectionState): string {
  if (state.status === "connected") {
    return state.via === "fallback"
      ? "Connected over the fallback address."
      : "Connected on the local network.";
  }
  // Offline is its own answer, and it is the only one that is not about the bot
  // at all. Saying "the bot may be down" to someone whose wifi is off sends them
  // hunting for a problem that is not there.
  if (state.status !== "unreachable") return "Looking for the bot…";
  if (state.network === "offline") {
    return "This Mac is not online. Connect to wifi or your hotspot and the app will reconnect on its own.";
  }
  const lan = state.results.filter((r) => r.kind === "lan");
  const fb = state.results.filter((r) => r.kind === "fallback");
  const lanOk = lan.some((r) => r.ok);
  const fbOk = fb.some((r) => r.ok);
  if (lanOk || fbOk) return "Connected.";
  const parts: string[] = [];
  parts.push(lan.length ? "Local network unreachable" : "No local address set");
  if (fb.length) parts.push("fallback unreachable");
  else parts.push("no fallback address set");
  return parts.join(", ") + ". The bot may still be running — or this laptop may be on a different network.";
}

/** True only when the bot is genuinely gone while this machine is online. */
export function botIsDown(state: ConnectionState): boolean {
  return state.status === "unreachable" && state.network !== "offline";
}


/** Which address is which, for a badge. Short enough not to wrap. */
export const addressLabel: Record<AddressKind, string> = {
  lan: "LAN",
  fallback: "Tailscale",
};

/**
 * A Tailscale address looks like 100.64.0.0/10 or a *.ts.net name. Used only to
 * warn in Settings when someone has typed something else into the fallback —
 * a typo there is invisible until the day it is needed.
 */
export function looksLikeTailscale(url: string): boolean {
  const u = trim(url);
  if (!u) return true; // empty is not an error, it is simply unset
  if (/\.ts\.net(:\d+)?$/i.test(u)) return true;
  const m = u.match(/^https?:\/\/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/i);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 100 && b >= 64 && b <= 127;
}
