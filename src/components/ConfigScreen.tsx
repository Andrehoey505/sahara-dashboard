import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Save,
  RotateCcw,
  RefreshCw,
  Hash,
  MessageSquare,
  Shield,
  Ticket,
  BadgeCheck,
  Sparkles,
  Settings2,
  AlertTriangle,
  Check,
} from "lucide-react";
import { motionTokens } from "../lib/design";
import type { Server } from "../lib/servers";
import {
  FALLBACK_SCHEMA,
  SECTION_HINTS,
  SECTION_LABELS,
  LOG_EVENTS,
  AUTOMOD_CHECKS,
  EVENT_LABELS,
  kindOf,
  type Schema,
} from "../lib/config";

type Props = {
  apiUrl: string;
  server: Server | undefined;
  servers: Server[];
  notify: (msg: string, type?: string) => void;
};

const SECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  general: Settings2,
  logging: Hash,
  welcome: MessageSquare,
  automod: Shield,
  tickets: Ticket,
  verification: BadgeCheck,
  extras: Sparkles,
};

const field =
  "w-full px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/30 transition";

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={
        "relative w-11 h-6 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 " +
        (on ? "bg-indigo-500" : "bg-slate-700")
      }
    >
      <span
        className={
          "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all " +
          (on ? "left-[1.375rem]" : "left-0.5")
        }
      />
    </button>
  );
}

function ChipPicker({
  options,
  value,
  onChange,
  labelFor,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  labelFor: (id: string) => string;
}) {
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((id) => {
        const on = value.includes(id);
        return (
          <button
            key={id}
            onClick={() => toggle(id)}
            aria-pressed={on}
            className={
              "px-2.5 py-1 rounded-lg text-xs border transition-colors " +
              (on
                ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200"
                : "bg-slate-800/50 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600")
            }
          >
            {on && <Check className="w-3 h-3 inline mr-1" />}
            {labelFor(id)}
          </button>
        );
      })}
    </div>
  );
}

export default function ConfigScreen({ apiUrl, server, servers, notify }: Props) {
  const [schema, setSchema] = useState<Schema>(FALLBACK_SCHEMA);
  const [values, setValues] = useState<Record<string, any>>(FALLBACK_SCHEMA.defaults);
  const [saved, setSaved] = useState<Record<string, any>>(FALLBACK_SCHEMA.defaults);
  const [section, setSection] = useState("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const guildId = server?.id || "";

  const load = useCallback(async () => {
    if (!guildId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [sRes, cRes] = await Promise.all([
        fetch(apiUrl + "/api/config/schema"),
        fetch(apiUrl + `/api/config/${guildId}`),
      ]);
      if (sRes.ok) {
        const s = await sRes.json();
        if (s && s.defaults) setSchema(s);
      }
      if (!cRes.ok) throw new Error("bad status");
      const data = await cRes.json();
      const settings = { ...(data.settings || {}) };
      setValues(settings);
      setSaved(settings);
      setError("");
    } catch {
      setError("Couldn't load this server's settings — is the bot reachable?");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, guildId]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(
    () => Object.keys(values).some((k) => JSON.stringify(values[k]) !== JSON.stringify(saved[k])),
    [values, saved]
  );

  const save = async () => {
    if (!guildId) return;
    setSaving(true);
    try {
      // Only send what actually changed, so two screens open at once don't
      // overwrite each other's untouched settings.
      const changes: Record<string, any> = {};
      for (const k of Object.keys(values)) {
        if (JSON.stringify(values[k]) !== JSON.stringify(saved[k])) changes[k] = values[k];
      }
      const res = await fetch(apiUrl + `/api/config/${guildId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: changes }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setValues(data.settings);
        setSaved(data.settings);
        notify("Saved", "success");
      } else {
        notify(data.error || "Couldn't save", "error");
      }
    } catch {
      notify("Connection failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!guildId) return;
    try {
      const res = await fetch(apiUrl + `/api/config/${guildId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setValues(data.settings);
        setSaved(data.settings);
        notify("Back to defaults", "success");
      } else {
        notify(data.error || "Couldn't reset", "error");
      }
    } catch {
      notify("Connection failed", "error");
    }
  };

  const set = (key: string, value: any) => setValues((v) => ({ ...v, [key]: value }));

  const channelLabel = (id: string) => {
    // Channels come back as ids; show a name if we can guess nothing better.
    return `#${id}`;
  };

  const keys = schema.sections[section] || [];

  if (!server) {
    return (
      <div className="glass rounded-2xl p-10 text-center border border-dashed border-slate-700">
        <AlertTriangle className="w-8 h-8 mx-auto text-amber-400 mb-3" />
        <p className="text-sm text-slate-400">
          Pick a server first — settings belong to a server, not to the app.
        </p>
      </div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Server settings</h2>
          <p className="text-sm text-slate-400 mt-1">
            {server.name} — the same settings the <code className="text-slate-300">bb!</code> commands change.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            aria-label="Reload settings"
            className="p-2 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={reset}
            className="px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-300 text-sm hover:bg-slate-700/60 transition-colors"
          >
            <RotateCcw className="w-4 h-4 inline mr-1.5" />
            Defaults
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className={
              "px-4 py-2 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 " +
              (dirty && !saving
                ? "bg-indigo-500 text-white hover:bg-indigo-400"
                : "bg-slate-800/60 text-slate-500 border border-slate-700 cursor-not-allowed")
            }
          >
            <Save className="w-4 h-4 inline mr-1.5" />
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-4 bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[13rem_1fr] gap-4">
        <nav className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible thin-scroll">
          {Object.keys(schema.sections).map((s) => {
            const Icon = SECTION_ICONS[s] || Settings2;
            const active = section === s;
            return (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={
                  "flex items-center gap-2 px-3 py-2 rounded-xl text-sm whitespace-nowrap transition-colors " +
                  (active
                    ? "bg-indigo-500/15 text-indigo-200 border border-indigo-500/30"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent")
                }
               data-tip="Switch section">
                <Icon className="w-4 h-4" />
                {SECTION_LABELS[s] || s}
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={motionTokens.enter}
            className="card p-5 space-y-5"
          >
            <p className="text-sm text-slate-400">{SECTION_HINTS[section] || ""}</p>

            {loading && <p className="text-sm text-slate-500">Loading…</p>}

            {!loading &&
              keys.map((key) => {
                const kind = kindOf(key, schema);
                const label = schema.labels[key] || key;
                const value = values[key] ?? schema.defaults[key];

                if (kind === "bool") {
                  return (
                    <div key={key} className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-200">{label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {value ? "On" : "Off"}
                          {JSON.stringify(value) !== JSON.stringify(saved[key]) && " · unsaved"}
                        </p>
                      </div>
                      <Toggle on={!!value} onChange={(v) => set(key, v)} label={label} />
                    </div>
                  );
                }

                if (kind === "list") {
                  const options = key === "log_events" ? LOG_EVENTS : key === "automod_actions" ? AUTOMOD_CHECKS : [];
                  const chosen = Array.isArray(value) ? value : [];
                  return (
                    <div key={key}>
                      <p className="text-sm font-medium text-slate-200 mb-2">{label}</p>
                      {options.length > 0 ? (
                        <ChipPicker
                          options={options}
                          value={chosen}
                          onChange={(v) => set(key, v)}
                          labelFor={(id) => EVENT_LABELS[id] || id}
                        />
                      ) : (
                        <input
                          className={field}
                          value={chosen.join(", ")}
                          onChange={(e) =>
                            set(
                              key,
                              e.target.value
                                .split(",")
                                .map((x) => x.trim())
                                .filter(Boolean)
                            )
                          }
                          placeholder="comma separated"
                        />
                      )}
                      <p className="text-xs text-slate-500 mt-1.5">
                        {chosen.length === 0 ? "Nothing selected" : `${chosen.length} selected`}
                      </p>
                    </div>
                  );
                }

                if (kind === "channel" || kind === "role") {
                  return (
                    <div key={key}>
                      <p className="text-sm font-medium text-slate-200 mb-2">{label}</p>
                      <input
                        className={field}
                        value={value || ""}
                        onChange={(e) => set(key, e.target.value.trim())}
                        placeholder={
                          kind === "channel" ? "channel id — or #name in Discord" : "role id"
                        }
                      />
                      <p className="text-xs text-slate-500 mt-1.5">
                        {value ? channelLabel(value) : "Not set"}
                      </p>
                    </div>
                  );
                }

                const long = key.endsWith("_message");
                return (
                  <div key={key}>
                    <p className="text-sm font-medium text-slate-200 mb-2">{label}</p>
                    {long ? (
                      <textarea
                        rows={3}
                        className={field + " resize-none"}
                        value={value || ""}
                        onChange={(e) => set(key, e.target.value)}
                      />
                    ) : (
                      <input
                        className={field}
                        value={value || ""}
                        onChange={(e) => set(key, e.target.value)}
                      />
                    )}
                    {(key === "welcome_message" || key === "goodbye_message") && (
                      <p className="text-xs text-slate-500 mt-1.5">
                        {"{user}"} and {"{server}"} get replaced when it is sent.
                      </p>
                    )}
                  </div>
                );
              })}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
