import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Play,
  Pause,
  SkipForward,
  Square,
  Volume2,
  Music2,
  RefreshCw,
  Plus,
  ListMusic,
  Users,
  Lock,
  Trash2,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { motionTokens } from "../lib/design";

/**
 * The bot's music, from the app.
 *
 * Two things make this different from a remote control:
 *
 * 1. It knows whether YOU are listening. Your Discord id is the one the app is
 *    connected as; the bot reports who is in the voice channel it is in. If your
 *    id is in that list the controls are live. If it isn't, the screen still shows
 *    what is playing and where — but read-only, because skipping a song you cannot
 *    hear is not something you should be able to do to a channel full of people.
 *
 * 2. Playlists are the bot's own. Same store Discord writes to, so a playlist made
 *    here plays with `bb!music playlist play <name>`, and one built in Discord
 *    shows up here.
 */

type Song = { title?: string; url?: string; duration?: number; requester?: string };
type Listener = { id: string; name: string };

type QueueState = {
  guild_id: string;
  guild_name: string;
  bot_channel: { id: string; name: string } | null;
  members: Listener[];
  now_playing: Song | null;
  queue: Song[];
  volume: number;
  is_playing: boolean;
};

type Playlist = { name: string; count: number; songs: Song[] };

type Props = {
  apiUrl: string;
  notify: (msg: string, type?: string) => void;
  /** The Discord id the app is connected as. */
  userId?: string;
  servers: { id: string; name: string }[];
  selectedServer?: string;
};

const fmtDuration = (secs?: number) => {
  if (!secs || secs < 0) return "";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default function MusicScreen({ apiUrl, notify, userId, servers, selectedServer }: Props) {
  const [server, setServer] = useState(selectedServer || servers[0]?.name || "");
  const [state, setState] = useState<QueueState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [newName, setNewName] = useState("");
  const [openPlaylist, setOpenPlaylist] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<{ playlist: string; query: string } | null>(null);

  useEffect(() => {
    if (selectedServer && selectedServer !== server) setServer(selectedServer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer]);

  const loadState = useCallback(async () => {
    if (!server) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl + "/api/music/queue?server=" + encodeURIComponent(server));
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setState(null);
        notify(data.error, "error");
      } else {
        setState(data);
      }
    } catch {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, server, notify]);

  const loadPlaylists = useCallback(async () => {
    try {
      const res = await fetch(apiUrl + "/api/playlists");
      const data = await res.json().catch(() => []);
      setPlaylists(Array.isArray(data) ? data : []);
    } catch {
      setPlaylists([]);
    }
  }, [apiUrl]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  // Every 10s: the queue changes when a track ends, without anyone touching the app.
  useEffect(() => {
    if (!server) return;
    const t = setInterval(loadState, 10000);
    return () => clearInterval(t);
  }, [server, loadState]);

  const iAmListening = useMemo(() => {
    if (!userId || !state) return false;
    return (state.members || []).some((m) => m.id === userId);
  }, [userId, state]);

  const canControl = iAmListening || !state?.bot_channel;

  const control = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!state) return;
    setBusy(action);
    try {
      const res = await fetch(apiUrl + "/api/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, guild_id: state.guild_id, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        notify(`${action} done`, "success");
        loadState();
      } else {
        notify(data.error || `That did not work (${res.status})`, "error");
      }
    } catch {
      notify("Connection failed — is the bot running?", "error");
    } finally {
      setBusy(null);
    }
  };

  const addSong = async () => {
    if (!state) return notify("Pick a server first", "error");
    if (!query.trim()) return notify("Type a song name or a YouTube link", "error");
    setBusy("add");
    try {
      const res = await fetch(apiUrl + "/api/music/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: state.guild_name, query: query.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        notify(`Queued ${data.title || "that"}`, "success");
        setQuery("");
        loadState();
      } else {
        notify(data.error || "Could not add that", "error");
      }
    } catch {
      notify("Connection failed — is the bot running?", "error");
    } finally {
      setBusy(null);
    }
  };

  const queuePlaylist = async (name: string) => {
    if (!state) return notify("Pick a server first", "error");
    setBusy("play-" + name);
    try {
      const res = await fetch(apiUrl + "/api/music/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: state.guild_name, playlist: name }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        notify(`Added ${data.added} from "${name}"`, "success");
        loadState();
      } else {
        notify(data.error || "Could not queue that playlist", "error");
      }
    } finally {
      setBusy(null);
    }
  };

  const playlistAction = async (action: string, body: Record<string, unknown>) => {
    setBusy(action + (body.name || ""));
    try {
      const res = await fetch(apiUrl + "/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        await loadPlaylists();
      } else {
        notify(data.error || "That did not work", "error");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Server */}
      <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <Music2 className="w-4 h-4 text-indigo-300" />
        <select
          value={server}
          onChange={(e) => setServer(e.target.value)}
          className="px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
          data-tip="Which server's music you are looking at"
        >
          <option value="">Select a server…</option>
          {servers.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={loadState}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 text-sm hover:bg-slate-800 transition"
          data-tip="Reload what the bot is playing right now"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
        {state?.bot_channel && (
          <span className="text-xs text-slate-400 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            in <span className="text-indigo-300">#{state.bot_channel.name}</span>
            {state.members.length > 0 && ` · ${state.members.length} listening`}
          </span>
        )}
        {state?.bot_channel && !iAmListening && (
          <span
            className="text-xs px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300 flex items-center gap-1.5"
            data-tip="You are not in that voice channel, so this is read-only"
          >
            <Lock className="w-3.5 h-3.5" />
            not listening — read only
          </span>
        )}
      </div>

      {/* Now playing + controls */}
      <motion.div
        className="glass rounded-2xl p-4"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionTokens.enter}
      >
        {state?.now_playing ? (
          <>
            <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Now playing</p>
            <p className="text-lg font-semibold">{state.now_playing.title}</p>
            <p className="text-xs text-slate-500">
              {fmtDuration(state.now_playing.duration)}
              {state.now_playing.requester ? ` · asked by ${state.now_playing.requester}` : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-500">
            {server ? "Nothing playing in that server." : "Pick a server to see its music."}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button
            onClick={() => control("pause")}
            disabled={!canControl || !state?.now_playing}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 text-sm hover:bg-slate-800 transition disabled:opacity-40"
            data-tip="Pause or resume the current track"
          >
            <Pause className="w-4 h-4" /> Pause
          </button>
          <button
            onClick={() => control("skip")}
            disabled={!canControl || !state?.now_playing}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 text-sm hover:bg-slate-800 transition disabled:opacity-40"
            data-tip="Skip to the next song in the queue"
          >
            <SkipForward className="w-4 h-4" /> Skip
          </button>
          <button
            onClick={() => control("stop")}
            disabled={!canControl || !state?.bot_channel}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/15 text-rose-300 text-sm hover:bg-rose-500/25 transition disabled:opacity-40"
            data-tip="Stop the music and leave the voice channel"
          >
            <Square className="w-4 h-4" /> Stop
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <Volume2 className="w-4 h-4 text-slate-400" />
            <input
              type="range"
              min={0}
              max={100}
              value={state?.volume ?? 50}
              onChange={(e) => control("volume", { volume: Number(e.target.value) })}
              disabled={!canControl}
              className="w-28 accent-indigo-500"
              data-tip="The bot's volume in this server"
            />
            <span className="text-xs text-slate-400 w-8">{state?.volume ?? 50}%</span>
          </div>
        </div>
      </motion.div>

      {/* Add to the queue */}
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Plus className="w-4 h-4 text-emerald-300" />
          <h3 className="font-semibold text-sm">Add to the queue</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addSong();
            }}
            placeholder="Song name or a YouTube link"
            className="flex-1 min-w-[220px] px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-emerald-500"
            data-tip="The bot looks this up on YouTube and adds what it finds"
          />
          <button
            onClick={addSong}
            disabled={busy === "add"}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/20 text-emerald-200 text-sm hover:bg-emerald-500/30 transition disabled:opacity-50"
            data-tip="Queue this song at the end, without interrupting what is playing"
          >
            {busy === "add" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Queue it
          </button>
        </div>
        {!canControl && state?.bot_channel && (
          <p className="text-[11px] text-amber-300/80 mt-2">
            Adding still works while you are not listening — it only changes what plays next.
          </p>
        )}
      </div>

      {/* Queue */}
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <ListMusic className="w-4 h-4 text-indigo-300" />
          <h3 className="font-semibold text-sm">
            Queue {state && state.queue.length > 0 && <span className="text-slate-500">({state.queue.length})</span>}
          </h3>
        </div>
        {!state || state.queue.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nothing waiting. Add a song above, or queue a playlist below.
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {state.queue.map((song, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-800/40">
                <span className="text-xs text-slate-500 w-5">{i + 1}</span>
                <span className="flex-1 truncate text-sm">{song.title}</span>
                <span className="text-[11px] text-slate-500">{fmtDuration(song.duration)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Playlists */}
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <ListMusic className="w-4 h-4 text-purple-300" />
          <h3 className="font-semibold text-sm">Playlists</h3>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New playlist name"
            className="flex-1 min-w-[180px] px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-purple-500"
            data-tip="Names are lower-case and shared with the bot, so Discord can play them too"
          />
          <button
            onClick={async () => {
              if (!newName.trim()) return notify("Give it a name", "error");
              await playlistAction("create", { name: newName.trim() });
              setNewName("");
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/20 text-purple-200 text-sm hover:bg-purple-500/30 transition"
            data-tip="Create an empty playlist, then add songs to it"
          >
            <Plus className="w-4 h-4" /> Create
          </button>
        </div>

        {playlists.length === 0 ? (
          <p className="text-xs text-slate-500">No playlists yet.</p>
        ) : (
          <div className="space-y-2">
            {playlists.map((p) => {
              const open = openPlaylist === p.name;
              return (
                <div key={p.name} className="rounded-xl bg-slate-800/40">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      onClick={() => setOpenPlaylist(open ? null : p.name)}
                      className="flex items-center gap-2 flex-1 text-left"
                      data-tip="Show the songs in this playlist"
                    >
                      <ChevronDown className={"w-4 h-4 transition " + (open ? "rotate-180" : "")} />
                      <span className="text-sm font-medium">{p.name}</span>
                      <span className="text-[11px] text-slate-500">{p.count} songs</span>
                    </button>
                    <button
                      onClick={() => queuePlaylist(p.name)}
                      disabled={busy === "play-" + p.name || p.count === 0}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs hover:bg-emerald-500/25 transition disabled:opacity-40"
                      data-tip="Add every song in this playlist to the queue"
                    >
                      {busy === "play-" + p.name ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      Queue
                    </button>
                    <button
                      onClick={() => {
                        setAddingTo({ playlist: p.name, query: "" });
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-700/50 text-slate-300 text-xs hover:bg-slate-700 transition"
                      data-tip="Add a song to this playlist"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Song
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete the playlist "${p.name}" and its ${p.count} songs?`))
                          playlistAction("delete", { name: p.name });
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 text-xs hover:bg-rose-500/20 transition"
                      data-tip="Delete this playlist — this cannot be undone"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {open && (
                    <div className="px-3 pb-3 space-y-1">
                      {p.songs.length === 0 && <p className="text-xs text-slate-500">Empty.</p>}
                      {p.songs.map((song, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <span className="text-[11px] text-slate-500 w-4">{i + 1}</span>
                          <span className="flex-1 truncate">{song.title}</span>
                          <button
                            onClick={() => playlistAction("remove", { name: p.name, index: i })}
                            className="text-rose-300/70 hover:text-rose-300"
                            data-tip="Remove this song from the playlist"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {addingTo?.playlist === p.name && (
                    <div className="px-3 pb-3 flex gap-2">
                      <input
                        autoFocus
                        value={addingTo.query}
                        onChange={(e) => setAddingTo({ ...addingTo, query: e.target.value })}
                        onKeyDown={async (e) => {
                          if (e.key !== "Enter") return;
                          if (!addingTo.query.trim()) return;
                          await playlistAction("add", { name: p.name, query: addingTo.query.trim() });
                          setAddingTo(null);
                        }}
                        placeholder="Song name or link, then Enter"
                        className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700 text-sm focus:outline-none focus:border-purple-500"
                        data-tip="The bot looks this up and stores what it finds"
                      />
                      <button
                        onClick={() => setAddingTo(null)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-700/50 text-slate-300 text-xs"
                        data-tip="Stop adding songs"
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
