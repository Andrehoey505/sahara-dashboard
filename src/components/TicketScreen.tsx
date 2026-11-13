import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Ticket,
  Plus,
  Trash2,
  Save,
  Server,
  Hash,
  ShieldCheck,
  Loader2,
  Send,
  HelpCircle,
  Search,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  FolderOpen,
  UserCheck,
  MessageSquare,
  ClipboardList,
  ChevronDown,
} from "lucide-react";
import { motionTokens } from "../lib/design";

/**
 * Tickets, as the bot actually stores them.
 *
 * A server owns a list of ticket types. Each type is a whole ticket system in
 * miniature: what the panel says, what the button says, where the channel lands,
 * who can see it, and what the person is asked before the channel opens.
 *
 * The screen is a list of types on the left and the selected type's settings on
 * the right. Before, every type was expanded at once and a server with six types
 * was six screens of identical inputs with no way to tell which was which.
 *
 * Two rules the API enforces and this screen has to respect rather than discover
 * at the last moment:
 *   - a category or role is an ID, never a name, so renaming one changes nothing;
 *   - five questions, because that is all a Discord popup can show.
 */

type Question = { key: string; label: string; style: "short" | "long"; required: boolean };

type TicketType = {
  id: string;
  label: string;
  emoji: string;
  description: string;
  panel_title: string;
  panel_channel: string;
  category: string;
  staff_role: string;
  open_message: string;
  transcript: boolean;
  questions: Question[];
  enabled: boolean;
};

type Ticket = {
  channel_id: string;
  guild_id: string;
  user_id: string;
  user_name: string;
  number: number;
  status: string;
  opened_at: string;
  closed_at?: string | null;
  type_id?: string;
  type_label?: string;
  answers?: Record<string, string>;
};

type Props = {
  apiUrl: string;
  notify: (msg: string, type?: string) => void;
  servers: any[];
  selectedServer: string;
  userId?: string;
};

const MAX_QUESTIONS = 5;
const MAX_TYPES = 12;

const newType = (index: number): TicketType => ({
  id: `type${index + 1}`,
  label: "New ticket type",
  emoji: "🎫",
  description: "",
  panel_title: "Support",
  panel_channel: "",
  category: "",
  staff_role: "",
  open_message: "Thanks — a member of staff will be with you shortly.",
  transcript: true,
  questions: [{ key: "details", label: "Tell us what you need", style: "long", required: true }],
  enabled: true,
});

const keyFrom = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24) || "question";

const inputCls =
  "w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500";

export default function TicketScreen({ apiUrl, notify, servers, selectedServer }: Props) {
  const [server, setServer] = useState(selectedServer || servers[0]?.name || "");
  const [types, setTypes] = useState<TicketType[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showTickets, setShowTickets] = useState(false);

  useEffect(() => {
    if (selectedServer && selectedServer !== server) setServer(selectedServer);
  }, [selectedServer]);

  const load = useCallback(async () => {
    if (!server) return;
    setLoading(true);
    setError("");
    try {
      const [tRes, kRes] = await Promise.all([
        fetch(apiUrl + "/api/ticket-types?server=" + encodeURIComponent(server)),
        fetch(apiUrl + "/api/tickets"),
      ]);
      const tData = await tRes.json().catch(() => ({}));
      if (tData.error) {
        setError(tData.error);
        setTypes([]);
        setSelected(null);
      } else {
        const list: TicketType[] = Array.isArray(tData.types) ? tData.types : [];
        setTypes(list);
        setDirty(false);
        // keep the selection if it still exists, else land on the first one
        setSelected((prev) => (prev && list.some((t) => t.id === prev) ? prev : list[0]?.id ?? null));
      }
      const kData = await kRes.json().catch(() => ({}));
      setTickets(Array.isArray(kData.tickets) ? kData.tickets : []);
    } catch {
      setError("Couldn't reach the bot — is the Windows laptop awake?");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, server]);

  const loadChannels = useCallback(async () => {
    if (!server) return;
    try {
      const [cRes, rRes] = await Promise.all([
        fetch(apiUrl + "/api/channels?server=" + encodeURIComponent(server)),
        fetch(apiUrl + "/api/roles?server=" + encodeURIComponent(server)),
      ]);
      const data = await cRes.json().catch(() => ({}));
      setChannels(Array.isArray(data.channels) ? data.channels : Array.isArray(data) ? data : []);
      const roledata = await rRes.json().catch(() => ({}));
      // Only roles the bot can actually give out; the rest would be a setting that
      // silently does nothing, which is worse than not offering it.
      setRoles((Array.isArray(roledata.roles) ? roledata.roles : []).filter((r: any) => r.assignable));
    } catch {
      setChannels([]);
      setRoles([]);
    }
  }, [apiUrl, server]);

  useEffect(() => {
    load();
    loadChannels();
  }, [load, loadChannels]);

  const guild = useMemo(
    () => servers.find((s) => s.name === server || String(s.id) === String(server)),
    [servers, server]
  );
  const categories = useMemo(() => channels.filter((c) => c.type === "category" || c.type === 4), [channels]);
  const textChannels = useMemo(() => channels.filter((c) => c.type === "text" || c.type === 0), [channels]);

  const mine = useMemo(
    () => tickets.filter((t) => String(t.guild_id) === String(guild?.id)),
    [tickets, guild]
  );
  const openTickets = mine.filter((t) => t.status === "open");

  const index = types.findIndex((t) => t.id === selected);
  const current = index >= 0 ? types[index] : null;

  const update = (i: number, patch: Partial<TicketType>) => {
    setTypes((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));
    setDirty(true);
  };

  const updateQuestion = (i: number, qi: number, patch: Partial<Question>) => {
    setTypes((prev) =>
      prev.map((t, j) =>
        j === i ? { ...t, questions: t.questions.map((q, k) => (k === qi ? { ...q, ...patch } : q)) } : t
      )
    );
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(apiUrl + "/api/ticket-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server, types }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        setTypes(Array.isArray(data.types) ? data.types : types);
        setDirty(false);
        notify("Ticket types saved", "success");
      } else {
        notify(data.error || "Could not save", "error");
      }
    } catch {
      notify("Connection failed — is the bot running?", "error");
    } finally {
      setSaving(false);
    }
  };

  const postPanel = async (type: TicketType) => {
    setBusy("panel-" + type.id);
    try {
      const res = await fetch(apiUrl + "/api/ticket-panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server, type_id: type.id, channel_id: type.panel_channel }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        notify(`Panel posted in #${data.channel_name}`, "success");
      } else {
        notify(data.error || "Could not post the panel", "error");
      }
    } catch {
      notify("Connection failed — is the bot running?", "error");
    } finally {
      setBusy(null);
    }
  };

  const channelName = (id: string) => channels.find((c) => String(c.id) === String(id))?.name;
  const categoryName = (id: string) => categories.find((c) => String(c.id) === String(id))?.name;
  const roleName = (id: string) => roles.find((r: any) => String(r.id) === String(id))?.name;

  // A type is ready to post when it has somewhere to post and somewhere to put the
  // channel. Saying so on the row means the problem is visible before the button.
  const warningsFor = (t: TicketType) => {
    const w: string[] = [];
    if (!t.panel_channel) w.push("no panel channel");
    if (!t.category) w.push("no category");
    if (!t.staff_role) w.push("no staff role");
    return w;
  };

  const addType = () => {
    if (types.length >= MAX_TYPES) {
      notify(`${MAX_TYPES} ticket types is the most Discord can show on one panel`, "error");
      return;
    }
    const t = newType(types.length);
    setTypes((prev) => [...prev, t]);
    setSelected(t.id);
    setDirty(true);
  };

  return (
    <div className="space-y-4">
      {/* Server + actions */}
      <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <Server className="w-4 h-4 text-indigo-300" />
        <select
          value={server}
          onChange={(e) => setServer(e.target.value)}
          className="px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
          data-tip="Tickets are configured per server — each one can be completely different"
        >
          <option value="">Select a server…</option>
          {servers.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowTickets((v) => !v)}
          className={
            "text-xs px-2.5 py-1.5 rounded-lg transition " +
            (showTickets ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-800/60 text-slate-300 hover:bg-slate-800")
          }
          data-tip="Tickets people have already opened in this server"
        >
          {openTickets.length} open · {mine.length} total
        </button>
        {dirty && (
          <span className="text-xs px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            unsaved changes
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 text-sm hover:bg-slate-800 transition"
            data-tip="Reload this server's ticket types from the bot"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Reload
          </button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-200 text-sm hover:bg-emerald-500/30 transition disabled:opacity-40"
            data-tip="Save every ticket type on this screen to the bot"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl p-3 bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">{error}</div>
      )}

      {showTickets && (
        <motion.div className="glass rounded-2xl p-4" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={motionTokens.enter}>
          <div className="flex items-center gap-2 mb-3">
            <Ticket className="w-4 h-4 text-emerald-300" />
            <h3 className="font-semibold text-sm">Tickets on record</h3>
          </div>
          {mine.length === 0 ? (
            <p className="text-xs text-slate-500">
              Nothing yet. Once someone presses a panel button, their ticket shows here with what they were asked.
            </p>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {mine.map((t) => (
                <div key={t.channel_id} className="rounded-xl bg-slate-800/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className={
                        "text-[11px] px-1.5 py-0.5 rounded " +
                        (t.status === "open" ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700 text-slate-400")
                      }
                    >
                      {t.status}
                    </span>
                    <span className="font-medium">#{t.number}</span>
                    <span className="text-slate-300">{t.user_name}</span>
                    {t.type_label && <span className="text-[11px] text-indigo-300">{t.type_label}</span>}
                    <span className="ml-auto text-[11px] text-slate-500">
                      {channelName(t.channel_id) ? `#${channelName(t.channel_id)}` : ""}
                    </span>
                  </div>
                  {t.answers && Object.keys(t.answers).length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {Object.entries(t.answers).map(([k, v]) => (
                        <p key={k} className="text-[11px] text-slate-400">
                          <span className="text-slate-500">{k}: </span>
                          {v}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Two panes: the types, and the one you picked */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
        {/* left: the list */}
        <div className="glass rounded-2xl p-2 lg:sticky lg:top-4">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-[11px] uppercase tracking-wider text-slate-500">Ticket types</span>
            <span className="text-[11px] text-slate-500">{types.length}/{MAX_TYPES}</span>
          </div>
          <div className="space-y-1">
            {types.map((t) => {
              const on = t.id === selected;
              const warn = warningsFor(t);
              return (
                <button
                  key={t.id}
                  onClick={() => setSelected(t.id)}
                  className={
                    "w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left transition " +
                    (on ? "bg-indigo-500/20 ring-1 ring-indigo-400/40" : "hover:bg-slate-800/60")
                  }
                  data-tip={`Edit ${t.label}`}
                >
                  <span className="text-base leading-none">{t.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className={"block text-sm truncate " + (on ? "text-indigo-100" : "text-slate-200")}>
                      {t.label}
                    </span>
                    <span className="block text-[10px] text-slate-500 truncate">
                      {warn.length ? warn.join(" · ") : channelName(t.panel_channel) ? `#${channelName(t.panel_channel)}` : "ready"}
                    </span>
                  </span>
                  {!t.enabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">off</span>
                  )}
                  {warn.length > 0 && t.enabled && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                </button>
              );
            })}
          </div>
          {types.length < MAX_TYPES && (
            <button
              onClick={addType}
              className="mt-1 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-slate-700 text-xs text-slate-400 hover:border-indigo-500 hover:text-indigo-300 transition"
              data-tip="Add another kind of ticket — verification, appeals, reports, anything"
            >
              <Plus className="w-3.5 h-3.5" />
              Add a ticket type
            </button>
          )}
        </div>

        {/* right: the selected type */}
        <div className="min-w-0">
          {!current && !loading && (
            <div className="glass rounded-2xl p-10 text-center border border-dashed border-slate-700">
              <Ticket className="w-8 h-8 mx-auto text-slate-600 mb-3" />
              <p className="text-sm text-slate-400">
                {types.length === 0
                  ? "No ticket types on this server yet. Add one to get started."
                  : "Pick a ticket type on the left to edit it."}
              </p>
            </div>
          )}

          <AnimatePresence mode="wait">
            {current && (
              <motion.div
                key={current.id}
                className="glass rounded-2xl overflow-hidden"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={motionTokens.enter}
              >
                {/* header */}
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-700/50">
                  <span className="text-lg">{current.emoji}</span>
                  <span className="font-semibold text-sm">{current.label}</span>
                  <span className="text-[11px] text-slate-500 font-mono">`{current.id}`</span>
                  <label className="ml-2 flex items-center gap-1.5 text-xs text-slate-400" data-tip="Turn this type off without deleting it">
                    <input
                      type="checkbox"
                      checked={current.enabled}
                      onChange={(e) => update(index, { enabled: e.target.checked })}
                      className="accent-emerald-500"
                    />
                    on
                  </label>
                  <div className="ml-auto flex gap-2">
                    <button
                      onClick={() => postPanel(current)}
                      disabled={busy === "panel-" + current.id || !current.panel_channel}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-200 text-xs hover:bg-indigo-500/25 transition disabled:opacity-40"
                      data-tip={
                        current.panel_channel
                          ? "Post this type's panel in its panel channel — no need to go into Discord"
                          : "Pick a panel channel first"
                      }
                    >
                      {busy === "panel-" + current.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      Post panel
                    </button>
                    <button
                      onClick={() => {
                        if (!confirm(`Delete the ticket type "${current.label}"? Tickets already open keep working.`)) return;
                        setTypes((prev) => prev.filter((t) => t.id !== current.id));
                        setSelected(types.find((t) => t.id !== current.id)?.id ?? null);
                        setDirty(true);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 text-xs hover:bg-rose-500/20 transition"
                      data-tip="Remove this ticket type. Panels already posted will stop opening new tickets of this kind."
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {warningsFor(current).length > 0 && (
                  <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[12px] text-amber-200 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Not ready: {warningsFor(current).join(", ")}. A ticket opened without these still works, but staff get a warning inside it.
                  </div>
                )}

                <div className="p-4 space-y-4">
                  {/* the panel */}
                  <Section icon={<MessageSquare className="w-4 h-4 text-indigo-300" />} title="The panel" tip="What people see and press in the channel">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Field label="Button label" tip="What the button on the panel says">
                        <input value={current.label} onChange={(e) => update(index, { label: e.target.value })} className={inputCls} />
                      </Field>
                      <Field label="Emoji" tip="One emoji, shown on the button">
                        <input
                          value={current.emoji}
                          onChange={(e) => update(index, { emoji: e.target.value })}
                          maxLength={8}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Panel title" tip="The heading on the panel message">
                        <input
                          value={current.panel_title}
                          onChange={(e) => update(index, { panel_title: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Panel channel" tip="Where this type's panel gets posted">
                        <Picker
                          value={current.panel_channel}
                          onChange={(v) => update(index, { panel_channel: v })}
                          options={textChannels.map((c) => ({ id: String(c.id), label: `#${c.name}` }))}
                          empty="Not set"
                          icon={<Hash className="w-3.5 h-3.5" />}
                          tip="The channel the Post panel button sends to"
                        />
                      </Field>
                    </div>
                    <Field label="Panel description" tip="The line under the heading">
                      <textarea
                        value={current.description}
                        onChange={(e) => update(index, { description: e.target.value })}
                        rows={2}
                        className={inputCls}
                        data-tip="Say what this kind of ticket is for"
                      />
                    </Field>
                  </Section>

                  {/* where it lands */}
                  <Section icon={<FolderOpen className="w-4 h-4 text-purple-300" />} title="Where the ticket lands" tip="The channel that opens when someone presses the button">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Field label="Category" tip="Where the new ticket channel is created">
                        <Picker
                          value={current.category}
                          onChange={(v) => update(index, { category: v })}
                          options={categories.map((c) => ({ id: String(c.id), label: c.name }))}
                          empty="No category"
                          icon={<FolderOpen className="w-3.5 h-3.5" />}
                          tip="Stored by ID, so renaming the category in Discord changes nothing"
                          missing={
                            current.category && !categoryName(current.category)
                              ? `Saved category ${current.category} is not in this server any more`
                              : undefined
                          }
                        />
                      </Field>
                      <Field label="Staff role" tip="Who can see tickets of this type">
                        <Picker
                          value={current.staff_role}
                          onChange={(v) => update(index, { staff_role: v })}
                          options={roles.map((r: any) => ({ id: String(r.id), label: r.name }))}
                          empty="Nobody in particular"
                          icon={<UserCheck className="w-3.5 h-3.5" />}
                          tip="Also stored by ID — rename the role and tickets still land right"
                          missing={
                            current.staff_role && !roleName(current.staff_role)
                              ? `Saved role ${current.staff_role} is not in this server any more`
                              : undefined
                          }
                        />
                      </Field>
                    </div>
                    <Field label="Message when it opens" tip="Posted at the top of the new channel">
                      <textarea
                        value={current.open_message}
                        onChange={(e) => update(index, { open_message: e.target.value })}
                        rows={2}
                        className={inputCls}
                      />
                    </Field>
                    <label
                      className="flex items-center gap-2 text-sm text-slate-300"
                      data-tip="Save a transcript of the conversation when the ticket closes"
                    >
                      <input
                        type="checkbox"
                        checked={current.transcript}
                        onChange={(e) => update(index, { transcript: e.target.checked })}
                        className="accent-indigo-500"
                      />
                      <ShieldCheck className="w-4 h-4 text-indigo-300" />
                      Keep a transcript when the ticket closes
                    </label>
                  </Section>

                  {/* questions */}
                  <Section
                    icon={<ClipboardList className="w-4 h-4 text-purple-300" />}
                    title="Questions before the channel opens"
                    tip={`Discord shows ${MAX_QUESTIONS} at most`}
                    aside={
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500">
                          {current.questions.length}/{MAX_QUESTIONS}
                        </span>
                        <button
                          onClick={() => {
                            if (current.questions.length >= MAX_QUESTIONS) {
                              notify(`A Discord popup shows ${MAX_QUESTIONS} questions at most`, "error");
                              return;
                            }
                            const label = "New question";
                            update(index, {
                              questions: [
                                ...current.questions,
                                { key: keyFrom(label), label, style: "short", required: true },
                              ],
                            });
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-500/15 text-purple-200 text-xs hover:bg-purple-500/25 transition"
                          data-tip={`Add a question (max ${MAX_QUESTIONS} — that is all Discord shows)`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Question
                        </button>
                      </div>
                    }
                  >
                    {current.questions.length === 0 && (
                      <p className="text-xs text-slate-500">No questions — the channel opens straight away.</p>
                    )}
                    <div className="space-y-2">
                      {current.questions.map((q, qi) => (
                        <div key={qi} className="flex flex-wrap items-center gap-2">
                          <input
                            value={q.label}
                            onChange={(e) =>
                              updateQuestion(index, qi, { label: e.target.value, key: q.key || keyFrom(e.target.value) })
                            }
                            placeholder="Question"
                            className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700 text-sm focus:outline-none focus:border-purple-500"
                            data-tip="What the member is asked"
                          />
                          <select
                            value={q.style}
                            onChange={(e) => updateQuestion(index, qi, { style: e.target.value as "short" | "long" })}
                            className="px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700 text-xs"
                            data-tip="A long one gets a bigger box, for explanations"
                          >
                            <option value="short">short</option>
                            <option value="long">long</option>
                          </select>
                          <label className="flex items-center gap-1 text-[11px] text-slate-400" data-tip="A required question cannot be skipped">
                            <input
                              type="checkbox"
                              checked={q.required}
                              onChange={(e) => updateQuestion(index, qi, { required: e.target.checked })}
                              className="accent-purple-500"
                            />
                            required
                          </label>
                          <button
                            onClick={() =>
                              update(index, { questions: current.questions.filter((_, j) => j !== qi) })
                            }
                            className="text-rose-300/70 hover:text-rose-300"
                            data-tip="Remove this question"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70" />
                    Category and role are stored as IDs — rename them in Discord and this keeps working.
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/** A select that can be typed into, for servers with more channels than a list can show. */
function Picker({
  value,
  onChange,
  options,
  empty,
  icon,
  tip,
  missing,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  empty: string;
  icon?: React.ReactNode;
  tip: string;
  missing?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  }, [options, q]);
  const chosen = options.find((o) => o.id === value);

  return (
    <div data-tip={tip}>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">{icon}</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={chosen ? chosen.label : empty}
          className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
          data-tip={options.length > 8 ? "Type to filter" : tip}
        />
        <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
      </div>
      <div className="mt-1 max-h-40 overflow-y-auto rounded-xl bg-slate-900/50 border border-slate-700/60">
        {!q && (
          <button
            onClick={() => {
              onChange("");
              setQ("");
            }}
            className={
              "w-full text-left px-3 py-1.5 text-xs hover:bg-slate-800/60 " +
              (value ? "text-slate-400" : "text-indigo-200 bg-indigo-500/10")
            }
          >
            {empty}
          </button>
        )}
        {filtered.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">No matches.</p>}
        {filtered.slice(0, 60).map((o) => (
          <button
            key={o.id}
            onClick={() => {
              onChange(o.id);
              setQ("");
            }}
            className={
              "w-full text-left px-3 py-1.5 text-xs truncate hover:bg-slate-800/60 " +
              (o.id === value ? "text-indigo-200 bg-indigo-500/10" : "text-slate-300")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
      {missing && <p className="mt-1 text-[11px] text-amber-300">{missing}</p>}
    </div>
  );
}

function Section({
  icon,
  title,
  tip,
  aside,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tip: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-3" data-tip={tip}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-sm font-medium">{title}</span>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, tip, children }: { label: string; tip: string; children: React.ReactNode }) {
  return (
    <div data-tip={tip}>
      <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">{label}</p>
      {children}
    </div>
  );
}
