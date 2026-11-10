import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Play, Pause, SkipForward, SkipBack, Music2, Link2, LogOut, RefreshCw } from "lucide-react";
import { motionTokens } from "../lib/design";
import {
  loadToken,
  beginAuth,
  getNowPlaying,
  transport,
  getPlaylists,
  playPlaylist,
  clearToken,
  completeAuthFromUrl,
  getDevices,
  transferTo,
  createPlayer,
  currentAccessToken,
  type NowPlaying,
  type Device,
} from "../lib/spotify";
import type { AppSettings } from "./SetupScreen";
import { openExternal, readFromClipboard } from "../lib/native";

type Props = {
  settings: AppSettings;
  notify: (msg: string, type?: string) => void;
};

type Playlist = { id: string; name: string; image?: string; tracks?: number; uri: string };

/**
 * The user's own Spotify account, controlled from the app.
 * Entirely separate from the bot's YouTube voice-channel playback.
 */
export default function SpotifyScreen({ settings, notify }: Props) {
  const [connected, setConnected] = useState(!!loadToken());
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [callbackError, setCallbackError] = useState<string>(() => {
    try {
      const e = sessionStorage.getItem("sahara_spotify_error") || "";
      if (e) sessionStorage.removeItem("sahara_spotify_error");
      return e;
    } catch {
      return "";
    }
  });
  const [pastedUrl, setPastedUrl] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [playerReady, setPlayerReady] = useState(false);
  const [sdkError, setSdkError] = useState("");

  const clientId = settings.spotifyClientId;
  const configured = !!clientId;

  const refresh = useCallback(async () => {
    if (!clientId || !loadToken()) return;
    try {
      const np = await getNowPlaying(clientId);
      setNow(np);
      const ds = await getDevices(clientId).catch(() => [] as Device[]);
      setDevices(ds);
      setDeviceId((cur) => cur || ds.find((d) => d.is_active)?.id || ds[0]?.id || "");
      setError("");
    } catch (e: any) {
      setError(e?.message || "Couldn't reach Spotify");
    }
  }, [clientId]);

  useEffect(() => {
    if (!connected) return;
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [connected, refresh]);

  useEffect(() => {
    if (!connected || !clientId) return;
    getPlaylists(clientId)
      .then(setPlaylists)
      .catch(() => {});
  }, [connected, clientId]);

  const connect = async () => {
    if (!configured) {
      notify("Add your Spotify Client ID in setup first", "error");
      return;
    }
    const url = await beginAuth(clientId, settings.spotifyRedirectUri);
    // The webview can't navigate to an external site — hand off to the browser,
    // then come back and paste the callback URL.
    await openExternal(url);
    setPasteMode(true);
  };

  const doTransport = async (action: "play" | "pause" | "next" | "previous") => {
    setBusy(action);
    try {
      await transport(clientId, action);
      await refresh();
    } catch (e: any) {
      notify(e?.message || "Spotify refused that", "error");
    } finally {
      setBusy(null);
    }
  };

  const startPlaylist = async (uri: string, name: string) => {
    setBusy(uri);
    try {
      await playPlaylist(clientId, uri);
      notify(`Playing ${name}`, "success");
      await refresh();
    } catch (e: any) {
      notify(e?.message || "Spotify refused that", "error");
    } finally {
      setBusy(null);
    }
  };

  const btn =
    "flex items-center justify-center gap-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40";

  if (!connected) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionTokens.enter}
        className="glass rounded-2xl p-8 max-w-xl"
      >
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-4">
          <Music2 className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Connect Spotify</h2>
        <p className="text-sm text-slate-400 leading-relaxed max-w-[65ch] mb-6">
          Control your own Spotify playback from here. Needs a Premium account, and a Client ID from
          the Spotify developer dashboard — add that in setup first.
        </p>
        {callbackError && (
          <p className="text-sm text-rose-300 mb-4 max-w-[65ch]">
            Last attempt failed: {callbackError}
          </p>
        )}
        {!configured && (
          <p className="text-sm text-amber-300 mb-4">
            No Client ID saved yet — open setup and add your Spotify credentials.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={connect}
            disabled={!configured}
            className={btn + " px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-sm hover:opacity-90"}
          >
            <Link2 className="w-4 h-4" /> Connect with Spotify
          </button>
          <button
            onClick={() => setPasteMode((v) => !v)}
            disabled={!configured}
            className="text-sm text-slate-400 hover:text-slate-200 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 rounded transition-colors"
          >
            {pasteMode ? "Cancel" : "Already approved? Paste the link"}
          </button>
        </div>

        {pasteMode && (
          <div className="mt-6 p-4 rounded-xl bg-slate-800/40 border border-slate-700/50">
            <p className="text-sm text-slate-300 mb-1">Paste the address you were sent to</p>
            <p className="text-xs text-slate-500 mb-3 max-w-[65ch]">
              After approving, your browser lands on a page that can&apos;t load — that&apos;s
              expected. Copy its full address and paste it here.
            </p>
            <button
              onClick={async () => {
                const text = await readFromClipboard();
                if (text) {
                  setPastedUrl(text);
                  notify("Pasted from clipboard", "success");
                } else {
                  notify("Nothing in the clipboard", "error");
                }
              }}
              className="mb-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-slate-700/50 text-slate-300 hover:bg-slate-600/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
            >
              Paste from clipboard
            </button>
            <textarea
              value={pastedUrl}
              onChange={(e) => setPastedUrl(e.target.value)}
              placeholder="http://127.0.0.1:5173/callback?code=..."
              rows={3}
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition resize-none"
            />
            <button
              onClick={async () => {
                if (!pastedUrl.trim()) return;
                setBusy("paste");
                try {
                  await completeAuthFromUrl(clientId, settings.spotifyRedirectUri, pastedUrl);
                  setConnected(true);
                  setPasteMode(false);
                  setPastedUrl("");
                  notify("Connected to Spotify", "success");
                } catch (e: any) {
                  notify(e?.message || "Couldn't finish connecting", "error");
                } finally {
                  setBusy(null);
                }
              }}
              disabled={busy !== null || !pastedUrl.trim()}
              className={btn + " mt-3 px-4 py-2 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 text-sm"}
            >
              Finish connecting
            </button>
          </div>
        )}
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Spotify</h2>
          <p className="text-sm text-slate-400 mt-1">Your account, your playback.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            aria-label="Refresh Spotify state"
            className="p-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              clearToken();
              setConnected(false);
              setNow(null);
              setPlaylists([]);
              notify("Disconnected from Spotify", "info");
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
          >
            <LogOut className="w-4 h-4" /> Disconnect
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-4 bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* This app as a playback device */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-medium">Play from this app</h3>
            <p className="text-sm text-slate-400 mt-1 max-w-[65ch]">
              Makes Sahara appear as a Spotify device, so audio comes out of this window
              instead of needing Spotify open elsewhere.
            </p>
          </div>
          <button
            onClick={async () => {
              if (playerReady) return;
              setBusy("sdk");
              try {
                const accessToken = await currentAccessToken(clientId);
                const player = await createPlayer(clientId, accessToken);
                player.addListener("ready", ({ device_id }: any) => {
                  setPlayerReady(true);
                  setDevices((d) => [
                    ...d.filter((x) => x.id !== device_id),
                    { id: device_id, name: "Sahara Dashboard", type: "Computer", is_active: false },
                  ]);
                  notify("Sahara is now a Spotify device", "success");
                });
                player.addListener("not_ready", () => setPlayerReady(false));
                player.addListener("initialization_error", ({ message }: any) =>
                  notify(message || "Playback init failed", "error")
                );
                player.addListener("authentication_error", () =>
                  notify("Spotify rejected the session — reconnect", "error")
                );
                player.addListener("account_error", () =>
                  notify("Playback needs Spotify Premium", "error")
                );
                const ok = await player.connect();
                if (!ok) throw new Error("Couldn't start the player");
              } catch (e: any) {
                const msg = e?.message || "Couldn't start in-app playback";
                notify(msg, "error");
                setSdkError(msg);
                console.error("[spotify] SDK enable failed", e);
              } finally {
                setBusy(null);
              }
            }}
            disabled={busy !== null || playerReady}
            className={
              btn +
              " shrink-0 px-4 py-2 text-sm " +
              (playerReady
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25")
            }
          >
            {playerReady ? "Ready" : busy === "sdk" ? "Starting…" : "Enable"}
          </button>
        </div>
        {playerReady && (
          <p className="text-xs text-emerald-300 mt-3">
            Pick &quot;Sahara Dashboard&quot; from the device list below to play through the app.
          </p>
        )}
        {sdkError && !playerReady && (
          <div className="mt-3 max-w-[65ch]">
            <p className="text-xs text-rose-300">{sdkError}</p>
            <p className="text-xs text-slate-500 mt-1">
              Full detail is in the developer console (right-click → Inspect → Console).
            </p>
          </div>
        )}
        {!playerReady && (
          <p className="text-xs text-slate-500 mt-3 max-w-[65ch]">
            Needs Spotify Premium. The SDK runs in a webview, so if this stays unavailable the app
            can still control whichever device is active below.
          </p>
        )}
      </div>

      {/* Device picker */}
      <div className="glass rounded-2xl p-5">
        <h3 className="font-medium mb-1">Playback device</h3>
        <p className="text-sm text-slate-400 mb-4 max-w-[65ch]">
          Spotify can only play on a device that&apos;s already online. Pick one here to move
          playback to it.
        </p>
        {devices.length === 0 ? (
          <p className="text-sm text-slate-500">
            No devices online. Open Spotify on your phone or Mac, or enable in-app playback above.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {devices.map((d) => (
              <button
                key={d.id}
                onClick={async () => {
                  setBusy(d.id);
                  try {
                    await transferTo(clientId, d.id, true);
                    setDeviceId(d.id);
                    notify(`Playing on ${d.name}`, "success");
                    await refresh();
                  } catch (e: any) {
                    notify(e?.message || "Couldn't switch device", "error");
                  } finally {
                    setBusy(null);
                  }
                }}
                disabled={busy !== null}
                className={
                  "px-3 py-2 rounded-lg text-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40 " +
                  (d.is_active || d.id === deviceId
                    ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-200"
                    : "bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-700/50")
                }
              >
                {d.name}
                <span className="text-xs text-slate-500 ml-2">{d.type.toLowerCase()}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Now playing */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center gap-4">
          {now?.image ? (
            <img src={now.image} alt="" className="w-20 h-20 rounded-lg object-cover bg-slate-800" />
          ) : (
            <div className="w-20 h-20 rounded-lg bg-slate-800 flex items-center justify-center">
              <Music2 className="w-7 h-7 text-slate-600" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate">{now?.track || "Nothing playing"}</p>
            <p className="text-sm text-slate-400 truncate">{now?.artists || "—"}</p>
            {now?.device && <p className="text-xs text-slate-500 mt-1">on {now.device}</p>}
          </div>
        </div>

        {now?.duration_ms && now?.progress_ms != null && (
          <div className="mt-4">
            <div className="h-1 rounded-full bg-slate-700 overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-[width] duration-500"
                style={{ width: `${Math.min(100, (now.progress_ms / now.duration_ms) * 100)}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mt-5">
          <button
            onClick={() => doTransport("previous")}
            disabled={busy !== null}
            aria-label="Previous track"
            className={btn + " p-2.5 bg-slate-700/50 text-slate-300 hover:bg-slate-600/60"}
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={() => doTransport(now?.is_playing ? "pause" : "play")}
            disabled={busy !== null}
            className={btn + " px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-sm hover:opacity-90"}
          >
            {now?.is_playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {now?.is_playing ? "Pause" : "Play"}
          </button>
          <button
            onClick={() => doTransport("next")}
            disabled={busy !== null}
            aria-label="Next track"
            className={btn + " p-2.5 bg-slate-700/50 text-slate-300 hover:bg-slate-600/60"}
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-500 mt-3 max-w-[65ch]">
          Playback happens on whichever Spotify device is currently active. Open Spotify on your
          phone or Mac first if nothing is playing.
        </p>
      </div>

      {/* Playlists */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-3">
          Your playlists {playlists.length > 0 && `(${playlists.length})`}
        </h3>
        {playlists.length === 0 ? (
          <p className="text-sm text-slate-500">No playlists found on this account.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => startPlaylist(p.uri, p.name)}
                disabled={busy !== null}
                className="group text-left rounded-xl overflow-hidden bg-slate-800/40 border border-slate-700/50 hover:border-indigo-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40 transition-colors"
              >
                {p.image ? (
                  <img src={p.image} alt="" className="w-full aspect-square object-cover" />
                ) : (
                  <div className="w-full aspect-square bg-slate-800 flex items-center justify-center">
                    <Music2 className="w-8 h-8 text-slate-600" />
                  </div>
                )}
                <div className="p-3">
                  <p className="text-sm font-medium truncate group-hover:text-indigo-300 transition-colors">
                    {p.name}
                  </p>
                  {p.tracks != null && (
                    <p className="text-xs text-slate-500 mt-0.5">{p.tracks} tracks</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.section>
  );
}
