import React, { useEffect, useMemo, useState } from "react";
import { Hash, Server, AlertTriangle, RefreshCw, Bell, BellOff } from "lucide-react";

/**
 * Where the schedule goes.
 *
 * Two settings, both stored per server: which channel the day is posted into, and
 * whether the bot should nag there. The server comes from the dashboard's own
 * active-server picker — a schedule belongs to a server, and posting today's list
 * into the wrong one is the kind of thing that is funny once and annoying after.
 *
 * The app is the source of truth for what's ticked. This screen only decides where
 * that gets mirrored, so if nothing is chosen the schedule still works perfectly —
 * it just doesn't leave the Mac.
 */

type Props = {
  apiUrl: string;
  notify: (message: string, kind?: "success" | "error" | "info") => void;
  servers: any[];
  selectedServer: string;
};

const KEY = "sahara_schedule_channel_v1";
const PICKED_SERVER_KEY = "sahara_schedule_server_v1";

type Store = Record<string, { channelId: string; channelName: string; nag: boolean }>;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export default function ScheduleSettings({ apiUrl, notify, servers, selectedServer }: Props) {
  const [store, setStore] = useState<Store>(() => load());
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string>(() => {
    try {
      return localStorage.getItem(PICKED_SERVER_KEY) || "";
    } catch {
      return "";
    }
  });

  // The schedule remembers its own server. Falling back to the dashboard's active
  // server means it starts somewhere sensible, but a choice made here sticks —
  // picking a channel for Babble Playpen shouldn't evaporate because the app is
  // looking at a different server an hour later.
  const serverId = picked || selectedServer || servers[0]?.id || "";
  const serverName = servers.find((s) => s.id === serverId)?.name || serverId;
  const current = store[serverId] || { channelId: "", channelName: "", nag: false };

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(apiUrl + "/api/channels?server=" + encodeURIComponent(serverName))
      .then(async (r) => {
        if (!r.ok) throw new Error("The bot couldn't list this server's channels");
        const data = await r.json();
        if (!cancelled) setChannels(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "Couldn't reach the bot");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, serverName, serverId]);

  const textChannels = useMemo(
    () => channels.filter((c) => c.type === "text" || c.type === 0),
    [channels]
  );

  const update = (patch: Partial<{ channelId: string; channelName: string; nag: boolean }>) => {
    const next: Store = {
      ...store,
      [serverId]: {
        ...current,
        ...patch,
      },
    };
    setStore(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  };

  const pickServer = (id: string) => {
    setPicked(id);
    try {
      localStorage.setItem(PICKED_SERVER_KEY, id);
    } catch {}
    setChannels([]);
  };

  const pickChannel = (id: string) => {
    const found = textChannels.find((c) => String(c.id) === id);
    update({ channelId: id, channelName: found?.name || "" });
    notify(id ? `Schedule will post to #${found?.name || id}` : "Schedule stays on this Mac", "success");
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium flex items-center gap-2 mb-1">
          <Server className="w-4 h-4 text-indigo-400" /> Where the day goes
        </h3>
        <p className="text-xs text-slate-400">
          The schedule always works in the app. This only decides whether it also appears in a Discord
          channel so staff can see how the day is going.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-200 px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
          <button
            onClick={() => setChannels([])}
            className="ml-auto text-rose-300 hover:text-rose-100"
            aria-label="Dismiss"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs text-slate-400 flex items-center gap-1.5">
          <Server className="w-3.5 h-3.5" /> Server
        </label>
        <select
          value={serverId}
          onChange={(e) => pickServer(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
          data-tip="Which server the schedule belongs to"
        >
          {servers.length === 0 && <option value="">No servers found</option>}
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-slate-400 flex items-center gap-1.5">
          <Hash className="w-3.5 h-3.5" /> Channel
        </label>
        <select
          value={current.channelId}
          onChange={(e) => pickChannel(e.target.value)}
          disabled={loading}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-50"
          data-tip="Stored by ID, so renaming the channel changes nothing"
        >
          <option value="">{loading ? "Reading channels…" : "Not posted anywhere — app only"}</option>
          {textChannels.map((c) => (
            <option key={c.id} value={String(c.id)}>
              # {c.name}
            </option>
          ))}
        </select>
        {current.channelId && !textChannels.some((c) => String(c.id) === current.channelId) && !loading && (
          <p className="text-xs text-amber-300/80 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            Set to {current.channelId}, which isn't a channel the bot can see. It may have been deleted.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2.5">
        <div className="flex items-start gap-3">
          {current.nag ? (
            <Bell className="w-4 h-4 text-amber-300 mt-0.5" />
          ) : (
            <BellOff className="w-4 h-4 text-slate-500 mt-0.5" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm">Nudge in Discord when something's overdue</div>
            <p className="text-xs text-slate-500 mt-0.5">
              Staff can also nag you themselves — that's their job, not the bot's. This is only the
              bot's own nudge.
            </p>
          </div>
          <button
            onClick={() => update({ nag: !current.nag })}
            className={
              "shrink-0 text-xs px-2.5 py-1 rounded-lg border transition " +
              (current.nag
                ? "bg-amber-500/20 border-amber-500/40 text-amber-200"
                : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700/70")
            }
            data-tip="Off by default — the app already nags you"
          >
            {current.nag ? "On" : "Off"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2.5">
        <p className="text-xs text-slate-400">
          <strong className="text-slate-200">Staff can see, but can't tick.</strong> Ticking in Discord
          would silence your own reminder for something you hadn't done, so the app stays the only
          place a thing gets marked done.
        </p>
      </div>
    </div>
  );
}
