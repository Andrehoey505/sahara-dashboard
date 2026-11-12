import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
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
  ChevronDown,
  HelpCircle,
  Copy,
  Check,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { motionTokens } from "../lib/design";

/**
 * Tickets, as the bot actually stores them.
 *
 * A server owns a list of ticket types. Each type is a whole ticket system in
 * miniature: what the panel says, what the button says, where the channel lands,
 * who can see it, and what the person is asked before the channel opens. This
 * screen edits that list and posts the panels.
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

export default function TicketScreen({ apiUrl, notify, servers, selectedServer, userId }: Props) {
  const [server, setServer] = useState(selectedServer || servers[0]?.name || "");
  const [types, setTypes] = useState<TicketType[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [open, setOpen] = useState<number | null>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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
      } else {
        setTypes(Array.isArray(tData.types) ? tData.types : []);
        setDirty(false);
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

  const guild = useMemo(() => servers.find((s) => s.name === server || String(s.id) === String(server)), [servers, server]);
  const categories = useMemo(() => channels.filter((c) => c.type === 4 || c.type === "category"), [channels]);
  const textChannels = useMemo(() => channels.filter((c) => c.type === 0 || c.type === "text"), [channels]);


  const mine = useMemo(
    () => tickets.filter((t) => String(t.guild_id) === String(guild?.id)),
    [tickets, guild]
  );
  const openTickets = mine.filter((t) => t.status === "open");

  const update = (index: number, patch: Partial<TicketType>) => {
    setTypes((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
    setDirty(true);
  };

  const updateQuestion = (index: number, qIndex: number, patch: Partial<Question>) => {
    setTypes((prev) =>
      prev.map((t, i) => {
        if (i !== index) return t;
        const questions = t.questions.map((q, j) => (j === qIndex ? { ...q, ...patch } : q));
        return { ...t, questions };
      })
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
        <span className="text-xs text-slate-400">
          {openTickets.length} open · {mine.length} total
        </span>
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

      {/* Types */}
      {types.map((type, i) => (
        <motion.div
          key={type.id + i}
          className="glass rounded-2xl overflow-hidden"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={motionTokens.enter}
        >
          <div className="flex items-center gap-2 px-4 py-3">
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="flex items-center gap-2 flex-1 text-left"
              data-tip="Show or hide this ticket type's settings"
            >
              <ChevronDown className={"w-4 h-4 transition " + (open === i ? "rotate-180" : "")} />
              <span className="text-lg">{type.emoji}</span>
              <span className="font-semibold text-sm">{type.label}</span>
              <span className="text-[11px] text-slate-500">`{type.id}`</span>
              {!type.enabled && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">off</span>
              )}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-slate-400" data-tip="Turn this type off without deleting it">
              <input
                type="checkbox"
                checked={type.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
                className="accent-emerald-500"
              />
              on
            </label>
            <button
              onClick={() => postPanel(type)}
              disabled={busy === "panel-" + type.id || !type.panel_channel}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-200 text-xs hover:bg-indigo-500/25 transition disabled:opacity-40"
              data-tip="Post this type's panel in its panel channel — no need to go into Discord"
            >
              {busy === "panel-" + type.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Post panel
            </button>
            <button
              onClick={() => {
                if (!confirm(`Delete the ticket type "${type.label}"? Tickets already open keep working.`)) return;
                setTypes((prev) => prev.filter((_, j) => j !== i));
                setDirty(true);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 text-xs hover:bg-rose-500/20 transition"
              data-tip="Remove this ticket type. Panels already posted will stop opening new tickets of this kind."
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {open === i && (
            <div className="px-4 pb-4 space-y-3 border-t border-slate-700/50 pt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Button label" tip="What the button on the panel says">
                  <input
                    value={type.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                    data-tip="Shown on the panel button, and in this screen"
                  />
                </Field>
                <Field label="Emoji" tip="One emoji, shown on the button">
                  <input
                    value={type.emoji}
                    onChange={(e) => update(i, { emoji: e.target.value })}
                    maxLength={8}
                    className="w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                    data-tip="Paste one emoji — anything longer is cut off"
                  />
                </Field>
                <Field label="Panel title" tip="The heading on the panel message">
                  <input
                    value={type.panel_title}
                    onChange={(e) => update(i, { panel_title: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                    data-tip="Appears in bold at the top of the panel"
                  />
                </Field>
                <Field label="Panel channel" tip="Where this type's panel gets posted">
                  <select
                    value={type.panel_channel}
                    onChange={(e) => update(i, { panel_channel: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                    data-tip="The channel the Post panel button sends to"
                  >
                    <option value="">Not set</option>
                    {textChannels.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Category" tip="Where the new ticket channel is created">
                  <select
                    value={type.category}
                    onChange={(e) => update(i, { category: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                    data-tip="Stored by ID, so renaming the category in Discord changes nothing"
                  >
                    <option value="">No category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Staff role" tip="Who can see tickets of this type">
                  <select
                    value={type.staff_role}
                    onChange={(e) => update(i, { staff_role: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                    data-tip="Also stored by ID — rename the role and tickets still land right"
                  >
                    <option value="">Nobody in particular</option>
                    {roles.map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Panel description" tip="The line under the heading">
                <textarea
                  value={type.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                  data-tip="Say what this kind of ticket is for"
                />
              </Field>

              <Field label="Message when it opens" tip="Posted at the top of the new channel">
                <textarea
                  value={type.open_message}
                  onChange={(e) => update(i, { open_message: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                  data-tip="Greets the member, and tells them what happens next"
                />
              </Field>

              <label className="flex items-center gap-2 text-sm text-slate-300" data-tip="Save a transcript of the conversation when the ticket closes">
                <input
                  type="checkbox"
                  checked={type.transcript}
                  onChange={(e) => update(i, { transcript: e.target.checked })}
                  className="accent-indigo-500"
                />
                <ShieldCheck className="w-4 h-4 text-indigo-300" />
                Keep a transcript when the ticket closes
              </label>

              {/* Questions */}
              <div className="rounded-xl bg-slate-800/40 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <HelpCircle className="w-4 h-4 text-purple-300" />
                  <span className="text-sm font-medium">Questions asked before the channel opens</span>
                  <span className="text-[11px] text-slate-500">
                    {type.questions.length}/{MAX_QUESTIONS}
                  </span>
                  <button
                    onClick={() => {
                      if (type.questions.length >= MAX_QUESTIONS) {
                        notify(`A Discord popup shows ${MAX_QUESTIONS} questions at most`, "error");
                        return;
                      }
                      const label = "New question";
                      update(i, {
                        questions: [...type.questions, { key: keyFrom(label), label, style: "short", required: true }],
                      });
                    }}
                    className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-500/15 text-purple-200 text-xs hover:bg-purple-500/25 transition"
                    data-tip={`Add a question (max ${MAX_QUESTIONS} — that is all Discord shows)`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Question
                  </button>
                </div>

                {type.questions.length === 0 && (
                  <p className="text-xs text-slate-500">
                    No questions — the channel opens straight away.
                  </p>
                )}

                <div className="space-y-2">
                  {type.questions.map((q, qi) => (
                    <div key={qi} className="flex flex-wrap items-center gap-2">
                      <input
                        value={q.label}
                        onChange={(e) => updateQuestion(i, qi, { label: e.target.value, key: q.key || keyFrom(e.target.value) })}
                        placeholder="Question"
                        className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700 text-sm focus:outline-none focus:border-purple-500"
                        data-tip="What the member is asked"
                      />
                      <select
                        value={q.style}
                        onChange={(e) => updateQuestion(i, qi, { style: e.target.value as "short" | "long" })}
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
                          onChange={(e) => updateQuestion(i, qi, { required: e.target.checked })}
                          className="accent-purple-500"
                        />
                        required
                      </label>
                      <button
                        onClick={() => update(i, { questions: type.questions.filter((_, j) => j !== qi) })}
                        className="text-rose-300/70 hover:text-rose-300"
                        data-tip="Remove this question"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </motion.div>
      ))}

      {types.length < MAX_TYPES && (
        <button
          onClick={() => {
            setTypes((prev) => [...prev, newType(prev.length)]);
            setOpen(types.length);
            setDirty(true);
          }}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-dashed border-slate-700 text-sm text-slate-400 hover:border-indigo-500 hover:text-indigo-300 transition"
          data-tip="Add another kind of ticket — verification, appeals, reports, anything"
        >
          <Plus className="w-4 h-4" />
          Add a ticket type
        </button>
      )}

      {/* Tickets on record */}
      <div className="glass rounded-2xl p-4">
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
      </div>
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
