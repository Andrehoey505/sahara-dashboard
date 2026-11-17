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
 * Tauri's HTTP plugin performs the request in Rust, on the other side of the
 * webview, and returns the body. Rust has no origin header to be judged on, no
 * CORS, no allow-list of hosts -- it is a socket, which is what `curl` was
 * doing successfully all along.
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

type FetchLike = (input: string, init?: any) => Promise<any>;

let cachedPlugin: FetchLike | null | undefined;

/**
 * The Rust path, if this is a real Tauri window.
 *
 * Cached because the dynamic import is a promise and every request would
 * otherwise pay for it. `undefined` means "not asked yet", `null` means "asked,
 * and there is no plugin" -- which is the case in a plain browser.
 */
async function rustFetch(): Promise<FetchLike | null> {
  if (cachedPlugin !== undefined) return cachedPlugin;
  try {
    const mod = await import("@tauri-apps/plugin-http");
    cachedPlugin = typeof mod.fetch === "function" ? (mod.fetch as unknown as FetchLike) : null;
  } catch {
    cachedPlugin = null;
  }
  return cachedPlugin;
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
  } = {},
): Promise<BotResponse> {
  const url = /^https?:\/\//i.test(input) ? input : trimUrl(input);
  const headers: Record<string, string> = { ...(init.headers || {}) };
  // A cached answer from an earlier session must never read as "alive now", and
  // the webview's own cache is not consulted by the Rust path anyway -- this is
  // for the plain-browser path.
  if (!("Cache-Control" in headers)) headers["Cache-Control"] = "no-store";

  const rust = await rustFetch();

  let status = 0;
  let ok = false;
  let text = "";
  let hdrs: { get: (n: string) => string | null } = { get: () => null };

  if (rust) {
    try {
      const res = await rust(url, {
        method: init.method || "GET",
        headers,
        body: init.body,
        // A hung request must not hang the UI with it: the bot lives on a laptop
        // that can sleep mid-answer, so this is a real case, not a guard.
        signal: init.signal,
      });
      status = res.status;
      ok = res.ok;
      text = await res.text();
      hdrs = { get: (n: string) => (res.headers && res.headers.get ? res.headers.get(n) : null) };
    } catch (e: any) {
      return failed(String(e?.message || e || "no answer"));
    }
  } else {
    try {
      const res = await fetch(url, {
        method: init.method || "GET",
        headers,
        body: init.body,
        cache: "no-store",
        signal: init.signal,
      });
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
