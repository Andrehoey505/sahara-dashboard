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
  type NowPlaying,
} from "../lib/spotify";
import type { AppSettings } from "./SetupScreen";

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

  const clientId = settings.spotifyClientId;
  const configured = !!clientId;

  const refresh = useCallback(async () => {
    if (!clientId || !loadToken()) return;
    try {
      const np = await getNowPlaying(clientId);
      setNow(np);
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
    window.location.href = url;
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
        {!configured && (
          <p className="text-sm text-amber-300 mb-4">
            No Client ID saved yet — open setup and add your Spotify credentials.
          </p>
        )}
        <button
          onClick={connect}
          disabled={!configured}
          className={btn + " px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-sm hover:opacity-90"}
        >
          <Link2 className="w-4 h-4" /> Connect with Spotify
        </button>
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
