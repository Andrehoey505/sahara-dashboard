import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  Search,
  Send,
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  Loader2,
  VolumeX,
  Ban,
  UserMinus,
  Clock,
} from "lucide-react";
import { motionTokens } from "../lib/design";

/**
 * Moderation, done from the app.
 *
 * The old panel asked you to type a user ID and a server name from memory, into a
 * hard-coded list of four servers, and then said "Server not found" when either
 * was wrong. Everything here comes from the API: the servers the bot is actually
 * in, the members of the server you pick, and the channels of that server. You
 * choose; you never type an id.
 *
 * A warning is a record first and a message second — the bot saves it before it
 * DMs — so the result panel reports what actually happened rather than "success".
 */

type Props = {
  apiUrl: string;
  notify: (msg: string, type?: string) => void;
  servers: { id: string; name: string }[];
  /** The server selected in the app's own picker, if any. */
  selectedServer?: string;
};

type Member = {
  id: string;
  name: string;
  display_name?: string;
  avatar_url?: string;
  is_bot?: boolean;
  is_exempt?: boolean;
  exempt_reason_label?: string;
  violation_count?: number;
  warning_count?: number;
  /** The servers this member is in, as names. Absent means "unknown". */
  guilds?: string[];
};

type Channel = { id: string; name: string; type: string };

type Warning = {
  timestamp?: string;
  guild_name?: string;
  user_id?: string;
  user_name?: string;
  reason?: string;
  issued_by?: string;
};

const ACTIONS = [
  { id: "warn", label: "Warn", icon: AlertTriangle, hint: "DM a warning and keep the record" },
  { id: "timeout", label: "Timeout", icon: Clock, hint: "Stop them posting for a while" },
  { id: "mute", label: "Mute", icon: VolumeX, hint: "Silence them in voice" },
  { id: "kick", label: "Kick", icon: UserMinus, hint: "Remove from the server, they can rejoin" },
  { id: "ban", label: "Ban", icon: Ban, hint: "Remove and block from rejoining" },
] as const;

const DESTRUCTIVE = new Set(["kick", "ban"]);

export default function ModerationScreen({ apiUrl, notify, servers, selectedServer }: Props) {
  const [server, setServer] = useState(selectedServer || "");
  const [members, setMembers] = useState<Member[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Member | null>(null);
  const [action, setAction] = useState<string>("warn");
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string>("");

  const [channel, setChannel] = useState("");
  const [channelMessage, setChannelMessage] = useState("");
  const [sending, setSending] = useState(false);

  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [warningsFor, setWarningsFor] = useState<string>("");

  // Follow the app's server picker, but let this screen choose its own too.
  useEffect(() => {
    if (selectedServer && selectedServer !== server) setServer(selectedServer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer]);

  useEffect(() => {
    let gone = false;
    (async () => {
      const res = await fetch(apiUrl + "/api/members").catch(() => null);
      if (!res || !res.ok) return;
      const list = await res.json().catch(() => []);
      if (!gone && Array.isArray(list)) setMembers(list);
    })();
    return () => {
      gone = true;
    };
  }, [apiUrl]);

  useEffect(() => {
    setChannel("");
    if (!server) {
      setChannels([]);
      return;
    }
    let gone = false;
    (async () => {
      const res = await fetch(apiUrl + "/api/channels?server=" + encodeURIComponent(server)).catch(
        () => null,
      );
      const list = res ? await res.json().catch(() => []) : [];
      if (!gone) setChannels(Array.isArray(list) ? list : []);
    })();
    return () => {
      gone = true;
    };
  }, [apiUrl, server]);

  const loadWarnings = async (userId: string) => {
    setWarningsFor(userId);
    const url =
      apiUrl + "/api/warnings?limit=50" + (userId ? "&user=" + encodeURIComponent(userId) : "");
    const res = await fetch(url).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = members.filter((m) => {
      if (!server) return true;
      // A member with no guild list still shows: better to offer them and be told
      // they are not in this server than to hide someone who is.
      if (!m.guilds || m.guilds.length === 0) return true;
      return m.guilds.some((g) => g.toLowerCase() === server.toLowerCase());
    });
    if (q) {
      list = list.filter(
        (m) =>
          (m.display_name || "").toLowerCase().includes(q) ||
          (m.name || "").toLowerCase().includes(q) ||
          m.id.includes(q),
      );
    }
    return list.slice(0, 40);
  }, [members, query, server]);

  const run = async () => {
    if (!target) return notify("Pick who this is for", "error");
    if (!server) return notify("Pick a server first", "error");
    if (!reason.trim()) return notify("Give a reason — it goes in the record", "error");
    if (DESTRUCTIVE.has(action)) {
      const who = target.display_name || target.name;
      if (!window.confirm(`${action === "ban" ? "Ban" : "Kick"} ${who}? This takes effect immediately.`))
        return;
    }
    setBusy(true);
    setLastResult("");
    try {
      const body = {
        action,
        target_id: target.id,
        server,
        reason: reason.trim(),
        duration: action === "timeout" ? minutes : 0,
        issued_by: "dashboard",
      };
      const endpoint = action === "warn" ? "/api/warn" : "/api/moderation-action";
      const res = await fetch(apiUrl + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        notify(data.error || `That did not work (${res.status})`, "error");
        setLastResult(data.error || `Failed with status ${res.status}`);
        return;
      }
      const who = data.user || target.display_name || target.name;
      if (action === "warn") {
        const line = data.dm_delivered
          ? `Warning ${data.warning_number} recorded and DM'd to ${who}.`
          : `Warning ${data.warning_number} recorded. ${data.detail || "The DM did not land."}`;
        setLastResult(line);
        notify(line, data.dm_delivered ? "success" : "info");
      } else {
        const line = `${action} applied to ${who}.`;
        setLastResult(line);
        notify(line, "success");
      }
      setReason("");
      loadWarnings(target.id);
    } catch (e: any) {
      notify("Connection failed — is the bot running?", "error");
      setLastResult(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const sendToChannel = async () => {
    if (!server) return notify("Pick a server first", "error");
    if (!channel) return notify("Pick a channel", "error");
    if (!channelMessage.trim()) return notify("Type a message first", "error");
    setSending(true);
    try {
      const res = await fetch(apiUrl + "/api/channel-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server, channel, message: channelMessage.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        notify(`Sent to #${data.channel}`, "success");
        setChannelMessage("");
      } else {
        notify(data.error || "That did not send", "error");
      }
    } catch {
      notify("Connection failed — is the bot running?", "error");
    } finally {
      setSending(false);
    }
  };

  const textChannels = channels.filter((c) => c.type === "text");

  return (
    <div className="space-y-4">
      {/* Server */}
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-indigo-300" />
          <h3 className="font-semibold text-sm">Where</h3>
        </div>
        <select
          value={server}
          onChange={(e) => {
            setServer(e.target.value);
            setTarget(null);
          }}
          className="w-full px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
          data-tip="The server this action applies in — the bot's real list, not a typed name"
        >
          <option value="">Select a server…</option>
          {servers.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        {servers.length === 0 && (
          <p className="text-xs text-amber-300/80 mt-2">
            No servers came back from the bot. Check the connection in Settings.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Who + what */}
        <motion.div
          className="glass rounded-2xl p-4"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={motionTokens.enter}
        >
          <h3 className="font-semibold text-sm mb-3">Who</h3>
          <div className="relative mb-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a member by name or id"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
              data-tip="Find the member here instead of pasting their id"
            />
          </div>
          <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-800 divide-y divide-slate-800/60">
            {filtered.length === 0 && (
              <p className="text-xs text-slate-500 p-3">
                {members.length === 0 ? "No members loaded from the bot yet." : "Nobody matches that."}
              </p>
            )}
            {filtered.map((m) => {
              const picked = target?.id === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setTarget(m);
                    loadWarnings(m.id);
                  }}
                  className={
                    "w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition " +
                    (picked ? "bg-indigo-500/20 text-indigo-100" : "hover:bg-slate-800/50")
                  }
                  data-tip={`Choose ${m.display_name || m.name} for the action`}
                >
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px]">
                      {(m.display_name || m.name || "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="flex-1 truncate">{m.display_name || m.name}</span>
                  {m.is_bot && <span className="text-[10px] text-slate-500">bot</span>}
                  {m.is_exempt && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300"
                      title={m.exempt_reason_label || "Exempt from moderation"}
                    >
                      exempt
                    </span>
                  )}
                  {typeof m.violation_count === "number" && m.violation_count > 0 && (
                    <span className="text-[10px] text-rose-300">{m.violation_count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {target && (
            <div className="mt-3 rounded-xl bg-slate-800/40 p-3">
              <p className="text-sm font-medium">{target.display_name || target.name}</p>
              <p className="text-[11px] text-slate-500 font-mono">{target.id}</p>
              {target.is_exempt && (
                <p className="text-[11px] text-emerald-300 mt-1">
                  Exempt — the bot will refuse to moderate them. Lift it in Members.
                </p>
              )}
            </div>
          )}
        </motion.div>

        {/* Action */}
        <motion.div
          className="glass rounded-2xl p-4"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...motionTokens.enter, delay: 0.04 }}
        >
          <h3 className="font-semibold text-sm mb-3">What</h3>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {ACTIONS.map((a) => {
              const Icon = a.icon;
              const on = action === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setAction(a.id)}
                  className={
                    "flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition border " +
                    (on
                      ? DESTRUCTIVE.has(a.id)
                        ? "bg-rose-500/20 border-rose-500/40 text-rose-200"
                        : "bg-indigo-500/20 border-indigo-500/40 text-indigo-100"
                      : "border-slate-800 hover:bg-slate-800/50")
                  }
                  data-tip={a.hint}
                >
                  <Icon className="w-4 h-4" />
                  {a.label}
                </button>
              );
            })}
          </div>

          {action === "timeout" && (
            <div className="mb-3">
              <label className="text-xs text-slate-400 block mb-1">Minutes</label>
              <input
                type="number"
                min={1}
                max={40320}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value) || 10)}
                className="w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                data-tip="How long the timeout lasts, in minutes"
              />
            </div>
          )}

          <label className="text-xs text-slate-400 block mb-1">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What did they do? This goes in the record."
            rows={3}
            className="w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 resize-none"
            data-tip="Required — a warning with no reason is not a record you can act on later"
          />

          <button
            onClick={run}
            disabled={busy}
            className={
              "mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50 " +
              (DESTRUCTIVE.has(action)
                ? "bg-rose-500/20 text-rose-200 hover:bg-rose-500/30"
                : "bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30")
            }
            data-tip={
              action === "warn"
                ? "Record the warning and DM them"
                : `Apply this ${action} to the member you picked`
            }
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {busy ? "Working…" : `Apply ${action}`}
          </button>

          {lastResult && (
            <p className="mt-2 text-xs text-slate-300 flex items-start gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-300" />
              {lastResult}
            </p>
          )}
        </motion.div>
      </div>

      {/* Send to a channel */}
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-4 h-4 text-purple-300" />
          <h3 className="font-semibold text-sm">Send a message to a channel</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-purple-500"
            data-tip="Pick the channel — this is the server's real channel list"
          >
            <option value="">Select a channel…</option>
            {textChannels.map((c) => (
              <option key={c.id} value={c.name}>
                #{c.name}
              </option>
            ))}
          </select>
          <textarea
            value={channelMessage}
            onChange={(e) => setChannelMessage(e.target.value)}
            placeholder="Message to post"
            rows={2}
            className="md:col-span-2 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-purple-500 resize-none"
            data-tip="This is posted as the bot, in the channel you picked"
          />
        </div>
        <button
          onClick={sendToChannel}
          disabled={sending}
          className="mt-3 flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/20 text-purple-200 text-sm hover:bg-purple-500/30 transition disabled:opacity-50"
          data-tip="Post the message in that channel now"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {sending ? "Sending…" : "Send to channel"}
        </button>
        {textChannels.length === 0 && server && (
          <p className="text-xs text-slate-500 mt-2">No text channels came back for that server.</p>
        )}
      </div>

      {/* Records */}
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-300" />
            <h3 className="font-semibold text-sm">
              {warningsFor ? "Warnings on record" : "Warnings on record (everyone)"}
            </h3>
          </div>
          <button
            onClick={() => loadWarnings(warningsFor)}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 transition"
            data-tip="Reload the warning records from the bot's database"
          >
            Refresh
          </button>
        </div>
        {warnings.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nothing loaded yet — pick a member, or press Refresh for the latest.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {warnings.map((w, i) => (
              <div key={i} className="rounded-xl bg-slate-800/40 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">{w.user_name || w.user_id}</span>
                  <span className="text-[11px] text-slate-500">
                    {w.timestamp ? String(w.timestamp).slice(0, 16).replace("T", " ") : ""}
                  </span>
                </div>
                <p className="text-xs text-slate-300">{w.reason || "no reason given"}</p>
                <p className="text-[11px] text-slate-500">
                  {w.guild_name} · by {w.issued_by || "unknown"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
