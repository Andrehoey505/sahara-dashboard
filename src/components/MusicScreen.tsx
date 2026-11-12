import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Play, Pause, SkipForward, Square, Volume2, Music2, RefreshCw } from "lucide-react";
import { motionTokens } from "../lib/design";

type GuildMusic = {
  guild_id: string;
  guild_name: string;
  now_playing: { title?: string; url?: string; duration?: string; requester?: string } | null;
  queue_length: number;
  volume: number;
};

type Props = { apiUrl: string; notify: (msg: string, type?: string) => void };

/**
 * Controls the bot's YouTube playback in a Discord voice channel.
 * Separate from the app's own Spotify integration.
 */
export default function MusicScreen({ apiUrl, notify }: Props) {
  const [guilds, setGuilds] = useState<GuildMusic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl + "/api/music");
      if (!res.ok) throw new Error("bad status");
      const data = await res.json().catch(() => ({}));
      setGuilds(Array.isArray(data) ? data : []);
      setError("");
    } catch {
      setError("Couldn't reach the bot API — is the Windows laptop awake?");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const control = async (guildId: string, action: string, extra?: Record<string, unknown>) => {
    setBusy(guildId + action);
    try {
      const res = await fetch(apiUrl + "/api/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, guild_id: guildId, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        notify(action === "stop" ? "Stopped" : action[0].toUpperCase() + action.slice(1), "success");
        load();
      } else {
        notify(data.error || "Failed", "error");
      }
    } catch {
      notify("Connection failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const btn =
    "flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40";

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Music</h2>
          <p className="text-sm text-slate-400 mt-1">
            Babblebot&apos;s voice channel playback. Your Spotify library is separate.
          </p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh music state"
          className="p-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
        
            data-tip="Reload the player">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="rounded-xl p-4 bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      {!loading && !error && guilds.length === 0 && (
        <div className="glass rounded-2xl p-10 text-center border border-dashed border-slate-700">
          <Music2 className="w-8 h-8 mx-auto text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">
            Nothing playing in any server. Start a track with the bot in Discord and it&apos;ll show
            up here.
          </p>
        </div>
      )}

      {guilds.map((g) => (
        <div key={g.guild_id} className="glass rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-slate-500">{g.guild_name}</p>
              <p className="font-medium truncate mt-1">
                {g.now_playing?.title || "Nothing playing"}
              </p>
              {g.now_playing && (
                <p className="text-xs text-slate-500 mt-1">
                  {g.now_playing.duration || ""}
                  {g.now_playing.requester ? ` · requested by ${g.now_playing.requester}` : ""}
                </p>
              )}
            </div>
            <span className="shrink-0 text-xs px-2 py-1 rounded bg-slate-800/60 text-slate-400">
              {g.queue_length} in queue
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => control(g.guild_id, "resume")}
              disabled={busy !== null || !g.now_playing}
              className={btn + " bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"}
             data-tip="Resume">
              <Play className="w-4 h-4" /> Play
            </button>
            <button
              onClick={() => control(g.guild_id, "pause")}
              disabled={busy !== null || !g.now_playing}
              className={btn + " bg-slate-700/50 text-slate-300 hover:bg-slate-600/60"}
             data-tip="Pause">
              <Pause className="w-4 h-4" /> Pause
            </button>
            <button
              onClick={() => control(g.guild_id, "skip")}
              disabled={busy !== null || !g.now_playing}
              className={btn + " bg-slate-700/50 text-slate-300 hover:bg-slate-600/60"}
             data-tip="Skip this track">
              <SkipForward className="w-4 h-4" /> Skip
            </button>
            <button
              onClick={() => control(g.guild_id, "stop")}
              disabled={busy !== null}
              className={btn + " bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"}
             data-tip="Stop and clear the queue">
              <Square className="w-4 h-4" /> Stop
            </button>

            <label className="flex items-center gap-2 ml-auto text-sm text-slate-400">
              <Volume2 className="w-4 h-4" />
              <input
                type="range"
                min={0}
                max={100}
                defaultValue={g.volume}
                aria-label={`Volume for ${g.guild_name}`}
                onMouseUp={(e) =>
                  control(g.guild_id, "volume", { volume: Number((e.target as HTMLInputElement).value) })
                }
                onTouchEnd={(e) =>
                  control(g.guild_id, "volume", { volume: Number((e.target as HTMLInputElement).value) })
                }
                className="w-28 accent-indigo-500"
              />
              <span className="tabular-nums w-8 text-right">{g.volume}</span>
            </label>
          </div>
        </div>
      ))}
    </motion.section>
  );
}
