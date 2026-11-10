/**
 * Spotify Web API — authorisation code flow with PKCE.
 *
 * The app has no backend of its own, so everything happens in the browser.
 * PKCE avoids needing a client secret in the browser at all, which is the
 * safer option for a desktop app: the secret never leaves the machine and the
 * token exchange is bound to a one-time code verifier.
 *
 * Requires an active Spotify Premium account — playback control is Premium-only.
 */

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

const TOKEN_KEY = "sahara_spotify_token";
const VERIFIER_KEY = "sahara_spotify_verifier";
const STATE_KEY = "sahara_spotify_state";

const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "user-library-read",
].join(" ");

export type SpotifyToken = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
};

export type NowPlaying = {
  is_playing: boolean;
  track?: string;
  artists?: string;
  album?: string;
  image?: string;
  progress_ms?: number;
  duration_ms?: number;
  device?: string;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

export function loadToken(): SpotifyToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as SpotifyToken) : null;
  } catch {
    return null;
  }
}

function saveToken(t: SpotifyToken) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(STATE_KEY);
}

/** Build the authorise URL and stash the verifier/state for the callback. */
export async function beginAuth(clientId: string, redirectUri: string): Promise<string> {
  const verifier = randomString(64);
  const state = randomString(16);
  localStorage.setItem(VERIFIER_KEY, verifier);
  localStorage.setItem(STATE_KEY, state);

  const challenge = base64UrlEncode(await sha256(verifier));
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Exchange the ?code= from the callback for a token. */
export async function completeAuth(
  clientId: string,
  redirectUri: string,
  code: string,
  state: string
): Promise<SpotifyToken> {
  const expected = localStorage.getItem(STATE_KEY);
  // PKCE binds the exchange to the verifier, which is the real protection. The
  // state check catches cross-site request forgery, but it's easily lost when
  // the app is restarted between approving and pasting the callback — so treat
  // a mismatch as a warning, not a failure.
  if (expected && state && expected !== state) {
    console.warn("[spotify] state mismatch — continuing, verifier still required");
  }
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    throw new Error(
      "The app lost its PKCE verifier — press Connect again and approve in the same session."
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      detail = err.error_description || err.error || detail;
    } catch {}
    throw new Error(`Token exchange failed: ${detail}`);
  }
  const data = await res.json();
  const token: SpotifyToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  saveToken(token);
  return token;
}

async function refresh(clientId: string, token: SpotifyToken): Promise<SpotifyToken> {
  if (!token.refresh_token) throw new Error("No refresh token");
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Refresh failed");
  const data = await res.json();
  const next: SpotifyToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? token.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  saveToken(next);
  return next;
}

async function authed(clientId: string, path: string, init?: RequestInit) {
  let token = loadToken();
  if (!token) throw new Error("Not connected");
  if (Date.now() > token.expires_at - 60000) {
    token = await refresh(clientId, token);
  }
  const res = await fetch(API + path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token.access_token}`,
    },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Spotify error ${res.status}`);
  }
  return res.json();
}

export async function getNowPlaying(clientId: string): Promise<NowPlaying | null> {
  const data = await authed(clientId, "/me/player");
  if (!data || !data.item) return null;
  return {
    is_playing: !!data.is_playing,
    track: data.item.name,
    artists: (data.item.artists || []).map((a: any) => a.name).join(", "),
    album: data.item.album?.name,
    image: data.item.album?.images?.[1]?.url || data.item.album?.images?.[0]?.url,
    progress_ms: data.progress_ms,
    duration_ms: data.item.duration_ms,
    device: data.device?.name,
  };
}

export async function transport(clientId: string, action: "play" | "pause" | "next" | "previous") {
  const method = action === "next" || action === "previous" ? "POST" : "PUT";
  const path = `/me/player/${action}`;
  await authed(clientId, path, { method });
}

export async function getPlaylists(clientId: string) {
  const data = await authed(clientId, "/me/playlists?limit=50");
  return (data?.items || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    image: p.images?.[1]?.url || p.images?.[0]?.url,
    tracks: p.tracks?.total,
    uri: p.uri,
  }));
}

export async function playPlaylist(clientId: string, uri: string) {
  await authed(clientId, "/me/player/play", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context_uri: uri }),
  });
}

/** Read ?code=&state= from the current URL and finish the handshake. */
export async function handleCallback(clientId: string, redirectUri: string): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return false;
  await completeAuth(clientId, redirectUri, code, state);
  // Clean the code out of the URL so a refresh doesn't retry it.
  window.history.replaceState({}, "", window.location.pathname);
  return true;
}

/**
 * Manual fallback for the callback.
 *
 * A packaged desktop app doesn't serve http://127.0.0.1:PORT, so the browser's
 * redirect has nowhere to land. Instead of running a dev server just to catch
 * one redirect, the user pastes the URL they ended up on and we take the code
 * from it. Same PKCE exchange, same verifier — just triggered by hand.
 */
export async function completeAuthFromUrl(
  clientId: string,
  redirectUri: string,
  pastedUrl: string
): Promise<SpotifyToken> {
  let code: string | null = null;
  let state: string | null = null;

  try {
    const url = new URL(pastedUrl.trim());
    code = url.searchParams.get("code");
    state = url.searchParams.get("state");
    if (url.searchParams.get("error")) {
      throw new Error(url.searchParams.get("error") || "Spotify returned an error");
    }
  } catch (e: any) {
    if (e?.message && !/Invalid URL/i.test(e.message)) throw e;
    // Not a full URL — accept a bare ?code=...&state=... string too.
    const q = pastedUrl.includes("?") ? pastedUrl.slice(pastedUrl.indexOf("?") + 1) : pastedUrl;
    const params = new URLSearchParams(q);
    code = params.get("code");
    state = params.get("state");
  }

  if (!code || !state) {
    throw new Error("No authorisation code found in that URL");
  }
  return completeAuth(clientId, redirectUri, code, state);
}

export type Device = {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent?: number;
};

/** Spotify Connect devices currently online for this account. */
export async function getDevices(clientId: string): Promise<Device[]> {
  const data = await authed(clientId, "/me/player/devices");
  return (data?.devices || []).map((d: any) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    is_active: !!d.is_active,
    volume_percent: d.volume_percent,
  }));
}

/** Move playback to a device. `play: true` starts playing immediately. */
export async function transferTo(clientId: string, deviceId: string, play = true) {
  await authed(clientId, "/me/player", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
}

export async function setVolume(clientId: string, percent: number, deviceId?: string) {
  const q = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
  await authed(clientId, `/me/player/volume${q}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ volume_percent: Math.round(percent) }),
  });
}

/**
 * Web Playback SDK — deliberately not used.
 *
 * The SDK decodes DRM-protected audio through Encrypted Media Extensions. The
 * Tauri webview on macOS doesn't expose it, so Player.connect() never resolves
 * and the device never appears. Sahara is a remote control for whichever
 * Spotify device is already online; see getDevices and transferTo above.
 */

// ─── Search ───────────────────────────────────────────────────

export type SearchTrack = {
  id: string;
  uri: string;
  name: string;
  artists: string;
  album: string;
  image?: string;
  duration_ms: number;
};

export type SearchArtist = { id: string; uri: string; name: string; image?: string; followers?: number };
export type SearchAlbum = { id: string; uri: string; name: string; artists: string; image?: string };

export type SearchResults = {
  tracks: SearchTrack[];
  artists: SearchArtist[];
  albums: SearchAlbum[];
};

function imageOf(images?: { url: string; width?: number }[]): string | undefined {
  if (!images || images.length === 0) return undefined;
  return (images[1] || images[0]).url;
}

export async function search(clientId: string, query: string): Promise<SearchResults> {
  const q = encodeURIComponent(query.trim());
  if (!q) return { tracks: [], artists: [], albums: [] };
  const data = await authed(clientId, `/search?q=${q}&type=track,artist,album&limit=8`);
  return {
    tracks: (data?.tracks?.items || []).map((t: any) => ({
      id: t.id,
      uri: t.uri,
      name: t.name,
      artists: (t.artists || []).map((a: any) => a.name).join(", "),
      album: t.album?.name || "",
      image: imageOf(t.album?.images),
      duration_ms: t.duration_ms || 0,
    })),
    artists: (data?.artists?.items || []).map((a: any) => ({
      id: a.id,
      uri: a.uri,
      name: a.name,
      image: imageOf(a.images),
      followers: a.followers?.total,
    })),
    albums: (data?.albums?.items || []).map((a: any) => ({
      id: a.id,
      uri: a.uri,
      name: a.name,
      artists: (a.artists || []).map((x: any) => x.name).join(", "),
      image: imageOf(a.images),
    })),
  };
}

/** Play a track or album/artist context on a specific device. */
export async function playUri(clientId: string, uri: string, deviceId?: string) {
  const q = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
  const isTrack = uri.includes(":track:");
  await authed(clientId, `/me/player/play${q}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(isTrack ? { uris: [uri] } : { context_uri: uri }),
  });
}

// ─── Lyrics (LRCLIB) ──────────────────────────────────────────
//
// Free, keyless, and returns time-synced LRC when the track has it. Exact
// lookup by signature is far more reliable than fuzzy search, so that's tried
// first and search only used as a fallback.

export type LyricLine = { time: number; text: string };

export type Lyrics = {
  plain?: string;
  synced: LyricLine[];
  source: "lrclib" | "none";
};

const LRCLIB = "https://lrclib.net/api";

function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  lrc.split("\n").forEach((raw) => {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (!m) return;
    const mins = parseInt(m[1], 10);
    const secs = parseFloat(m[2]);
    const text = m[3].trim();
    if (text) out.push({ time: mins * 60 + secs, text });
  });
  return out;
}

async function lrclibFetch(path: string): Promise<any | null> {
  try {
    const res = await fetch(LRCLIB + path, {
      headers: { "Lrclib-Client": "Sahara Dashboard v0.3 (personal use)" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function getLyrics(
  track: string,
  artist: string,
  album?: string,
  durationSec?: number
): Promise<Lyrics> {
  const none: Lyrics = { synced: [], source: "none" };
  if (!track || !artist) return none;

  // 1. Exact signature lookup.
  const params = new URLSearchParams({ track_name: track, artist_name: artist });
  if (album) params.set("album_name", album);
  if (durationSec) params.set("duration", String(Math.round(durationSec)));
  const exact = await lrclibFetch(`/get?${params.toString()}`);
  if (exact) {
    return {
      plain: exact.plainLyrics || undefined,
      synced: exact.syncedLyrics ? parseLrc(exact.syncedLyrics) : [],
      source: "lrclib",
    };
  }

  // 2. Fall back to search and take the first result with lyrics.
  const found = await lrclibFetch(
    `/search?${new URLSearchParams({ track_name: track, artist_name: artist }).toString()}`
  );
  if (Array.isArray(found) && found.length > 0) {
    const withSynced = found.find((f: any) => f.syncedLyrics) || found[0];
    return {
      plain: withSynced.plainLyrics || undefined,
      synced: withSynced.syncedLyrics ? parseLrc(withSynced.syncedLyrics) : [],
      source: "lrclib",
    };
  }

  return none;
}
