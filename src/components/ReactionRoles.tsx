import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, Save, RefreshCw, Smile } from "lucide-react";
import { motionTokens } from "../lib/design";

type RoleMapping = { emoji: string; role_id: string };

type ServerConfig = {
  message_id: string;
  channel_id: string;
  reaction_type: string;
  toggle: boolean;
  role_mappings: RoleMapping[];
};

type Props = {
  apiUrl: string;
  servers: { id: string; name: string }[];
  notify: (msg: string, type?: string) => void;
};

const REACTION_TYPES = [
  { id: "role_assignment", label: "Role assignment" },
  { id: "verification", label: "Verification" },
  { id: "notification", label: "Notification toggle" },
];

const field =
  "w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition";

const emptyConfig: ServerConfig = {
  message_id: "",
  channel_id: "",
  reaction_type: "role_assignment",
  toggle: false,
  role_mappings: [{ emoji: "", role_id: "" }],
};

/**
 * Editor for reaction-role config.
 *
 * The bot reads reaction_roles.json on every reaction, so saving here takes
 * effect immediately — no restart needed.
 */
export default function ReactionRoles({ apiUrl, servers, notify }: Props) {
  const [configs, setConfigs] = useState<Record<string, ServerConfig>>({});
  const [selected, setSelected] = useState<string>("");
  const [draft, setDraft] = useState<ServerConfig>(emptyConfig);
  const [roles, setRoles] = useState<{ id: string; name: string; assignable?: boolean; color?: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl + "/api/reaction-roles");
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      setConfigs(data?.servers || {});
      setError("");
    } catch {
      setError("Couldn't reach the bot API — is the Windows laptop awake?");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    load();
  }, [load]);

  // Pick a server by default once the list arrives.
  useEffect(() => {
    if (!selected && servers.length > 0) setSelected(servers[0].id);
  }, [servers, selected]);

  // Load that server's config into the editor.
  useEffect(() => {
    if (!selected) return;
    const existing = configs[selected];
    setDraft(existing ? { ...existing, role_mappings: existing.role_mappings.length ? existing.role_mappings : [{ emoji: "", role_id: "" }] } : { ...emptyConfig });
  }, [selected, configs]);

  // Roles for the dropdown, from /api/roles.
  const [rolesError, setRolesError] = useState("");
  const [canManage, setCanManage] = useState(true);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setRolesError("");
    fetch(apiUrl + "/api/roles?server=" + encodeURIComponent(selected))
      .then((r) => {
        if (!r.ok) throw new Error("bad status");
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setRoles(data.roles || []);
        setCanManage(data.can_manage_roles !== false);
      })
      .catch(() => {
        if (cancelled) return;
        setRoles([]);
        setRolesError(
          "Couldn't load the role list. The bot needs the /api/roles endpoint — it lives on Babblebot's abacus/roles-endpoint branch and won't exist until that's merged and the bot restarted. Falling back to raw role IDs."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, selected]);

  const setMapping = (i: number, patch: Partial<RoleMapping>) => {
    setDraft((d) => ({
      ...d,
      role_mappings: d.role_mappings.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
    }));
  };

  const addRow = () =>
    setDraft((d) => ({ ...d, role_mappings: [...d.role_mappings, { emoji: "", role_id: "" }] }));

  const removeRow = (i: number) =>
    setDraft((d) => ({ ...d, role_mappings: d.role_mappings.filter((_, idx) => idx !== i) }));

  const save = async () => {
    if (!selected) return;
    const cleaned = draft.role_mappings.filter((m) => m.emoji.trim() && m.role_id.trim());
    if (!draft.message_id.trim()) {
      notify("A message ID is required", "error");
      return;
    }
    if (cleaned.length === 0) {
      notify("Add at least one emoji and role ID", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(apiUrl + "/api/reaction-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: selected,
          message_id: draft.message_id.trim(),
          channel_id: draft.channel_id.trim(),
          reaction_type: draft.reaction_type,
          toggle: draft.toggle,
          role_mappings: cleaned,
        }),
      });
      const data = await res.json();
      if (data.success) {
        notify("Reaction roles saved", "success");
        setConfigs(data.servers || {});
      } else {
        notify(data.error || "Failed", "error");
      }
    } catch {
      notify("Connection failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const label = "block text-sm font-medium text-slate-300 mb-2";

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Reaction roles</h2>
          <p className="text-sm text-slate-400 mt-1">
            Assign roles when members react to a message. Saves take effect immediately.
          </p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh reaction roles"
          className="p-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="rounded-xl p-4 bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      {!loading && servers.length === 0 && (
        <p className="text-sm text-slate-500">No servers available.</p>
      )}

      {servers.length > 0 && (
        <div className="glass rounded-2xl p-5 space-y-5">
          <div>
            <label htmlFor="rr-server" className={label}>
              Server
            </label>
            <select
              id="rr-server"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className={field}
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="rr-message" className={label}>
                Message ID
              </label>
              <input
                id="rr-message"
                value={draft.message_id}
                onChange={(e) => setDraft((d) => ({ ...d, message_id: e.target.value }))}
                placeholder="Right-click the message → Copy ID"
                spellCheck={false}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="rr-channel" className={label}>
                Channel ID <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <input
                id="rr-channel"
                value={draft.channel_id}
                onChange={(e) => setDraft((d) => ({ ...d, channel_id: e.target.value }))}
                spellCheck={false}
                className={field}
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="rr-type" className={label}>
                Behaviour
              </label>
              <select
                id="rr-type"
                value={draft.reaction_type}
                onChange={(e) => setDraft((d) => ({ ...d, reaction_type: e.target.value }))}
                className={field}
              >
                {REACTION_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-end gap-3 pb-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.toggle}
                onChange={(e) => setDraft((d) => ({ ...d, toggle: e.target.checked }))}
                className="w-4 h-4 accent-indigo-500 rounded"
              />
              <span className="text-sm text-slate-300">
                Exclusive — picking one removes the others
              </span>
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <span className={label + " mb-0"}>Emoji → role</span>
              <button
                onClick={addRow}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            <div className="space-y-2">
              {draft.role_mappings.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="relative w-24 shrink-0">
                    <Smile className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      value={m.emoji}
                      onChange={(e) => setMapping(i, { emoji: e.target.value })}
                      placeholder="🎮"
                      aria-label={`Emoji ${i + 1}`}
                      className={field + " pl-8 text-center"}
                    />
                  </div>
                  {roles.length > 0 ? (
                    <select
                      value={m.role_id}
                      onChange={(e) => setMapping(i, { role_id: e.target.value })}
                      aria-label={`Role ${i + 1}`}
                      className={field}
                    >
                      <option value="">Pick a role…</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id} disabled={r.assignable === false}>
                          {r.name}
                          {r.assignable === false ? " — can't assign" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={m.role_id}
                      onChange={(e) => setMapping(i, { role_id: e.target.value })}
                      placeholder="Role ID"
                      aria-label={`Role ID ${i + 1}`}
                      spellCheck={false}
                      className={field}
                    />
                  )}
                  <button
                    onClick={() => removeRow(i)}
                    aria-label={`Remove mapping ${i + 1}`}
                    className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {rolesError && (
              <p className="text-xs text-amber-300 mt-3 max-w-[65ch]">{rolesError}</p>
            )}
            {!canManage && (
              <p className="text-xs text-amber-300 mt-3 max-w-[65ch]">
                The bot is missing Manage Roles in this server, so reactions won't actually assign
                anything until that permission is granted.
              </p>
            )}
            <p className="text-xs text-slate-500 mt-3 max-w-[65ch]">
              Roles the bot can&apos;t assign are greyed out — usually they sit above the bot&apos;s
              own role, or are managed by an integration. Custom emoji need the full form, e.g.{" "}
              <code className="text-slate-400">name:id</code>.
            </p>
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 font-semibold text-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-40 transition"
          >
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </motion.section>
  );
}
