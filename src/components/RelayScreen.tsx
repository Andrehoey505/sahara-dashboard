/**
 * The Texan relay: BabbleBot posting as itself, in Andre's words, only when he says.
 *
 * Three things live here and they are deliberately separate:
 *
 *  1. The switch. Off means nothing happens at all — the bot refuses before it reads
 *     a single field, so no message is stored and no trace is left.
 *  2. The review list. With the switch on, anything Texan wants to post waits here
 *     until Andre has read the words and approved or binned them. Nothing reaches
 *     Discord without that.
 *  3. Where it may post. Server and channel, stored by id, so renaming either in
 *     Discord changes nothing.
 *
 * The relay is a bot posting openly as a bot, labelled Texan. It is not a second
 * Discord account and it never pretends to be a member.
 */

import { useCallback, useEffect, useState } from "react";
import type { Server } from "../lib/servers";

type RelayConfig = {
  enabled: boolean;
  server: string;
  channel: string;
  last_seen: string;
};

type PendingPost = {
  id: string;
  created_at: string;
  text: string;
  channel_id: string;
  channel_name: string;
  server_id: string;
  server_name: string;
  status: "pending" | "approved" | "rejected" | "failed";
  message_id?: string;
  error?: string;
  decided_at?: string;
};

type Channel = {
  id: string;
  name: string;
  category?: string | null;
  category_id?: string | null;
  type?: string;
};

type Props = {
  apiUrl: string;
  servers: Server[];
  selectedServer: string;
  notify: (text: string, kind?: "info" | "error" | "success", opts?: { sound?: boolean }) => void;
};

const STATUS_STYLE: Record<string, { label: string; colour: string }> = {
  pending: { label: "Waiting for you", colour: "#f0b429" },
  approved: { label: "Posted", colour: "#4ade80" },
  rejected: { label: "Binned", colour: "#94a3b8" },
  failed: { label: "Couldn't post", colour: "#f87171" },
};

function when(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString();
}

export default function RelayScreen({ apiUrl, servers, selectedServer, notify }: Props) {
  const [config, setConfig] = useState<RelayConfig>({ enabled: false, server: "", channel: "", last_seen: "" });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelError, setChannelError] = useState("");
  const [posts, setPosts] = useState<PendingPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const loadConfig = useCallback(async () => {
    try {
      const r = await fetch(apiUrl + "/api/relay");
      if (!r.ok) throw new Error(`the bot answered ${r.status}`);
      setConfig(await r.json());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiUrl]);

  const loadPosts = useCallback(async () => {
    try {
      const r = await fetch(apiUrl + "/api/relay/pending?status=" + filter);
      if (!r.ok) throw new Error(`the bot answered ${r.status}`);
      const data = await r.json();
      setPosts(Array.isArray(data.messages) ? data.messages : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiUrl, filter]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.all([loadConfig(), loadPosts()]);
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [loadConfig, loadPosts]);

  // Channels for whichever server the relay is pointed at. A relay with no channel
  // is a relay that cannot post, so the list has to follow the picker.
  useEffect(() => {
    const server = config.server || selectedServer;
    if (!server) {
      setChannels([]);
      return;
    }
    (async () => {
      try {
        const r = await fetch(apiUrl + "/api/channels?server=" + encodeURIComponent(server));
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          // Say WHY, rather than showing an empty dropdown that looks like a server
          // with no channels.
          setChannelError(
            (data && (data.error || data.message)) || `the bot answered ${r.status}`,
          );
          setChannels([]);
          return;
        }
        // The bot returns a bare array. Accept the wrapped shape too, because a
        // silent empty list is indistinguishable from a server with no channels.
        const list = Array.isArray(data) ? data : Array.isArray(data?.channels) ? data.channels : [];
        setChannels(list.filter((c: Channel) => !c.type || c.type === "text"));
        setChannelError(list.length === 0 ? "the bot returned no text channels for this server" : "");
      } catch {
        setChannels([]);
      }
    })();
  }, [apiUrl, config.server, selectedServer]);

  // Poll the review list only while the relay is on: off means nothing can arrive,
  // so there is nothing to ask about, and asking anyway is noise on the bot.
  useEffect(() => {
    if (!config.enabled) return;
    const t = setInterval(() => {
      void loadPosts();
    }, 10000);
    return () => clearInterval(t);
  }, [config.enabled, loadPosts]);

  // The relay stays on until Andre turns it off, and nothing else turns it off.
  //
  // It used to switch itself off on visibilitychange and on window blur. Both were
  // wrong: changing screens inside the app is using the app, and clicking another
  // window is not closing anything. A relay that disarms itself whenever you look
  // away is a relay you cannot trust to be on when you want it.
  //
  // Turning it off is one act, and it belongs to the person who turned it on.

  const save = async (patch: Partial<RelayConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    setBusy("save");
    try {
      const r = await fetch(apiUrl + "/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `the bot answered ${r.status}`);
      setConfig(data);
      notify(next.enabled ? "Relay on — nothing posts without your say-so" : "Relay off — nothing will be stored or posted", "success", { sound: false });
      void loadPosts();
    } catch (e) {
      notify("Couldn't save the relay switch — " + (e instanceof Error ? e.message : String(e)), "error");
      await loadConfig();
    } finally {
      setBusy("");
    }
  };

  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusy(id + decision);
    try {
      const r = await fetch(apiUrl + "/api/relay/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, by: "andre" }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `the bot answered ${r.status}`);
      notify(decision === "approve" ? "Posted in Discord" : "Binned — it will never be posted", "success", { sound: false });
      await loadPosts();
    } catch (e) {
      notify("That didn't work — " + (e instanceof Error ? e.message : String(e)), "error");
      await loadPosts();
    } finally {
      setBusy("");
    }
  };

  const remove = async (id: string) => {
    setBusy(id + "delete");
    try {
      const r = await fetch(apiUrl + "/api/relay/pending/" + encodeURIComponent(id), { method: "DELETE" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `the bot answered ${r.status}`);
      notify("Deleted — the message is gone from the database entirely", "success", { sound: false });
      await loadPosts();
    } catch (e) {
      notify("Couldn't delete it — " + (e instanceof Error ? e.message : String(e)), "error");
      await loadPosts();
    } finally {
      setBusy("");
    }
  };

  const serverName = (id: string) => servers.find((s) => s.id === id)?.name || id || "—";
  const channelName = (id: string) => channels.find((c) => c.id === id)?.name || id || "not set";
  const pendingCount = posts.filter((p) => p.status === "pending").length;

  if (loading) {
    return (
      <div style={{ padding: 32, color: "var(--text-dim)" }}>
        <div className="spinner" style={{ marginBottom: 12 }} />
        Reading the relay…
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 28px", maxWidth: 900 }}>
      <header style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: -0.3 }}>Texan relay</h1>
        <p style={{ margin: "6px 0 0", color: "var(--text-dim)", fontSize: 13.5, lineHeight: 1.5 }}>
          Lets Texan answer in a channel as BabbleBot — openly labelled, never posing as a member.
          Every message waits here for your yes first. Bin keeps a record that it was stopped;
          Delete removes it from the database entirely.
        </p>
      </header>

      {error && (
        <div
          style={{
            marginBottom: 18,
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(248,113,113,0.12)",
            border: "1px solid rgba(248,113,113,0.35)",
            color: "#fca5a5",
            fontSize: 13,
          }}
        >
          Couldn't reach the bot: {error}
        </div>
      )}

      {/* ── the switch ─────────────────────────────────────────────────── */}
      <section
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "18px 20px",
          borderRadius: 14,
          marginBottom: 18,
          background: config.enabled ? "rgba(74,222,128,0.08)" : "var(--surface-2, rgba(255,255,255,0.03))",
          border: `1px solid ${config.enabled ? "rgba(74,222,128,0.35)" : "var(--border, rgba(255,255,255,0.08))"}`,
        }}
      >
        <button
          onClick={() => void save({ enabled: !config.enabled })}
          disabled={busy === "save"}
          aria-pressed={config.enabled}
          title={config.enabled ? "Turn the relay off" : "Turn the relay on"}
          style={{
            width: 52,
            height: 30,
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            flexShrink: 0,
            position: "relative",
            background: config.enabled ? "#4ade80" : "rgba(148,163,184,0.45)",
            transition: "background 180ms ease",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: config.enabled ? 25 : 3,
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 180ms cubic-bezier(0.2,0.8,0.2,1)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
            }}
          />
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5 }}>{config.enabled ? "Relay is on" : "Relay is off"}</div>
          <div style={{ color: "var(--text-dim)", fontSize: 12.5, marginTop: 2 }}>
            {config.enabled
              ? "Texan can leave messages for you. Nothing reaches Discord until you approve it. It stays on until you switch it off."
              : "Nothing happens at all — no messages stored, nothing posted, not even a row in the database."}
          </div>
        </div>
      </section>

      {/* ── where it may post ──────────────────────────────────────────── */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--text-dim)", margin: "0 0 10px" }}>
          Where it may post
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "block" }}>
            <span style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 5 }}>Server</span>
            <select
              value={config.server}
              onChange={(e) => void save({ server: e.target.value, channel: "" })}
              disabled={busy === "save"}
              style={inputStyle}
            >
              <option value="">Pick a server…</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "block" }}>
            <span style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 5 }}>Channel</span>
            <select
              value={config.channel}
              onChange={(e) => void save({ channel: e.target.value })}
              disabled={busy === "save" || !config.server}
              style={inputStyle}
            >
              <option value="">{config.server ? "Pick a channel…" : "Pick a server first"}</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.category ? `${c.category} / ` : ""}#{c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {channelError && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: "#f0b429" }}>
            Couldn't load the channel list: {channelError}
          </div>
        )}
        {config.channel && !channels.some((c) => c.id === config.channel) && channels.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: "#f0b429" }}>
            That channel no longer exists in {serverName(config.server)} — pick another or the relay can't post.
          </div>
        )}
        {!config.channel && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-dim)" }}>
            Currently {channelName(config.channel)}. The relay can't post until a channel is picked.
          </div>
        )}
      </section>

      {/* ── the review list ────────────────────────────────────────────── */}
      <section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--text-dim)", margin: 0 }}>
            Before anything posts {pendingCount > 0 && <span style={{ color: "#f0b429" }}>· {pendingCount} waiting</span>}
          </h2>
          <div style={{ display: "flex", gap: 6 }}>
            {(["pending", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                title={f === "pending" ? "Only what's still waiting" : "Everything, including what you binned"}
                style={{
                  padding: "5px 11px",
                  borderRadius: 8,
                  fontSize: 12,
                  cursor: "pointer",
                  border: "1px solid var(--border, rgba(255,255,255,0.1))",
                  background: filter === f ? "rgba(124,107,245,0.22)" : "transparent",
                  color: filter === f ? "#c7bfff" : "var(--text-dim)",
                }}
              >
                {f === "pending" ? "Waiting" : "All"}
              </button>
            ))}
          </div>
        </div>

        {posts.length === 0 ? (
          <div
            style={{
              padding: "22px 20px",
              borderRadius: 12,
              border: "1px dashed var(--border, rgba(255,255,255,0.1))",
              color: "var(--text-dim)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            {filter === "pending"
              ? config.enabled
                ? "Nothing waiting. Anything Texan wants to post will appear here first."
                : "The relay is off, so nothing can arrive."
              : "Nothing here yet."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {posts.map((p) => {
              const st = STATUS_STYLE[p.status] || STATUS_STYLE.pending;
              return (
                <article
                  key={p.id}
                  style={{
                    padding: "14px 16px",
                    borderRadius: 12,
                    background: "var(--surface-2, rgba(255,255,255,0.03))",
                    border: "1px solid var(--border, rgba(255,255,255,0.08))",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12 }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: st.colour + "22",
                        color: st.colour,
                        fontWeight: 600,
                      }}
                    >
                      {st.label}
                    </span>
                    <span style={{ color: "var(--text-dim)" }}>
                      #{p.channel_name} · {when(p.created_at)}
                    </span>
                  </div>

                  <p
                    style={{
                      margin: "0 0 10px",
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      color: "var(--text, #e6e6ea)",
                    }}
                  >
                    {p.text}
                  </p>

                  {p.error && (
                    <div style={{ fontSize: 12, color: "#fca5a5", marginBottom: 10 }}>Couldn't post: {p.error}</div>
                  )}

                  {p.status === "pending" && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => void decide(p.id, "approve")}
                        disabled={busy === p.id + "approve"}
                        title="Post this in Discord now"
                        style={{ ...btn, background: "rgba(74,222,128,0.16)", color: "#86efac", borderColor: "rgba(74,222,128,0.4)" }}
                      >
                        {busy === p.id + "approve" ? "Posting…" : "Approve & post"}
                      </button>
                      <button
                        onClick={() => void decide(p.id, "reject")}
                        disabled={busy === p.id + "reject"}
                        title="Never post this — it's kept as binned so you know it happened"
                        style={{ ...btn, background: "transparent", color: "#fca5a5", borderColor: "rgba(248,113,113,0.35)" }}
                      >
                        Bin it
                      </button>
                      <button
                        onClick={() => void remove(p.id)}
                        disabled={busy === p.id + "delete"}
                        title="Remove it from the database entirely — the words are gone, not just marked as binned"
                        style={{ ...btn, background: "transparent", color: "var(--text-dim)", borderColor: "var(--border, rgba(255,255,255,0.12))" }}
                      >
                        {busy === p.id + "delete" ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 9,
  fontSize: 13,
  background: "var(--surface-2, rgba(255,255,255,0.04))",
  color: "var(--text, #e6e6ea)",
  border: "1px solid var(--border, rgba(255,255,255,0.1))",
  outline: "none",
};

const btn: React.CSSProperties = {
  padding: "7px 13px",
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid transparent",
};
