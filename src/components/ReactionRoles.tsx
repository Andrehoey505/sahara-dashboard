import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  Save,
  RefreshCw,
  Smile,
  BadgeCheck,
  Bell,
  Tags,
  AlertTriangle,
  Check,
  Copy,
  Hash,
  Lock,
  ChevronDown,
  ShieldQuestion,
} from "lucide-react";
import { motionTokens } from "../lib/design";
import type { Server } from "../lib/servers";

type RoleMapping = { emoji: string; role_id: string; label?: string };

type Panel = {
  message_id: string;
  channel_id: string;
  reaction_type: string;
  toggle: boolean;
  role_mappings: RoleMapping[];
  updated_at?: string;
};

type Role = { id: string; name: string; assignable?: boolean; color?: string | null };

type Props = {
  apiUrl: string;
  server: Server | undefined;
  servers: Server[];
  notify: (msg: string, type?: string) => void;
};

const TYPES = [
  {
    id: "role_assignment",
    label: "Role assignment",
    icon: Tags,
    hint: "React to get a role, unreact to lose it. The usual self-roles setup.",
    accent: "text-indigo-300",
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/40",
  },
  {
    id: "verification",
    label: "Verification",
    icon: BadgeCheck,
    hint: "React once to be let in. The role stays even if they remove the reaction.",
    accent: "text-emerald-300",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
  },
  {
    id: "notification",
    label: "Notification toggle",
    icon: Bell,
    hint: "React to subscribe, react again to unsubscribe.",
    accent: "text-amber-300",
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
  },
];

const typeOf = (id: string) => TYPES.find((t) => t.id === id) || TYPES[0];

const field =
  "w-full px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/30 transition";

const card = "rounded-2xl border border-slate-700/60 bg-slate-900/60 backdrop-blur";

const emptyPanel = (): Panel => ({
  message_id: "",
  channel_id: "",
  reaction_type: "role_assignment",
  toggle: false,
  role_mappings: [{ emoji: "", role_id: "", label: "" }],
});

export default function ReactionRoles({ apiUrl, server, servers, notify }: Props) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [draft, setDraft] = useState<Panel>(emptyPanel());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesError, setRolesError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const serverId = server?.id || "";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl + "/api/reaction-roles");
      if (!res.ok) throw new Error(`the bot answered ${res.status}`);
      const data = await res.json();
      const entry = data?.servers?.[serverId];
      // Both store shapes: an old single config, or a list of panels.
      const list: Panel[] = Array.isArray(entry?.panels)
        ? entry.panels
        : entry?.message_id
        ? [entry]
        : [];
      setPanels(list);
    } catch (e: any) {
      setError(
        e?.message?.includes("fetch")
          ? "Couldn't reach the bot — check the API address in Settings."
          : e?.message || "Couldn't load reaction roles."
      );
      setPanels([]);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, serverId]);

  useEffect(() => {
    if (serverId) load();
  }, [load, serverId]);

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    setRolesError("");
    fetch(apiUrl + "/api/roles?server=" + encodeURIComponent(serverId))
      .then((r) => {
        if (!r.ok) throw new Error(`the bot answered ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setRoles(Array.isArray(data.roles) ? data.roles : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setRoles([]);
        // The old copy told people to merge a branch that is already merged.
        setRolesError(
          e?.message?.includes("fetch")
            ? "Couldn't reach the bot, so role names aren't available. You can still type a role id."
            : "The bot didn't return a role list. You can still type a role id."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, serverId]);

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name;
  const roleUsable = (id: string) => {
    const r = roles.find((x) => x.id === id);
    return !r || r.assignable !== false;
  };

  const duplicateEmoji = useMemo(() => {
    const seen = new Set<string>();
    for (const m of draft.role_mappings) {
      const e = m.emoji.trim();
      if (!e) continue;
      if (seen.has(e)) return e;
      seen.add(e);
    }
    return null;
  }, [draft.role_mappings]);

  const startNew = () => {
    setDraft(emptyPanel());
    setEditingIndex(null);
  };

  const startEdit = (i: number) => {
    setDraft({ ...panels[i], role_mappings: panels[i].role_mappings.map((m) => ({ ...m })) });
    setEditingIndex(i);
  };

  const setMapping = (i: number, patch: Partial<RoleMapping>) =>
    setDraft((d) => ({
      ...d,
      role_mappings: d.role_mappings.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
    }));

  const addRow = () =>
    setDraft((d) => ({ ...d, role_mappings: [...d.role_mappings, { emoji: "", role_id: "", label: "" }] }));

  const removeRow = (i: number) =>
    setDraft((d) => ({ ...d, role_mappings: d.role_mappings.filter((_, idx) => idx !== i) }));

  const save = async () => {
    if (!serverId) return;
    if (!draft.message_id.trim()) {
      notify("A message ID is required — right-click the message and Copy Message ID", "error");
      return;
    }
    if (duplicateEmoji) {
      notify(`${duplicateEmoji} is used twice — one emoji can only give one role`, "error");
      return;
    }
    const cleaned = draft.role_mappings.filter((m) => m.emoji.trim() && m.role_id.trim());
    if (cleaned.length === 0) {
      notify("Add at least one emoji and role", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(apiUrl + "/api/reaction-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: serverId,
          message_id: draft.message_id.trim(),
          channel_id: draft.channel_id.trim(),
          reaction_type: draft.reaction_type,
          toggle: draft.toggle,
          role_mappings: cleaned.map((m) => ({
            emoji: m.emoji.trim(),
            role_id: m.role_id.trim(),
            label: (m.label || "").trim(),
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        notify(data.error || "Couldn't save", "error");
        return;
      }
      notify(editingIndex === null ? "Panel added" : "Panel updated", "success");
      startNew();
      await load();
    } catch {
      notify("Connection failed — is the bot reachable?", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (messageId: string) => {
    setSaving(true);
    try {
      const res = await fetch(
        apiUrl + "/api/reaction-roles/" + encodeURIComponent(serverId) + "/" + encodeURIComponent(messageId),
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        notify(data.error || "Couldn't remove it", "error");
        return;
      }
      notify("Panel removed", "success");
      setConfirmDelete(null);
      if (editingIndex !== null && panels[editingIndex]?.message_id === messageId) startNew();
      await load();
    } catch {
      notify("Connection failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      notify("Copied", "success");
    } catch {
      notify("Couldn't copy", "error");
    }
  };

  if (!server) {
    return (
      <div className={card + " p-8 text-center text-sm text-slate-400"}>
        Pick a server above to manage its reaction roles.
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/60 border border-slate-700">
            <Tags className="w-3.5 h-3.5 text-indigo-300" />
            <span className="text-sm text-slate-200">
              {panels.length} panel{panels.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/60 border border-slate-700">
            <Smile className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-sm text-slate-300">
              {panels.reduce((n, p) => n + p.role_mappings.length, 0)} reactions
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-slate-200 hover:bg-slate-700/60 transition"
          >
            <RefreshCw className={"w-4 h-4 " + (loading ? "animate-spin" : "")} />
            Refresh
          </button>
          <button
            onClick={startNew}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-600/20 border border-indigo-500/40 text-sm text-indigo-200 hover:bg-indigo-600/30 transition"
          >
            <Plus className="w-4 h-4" />
            New panel
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Existing panels */}
      {loading && panels.length === 0 ? (
        <div className={card + " p-8 text-center text-sm text-slate-400"}>Loading…</div>
      ) : panels.length === 0 ? (
        <div className={card + " p-8 flex flex-col items-center gap-2 text-center"}>
          <Smile className="w-8 h-8 text-slate-600" />
          <p className="text-sm text-slate-400">No reaction-role panels on this server yet.</p>
          <p className="text-xs text-slate-500">
            Post a message in Discord, then add it here with its message ID.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {panels.map((p, i) => {
            const t = typeOf(p.reaction_type);
            const Icon = t.icon;
            return (
              <motion.div
                key={p.message_id}
                layout
                className={
                  card + " p-4 flex flex-wrap items-center gap-4 " + (editingIndex === i ? t.border : "")
                }
              >
                <div className={"p-2 rounded-xl " + t.bg}>
                  <Icon className={"w-4 h-4 " + t.accent} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-100 flex items-center gap-2">
                    {t.label}
                    {p.toggle && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300">
                        one at a time
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                    <Hash className="w-3 h-3" />
                    {p.message_id}
                    <button
                      onClick={() => copyId(p.message_id)}
                      className="hover:text-slate-300 transition"
                      title="Copy message id"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {p.role_mappings.map((m) => (
                      <span
                        key={m.emoji + m.role_id}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800/70 border border-slate-700 text-xs text-slate-300"
                        title={roleUsable(m.role_id) ? undefined : "The bot can't assign this role"}
                      >
                        <span>{m.emoji}</span>
                        <span className="text-slate-500">→</span>
                        <span className={roleUsable(m.role_id) ? "" : "text-amber-300"}>
                          {m.label || roleName(m.role_id) || m.role_id}
                        </span>
                        {!roleUsable(m.role_id) && <Lock className="w-3 h-3 text-amber-400" />}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(i)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-xs text-slate-200 hover:bg-slate-700/60 transition"
                  >
                    Edit
                  </button>
                  {confirmDelete === p.message_id ? (
                    <button
                      onClick={() => remove(p.message_id)}
                      disabled={saving}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-xs text-rose-200 hover:bg-rose-500/30 transition"
                    >
                      {saving ? "Removing…" : "Really remove"}
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(p.message_id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-300 transition"
                      title="Remove this panel"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Editor */}
      <div className={card + " p-5 space-y-4"}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            {editingIndex === null ? "New panel" : "Editing panel"}
          </h3>
          {editingIndex !== null && (
            <button onClick={startNew} className="text-xs text-slate-400 hover:text-slate-200 transition">
              Cancel
            </button>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1.5">Message ID</span>
            <input
              value={draft.message_id}
              onChange={(e) => setDraft({ ...draft, message_id: e.target.value })}
              placeholder="Right-click the message → Copy Message ID"
              className={field}
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1.5">
              Channel ID <span className="text-slate-600">(optional)</span>
            </span>
            <input
              value={draft.channel_id}
              onChange={(e) => setDraft({ ...draft, channel_id: e.target.value })}
              placeholder="Only needed if two messages share an id"
              className={field}
            />
          </label>
        </div>

        <div>
          <span className="block text-xs font-medium text-slate-400 mb-1.5">What reacting does</span>
          <div className="grid sm:grid-cols-3 gap-2">
            {TYPES.map((t) => {
              const Icon = t.icon;
              const on = draft.reaction_type === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setDraft({ ...draft, reaction_type: t.id })}
                  className={
                    "text-left p-3 rounded-xl border transition " +
                    (on ? t.bg + " " + t.border : "border-slate-700/60 hover:border-slate-600")
                  }
                >
                  <span className="flex items-center gap-2 text-sm text-slate-100">
                    <Icon className={"w-4 h-4 " + (on ? t.accent : "text-slate-500")} />
                    {t.label}
                  </span>
                  <span className="block text-[11px] text-slate-400 mt-1 leading-snug">{t.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {draft.reaction_type === "role_assignment" && (
          <button
            onClick={() => setDraft({ ...draft, toggle: !draft.toggle })}
            className={
              "flex items-center gap-3 w-full p-3 rounded-xl border text-left transition " +
              (draft.toggle ? "border-indigo-500/40 bg-indigo-500/10" : "border-slate-700/60")
            }
          >
            <span
              className={
                "w-9 h-5 rounded-full relative transition " + (draft.toggle ? "bg-indigo-500" : "bg-slate-700")
              }
            >
              <span
                className={
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all " +
                  (draft.toggle ? "left-4.5" : "left-0.5")
                }
              />
            </span>
            <span className="flex-1">
              <span className="block text-sm text-slate-100">One role at a time</span>
              <span className="block text-[11px] text-slate-400">
                Picking one takes the others in this panel away.
              </span>
            </span>
          </button>
        )}

        <div>
          <span className="block text-xs font-medium text-slate-400 mb-1.5">Emoji → role</span>
          <div className="space-y-2">
            {draft.role_mappings.map((m, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  value={m.emoji}
                  onChange={(e) => setMapping(i, { emoji: e.target.value })}
                  placeholder="👍"
                  className={field + " w-16 text-center"}
                  aria-label="Emoji"
                />
                <div className="relative flex-1 min-w-[160px]">
                  {roles.length > 0 ? (
                    <select
                      value={m.role_id}
                      onChange={(e) => setMapping(i, { role_id: e.target.value })}
                      className={field + " appearance-none pr-8"}
                      aria-label="Role"
                    >
                      <option value="">Choose a role…</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                          {r.assignable === false ? " (the bot can't assign this)" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={m.role_id}
                      onChange={(e) => setMapping(i, { role_id: e.target.value })}
                      placeholder="Role ID"
                      className={field}
                      aria-label="Role ID"
                    />
                  )}
                  {roles.length > 0 && (
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  )}
                </div>
                <input
                  value={m.label || ""}
                  onChange={(e) => setMapping(i, { label: e.target.value })}
                  placeholder="Label (optional)"
                  className={field + " w-36"}
                  aria-label="Label"
                />
                <button
                  onClick={() => removeRow(i)}
                  className="p-2 rounded-lg text-slate-500 hover:text-rose-300 transition"
                  title="Remove this row"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addRow}
            className="mt-2 flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Add another emoji
          </button>
        </div>

        {rolesError && (
          <p className="flex items-start gap-2 text-xs text-amber-300/90">
            <ShieldQuestion className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {rolesError}
          </p>
        )}
        {duplicateEmoji && (
          <p className="flex items-center gap-2 text-xs text-rose-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            {duplicateEmoji} is used twice — one emoji can only give one role.
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={save}
            disabled={saving || !!duplicateEmoji}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white transition"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Saving…" : editingIndex === null ? "Add panel" : "Save changes"}
          </button>
          <span className="text-xs text-slate-500">Takes effect immediately — no restart.</span>
        </div>
      </div>

      {servers.length > 1 && (
        <p className="text-xs text-slate-500">
          Showing {server.name}. Change it in the bar above.
        </p>
      )}
    </motion.div>
  );
}
