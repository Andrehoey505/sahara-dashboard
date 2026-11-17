/**
 * Every request the app makes to the bot, through one door.
 *
 * The webview's own `fetch` cannot reach a Tailscale address from this app, and
 * the reason was never the network: plain `curl` on the same Mac answers in 53ms
 * while the webview gets nothing back at all, and nothing arrives at the bot
 * either. Whatever the webview is doing with that request, it never leaves.
 *
 * So the app stopped asking the webview to make it. Tauri's HTTP plugin performs
 * the request in Rust, on the other side of the webview, and hands back the body.
 * Rust has no origin header to argue about, no CORS, no allow-list of hosts --
 * it is just a socket, which is what `curl` was doing all along.
 *
 * This module is the only place that decides. Everything else calls it and does
 * not care which of the two paths was used.
 */

/** The plugin's response, shaped like the parts of `Response` this app uses. */
export type BotReply = {
  ok: boolean;
  status: number;
  /** Already parsed. An empty or unparseable body becomes {}. */
  data: any;
};

const trim = (u: string) => (u || "").trim().replace(/\/+$/, "");

/**
 * Whether the Rust path is usable at all.
 *
 * In a plain browser (`npm run dev`, or a window opened outside Tauri) there is
 * no plugin, and the webview's fetch is the only option — so the fallback is not
 * a failure, it is the correct path there.
 */
async function rustFetch(): Promise<typeof fetch | null> {
  try {
    const mod = await import("@tauri-apps/plugin-http");
    if (typeof mod.fetch === "function") return mod.fetch as unknown as typeof fetch;
  } catch {
    // Not running inside Tauri, or the plugin is missing. Fall through.
  }
  return null;
}

/**
 * One request to the bot.
 *
 * `path` is appended to `apiUrl`; a full URL may also be passed as `path` when
 * the caller has one (the media viewer does).
 *
 * Returns whatever came back, parsed, or `{ ok: false, status: 0 }` when nothing
 * came back at all — which is the case the old code could not tell apart from a
 * server that answered with an error.
 */
export async function botRequest(
  apiUrl: string,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<BotReply> {
  const url = /^https?:\/\//i.test(path) ? path : trim(apiUrl) + path;
  const method = init.method || "GET";
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  const rust = await rustFetch();
  if (rust) {
    try {
      const res = await rust(url, {
        method,
        headers,
        body,
        // A hung request must not hang the UI with it. The bot lives on a laptop
        // that can go to sleep mid-answer, so this is a real case, not a guard.
        signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }
      return { ok: res.ok, status: res.status, data };
    } catch (e: any) {
      // A thrown error from the plugin means the request did not complete: no
      // socket, no route, or a timeout. Status 0 says exactly that and cannot be
      // confused with a server that answered 500.
      return { ok: false, status: 0, data: { error: String(e?.message || e || "no answer") } };
    }
  }

  // Plain browser.
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      cache: "no-store",
    });
    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e: any) {
    return { ok: false, status: 0, data: { error: String(e?.message || e || "no answer") } };
  }
}

/** Shorthand for a GET. */
export const botGet = (apiUrl: string, path: string, timeoutMs?: number) =>
  botRequest(apiUrl, path, { timeoutMs });

/** Shorthand for a JSON POST. */
export const botPost = (apiUrl: string, path: string, body: unknown, timeoutMs?: number) =>
  botRequest(apiUrl, path, { method: "POST", body, timeoutMs });

/**
 * Just tell me whether that address is alive, and how fast.
 *
 * Kept separate from the connection probe on purpose: the probe needs to know
 * about the *network* as well, while this is a bare "does it answer".
 */
export async function pingBot(
  url: string,
  timeoutMs = 8_000,
): Promise<{ ok: boolean; ms: number; status: number }> {
  const started = Date.now();
  const r = await botRequest(url, "/api/health", { timeoutMs });
  return { ok: r.ok, ms: Date.now() - started, status: r.status };
}
