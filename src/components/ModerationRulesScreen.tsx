import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Hash,
  ChevronDown,
  Loader2,
  Save,
  RotateCcw,
  AlertTriangle,
  EyeOff,
  Eye,
  Ban,
  CheckCircle2,
  Info,
} from "lucide-react";

/**
 * How each channel is moderated, set per channel, in the app.
 *
 * The bot used to know one thing about a channel: whether Discord had it marked
 * NSFW. That is too blunt for a server like Babble Playpen, where a diaper-check
 * channel is neither "normal chat" nor "anything goes" — the content is fine, it
 * just has to be spoilered.
 *
 * So a channel has a PRESET (one of four, each with a plain-English line saying
 * what it does) and, behind an expander, a set of switches the preset filled in.
 * Change a switch and the channel is "custom" — visibly not on a stock preset,
 * because a channel that has drifted from its preset is the thing you forget.
 *
 * Storage follows the ticket types exactly: this screen posts the whole list, the
 * bot validates it and writes it, and both read it back through the same call, so
 * the app and the bot cannot disagree about what a channel is set to.
 */

type Preset = "off" | "spoiler" | "normal" | "strict";

type ChannelRule = {
  channel_id: string;
  channel_name?: string;
  preset: Preset;
  custom?: boolean;
  // Advanced permissions. null means "whatever the preset says", so a preset can
  // be redefined later without silently rewriting channels that never touched it.
  links?: string | null;
  profanity?: string | null;
  spam?: string | null;
  // nsfw_text is deliberately absent: the bot stores it but has no detector behind
  // it, and a switch that saves a value nothing reads is a lie told by a settings
  // screen. It goes back on the day there is something for it to switch.
  nsfw_images?: string | null;
  nsfw_videos?: string | null;
  sensitivity?: string | null;
};

const PRESETS: {
  id: Preset;
  label: string;
  icon: React.ElementType;
  tone: string;
  explain: string;
}[] = [
  {
    id: "off",
    label: "Off",
    icon: EyeOff,
    tone: "text-slate-400",
    explain:
      "The bot ignores this channel completely. Nothing is checked, nothing is flagged, nothing is deleted.",
  },
  {
    id: "spoiler",
    label: "Spoiler-only",
    icon: Eye,
    tone: "text-sky-300",
    explain:
      "NSFW content is allowed here, but it must be spoilered. Unspoilered images and videos are flagged for review — nothing is deleted automatically.",
  },
  {
    id: "normal",
    label: "Normal",
    icon: Shield,
    tone: "text-emerald-300",
    explain:
      "Text is checked for profanity, spam and links, and NSFW images are analysed and flagged. The standard setting for a chat channel.",
  },
  {
    id: "strict",
    label: "Strict",
    icon: Ban,
    tone: "text-rose-300",
    explain:
      "Everything Normal does, plus borderline images are flagged rather than only clear ones, and any video is flagged on sight.",
  },
];

const SWITCHES: {
  key: keyof ChannelRule;
  label: string;
  help: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "links",
    label: "Links",
    help: "Whether links in messages are allowed at all.",
    options: [
      { value: "allow", label: "Allowed" },
      { value: "flag", label: "Flag for review" },
      { value: "delete", label: "Delete" },
    ],
  },
  {
    key: "profanity",
    label: "Profanity",
    help: "How much swearing is tolerated before a message is flagged.",
    options: [
      { value: "off", label: "Not checked" },
      { value: "flag", label: "Flag at 2 words" },
      { value: "always", label: "Flag any" },
    ],
  },
  {
    key: "spam",
    label: "Spam",
    help: "Repeated or rapid messages from one person.",
    options: [
      { value: "off", label: "Not checked" },
      { value: "flag", label: "Flag for review" },
      { value: "delete", label: "Delete" },
    ],
  },
  {
    key: "nsfw_images",
    label: "NSFW images",
    help: "Pictures are analysed for adult content.",
    options: [
      { value: "off", label: "Allowed, not checked" },
      { value: "spoiler", label: "Allowed if spoilered" },
      { value: "flag", label: "Flag for review" },
      { value: "delete", label: "Delete" },
    ],
  },
  {
    key: "nsfw_videos",
    label: "NSFW videos",
    help: "Videos are not analysed — the question is whether they belong here at all.",
    options: [
      { value: "off", label: "Allowed, not checked" },
      { value: "spoiler", label: "Allowed if spoilered" },
      { value: "flag", label: "Flag on sight" },
    ],
  },
  {
    key: "sensitivity",
    label: "Image sensitivity",
    help: "How sure the bot has to be before it calls a picture NSFW.",
    options: [
      { value: "low", label: "Low — only obvious" },
      { value: "normal", label: "Normal" },
      { value: "high", label: "High — flag borderline too" },
    ],
  },
];

/** What each preset sets the switches to. Kept here so the UI can show the diff. */
const PRESET_DEFAULTS: Record<Preset, Partial<ChannelRule>> = {
  off: {
    links: "allow",
    profanity: "off",
    spam: "off",
    nsfw_images: "off",
    nsfw_videos: "off",
    sensitivity: "normal",
  },
  spoiler: {
    links: "allow",
    profanity: "off",
    spam: "flag",
    nsfw_images: "spoiler",
    nsfw_videos: "spoiler",
    sensitivity: "normal",
  },
  normal: {
    links: "flag",
    profanity: "flag",
    spam: "flag",
    nsfw_images: "flag",
    nsfw_videos: "flag",
    sensitivity: "normal",
  },
  strict: {
    links: "flag",
    profanity: "always",
    spam: "delete",
    nsfw_images: "flag",
    nsfw_videos: "flag",
    sensitivity: "high",
  },
};

type Props = {
  apiUrl: string;
  notify: (message: string, kind?: "success" | "error" | "info") => void;
  servers: any[];
  selectedServer: string;
};

export default function ModerationRulesScreen({ apiUrl, notify, servers, selectedServer }: Props) {
  const [server, setServer] = useState(selectedServer || servers[0]?.name || "");
  const [channels, setChannels] = useState<any[]>([]);
  const [rules, setRules] = useState<Record<string, ChannelRule>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (selectedServer && selectedServer !== server) setServer(selectedServer);
  }, [selectedServer]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!server) return;
    setLoading(true);
    setError("");
    try {
      const [chRes, ruleRes] = await Promise.all([
        fetch(apiUrl + "/api/channels?server=" + encodeURIComponent(server)),
        fetch(apiUrl + "/api/channel-rules?server=" + encodeURIComponent(server)),
      ]);
      if (!chRes.ok) throw new Error("Could not read this server's channels");
      const chans = await chRes.json();
      setChannels(Array.isArray(chans) ? chans : []);

      if (ruleRes.ok) {
        const data = await ruleRes.json();
        const list: ChannelRule[] = Array.isArray(data) ? data : data.rules || [];
        const byId: Record<string, ChannelRule> = {};
        for (const r of list) byId[String(r.channel_id)] = r;
        setRules(byId);
      } else {
        // A bot that predates this screen has no rules yet. That is not an error —
        // every channel is simply on the default, which is what it was doing anyway.
        setRules({});
      }
    } catch (e: any) {
      setError(e?.message || "Couldn't reach the bot");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, server]);

  useEffect(() => {
    load();
  }, [load]);

  const textChannels = useMemo(
    () => channels.filter((c) => c.type === "text"),
    [channels]
  );

  /** The rule for a channel, with the default filled in for anything unset. */
  const ruleFor = (id: string): ChannelRule =>
    rules[id] || { channel_id: id, preset: "normal" };

  /** What the switches actually are once the preset has had its say. */
  const effective = (rule: ChannelRule): Partial<ChannelRule> => {
    const preset = PRESET_DEFAULTS[rule.preset] || PRESET_DEFAULTS.normal;
    const out: Partial<ChannelRule> = { ...preset };
    for (const sw of SWITCHES) {
      const v = rule[sw.key];
      if (v !== undefined && v !== null && v !== "") out[sw.key] = v as any;
    }
    return out;
  };

  const isCustom = (rule: ChannelRule) => {
    const preset = PRESET_DEFAULTS[rule.preset] || {};
    const eff = effective(rule);
    return SWITCHES.some((sw) => {
      const mine = eff[sw.key];
      const stock = (preset as any)[sw.key];
      return mine !== undefined && stock !== undefined && mine !== stock;
    });
  };

  const setPreset = (id: string, preset: Preset) => {
    setRules((prev) => ({
      ...prev,
      // Choosing a preset clears the overrides: that is what choosing a preset
      // means, and keeping them would leave a "Strict" channel quietly behaving
      // like the old custom one.
      [id]: { channel_id: id, preset, custom: false },
    }));
  };

  const setSwitch = (id: string, key: keyof ChannelRule, value: string) => {
    setRules((prev) => {
      const current = prev[id] || { channel_id: id, preset: "normal" as Preset };
      const next = { ...current, [key]: value };
      next.custom = isCustom(next as ChannelRule);
      return { ...prev, [id]: next };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        server,
        rules: Object.values(rules).map((r) => ({
          ...r,
          channel_name: channels.find((c) => String(c.id) === String(r.channel_id))?.name || "",
        })),
      };
      const res = await fetch(apiUrl + "/api/channel-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        notify(`Saved moderation rules for ${payload.rules.length} channel(s)`, "success");
        // Take the server's version: it is the validated one, and it is what the
        // bot will act on. Keeping our own copy would let the two drift.
        if (Array.isArray(data.rules)) {
          const byId: Record<string, ChannelRule> = {};
          for (const r of data.rules) byId[String(r.channel_id)] = r;
          setRules(byId);
        }
      } else {
        notify(data.error || `That did not save (${res.status})`, "error");
      }
    } catch {
      notify("Connection failed — is the bot running?", "error");
    } finally {
      setSaving(false);
    }
  };

  const counts = useMemo(() => {
    const out: Record<string, number> = { off: 0, spoiler: 0, normal: 0, strict: 0, custom: 0 };
    for (const c of textChannels) {
      const r = ruleFor(c.id);
      out[r.preset] = (out[r.preset] || 0) + 1;
      if (isCustom(r)) out.custom += 1;
    }
    return out;
  }, [textChannels, rules]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Shield className="w-5 h-5 text-indigo-300" />
        <h2 className="text-lg font-semibold">Moderation Rules</h2>
        <select
          value={server}
          onChange={(e) => setServer(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
        >
          {servers.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-lg bg-slate-800/60 text-slate-300 text-sm hover:bg-slate-800"
            data-tip="Read the current rules back from the bot"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 text-sm hover:bg-indigo-500/30 disabled:opacity-50"
            data-tip="Save these rules to the bot"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>

      {/* What a channel gets when nobody has set it. Said plainly, because a rule
          you did not choose is the one that surprises you. */}
      <div className="glass rounded-xl px-3 py-2 flex items-start gap-2 text-[12px] text-slate-400">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-sky-300" />
        <p>
          Any channel you have not set is treated as <span className="text-emerald-300">Normal</span> —
          text checked, NSFW images analysed and flagged. {counts.custom > 0 && (
            <span className="text-amber-300">
              {counts.custom} channel{counts.custom === 1 ? " is" : "s are"} custom, so no preset describes{" "}
              {counts.custom === 1 ? "it" : "them"}.
            </span>
          )}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading channels…
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-sm text-rose-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p>{error}</p>
            <p className="text-[11px] text-rose-200/70 mt-1">
              Moderation rules need the bot's newer API. If it has not been updated yet, this screen
              will work once it has.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {textChannels.map((c) => {
            const rule = ruleFor(c.id);
            const eff = effective(rule);
            const custom = isCustom(rule);
            const preset = PRESETS.find((p) => p.id === rule.preset) || PRESETS[2];
            const isOpen = open === c.id;
            return (
              <motion.div key={c.id} layout className="glass rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-2">
                  <Hash className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="text-sm font-medium truncate">{c.name}</span>
                  {custom && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                      custom
                    </span>
                  )}

                  {/* The preset is a row of buttons, not a dropdown: four options that
                      all fit on screen are faster to read than a menu you open. */}
                  <div className="ml-auto flex items-center gap-1">
                    {PRESETS.map((p) => {
                      const Icon = p.icon;
                      const on = rule.preset === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setPreset(c.id, p.id)}
                          className={
                            "flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition " +
                            (on
                              ? "bg-slate-700/70 text-slate-100"
                              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60")
                          }
                          data-tip={p.explain}
                        >
                          <Icon className={"w-3 h-3 " + (on ? p.tone : "")} />
                          {p.label}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setOpen(isOpen ? null : c.id)}
                      className="p-1 rounded-lg text-slate-500 hover:text-slate-200"
                      data-tip="Advanced permissions for this channel"
                    >
                      <ChevronDown
                        className={"w-3.5 h-3.5 transition-transform " + (isOpen ? "rotate-180" : "")}
                      />
                    </button>
                  </div>
                </div>

                <p className="px-3 pb-2 text-[11px] text-slate-500 -mt-0.5">{preset.explain}</p>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden border-t border-slate-700/60 bg-slate-900/30"
                    >
                      <div className="px-3 py-2 space-y-2">
                        <p className="text-[11px] text-slate-500">
                          Advanced permissions — the preset filled these in. Change one and this
                          channel becomes custom.
                        </p>
                        {SWITCHES.map((sw) => {
                          const value = String((eff as any)[sw.key] ?? "");
                          const stock = (PRESET_DEFAULTS[rule.preset] as any)?.[sw.key];
                          const changed = value !== stock;
                          return (
                            <div key={String(sw.key)} className="flex items-center gap-3 flex-wrap">
                              <span
                                className={
                                  "text-[12px] w-36 shrink-0 " + (changed ? "text-amber-300" : "text-slate-300")
                                }
                                data-tip={sw.help}
                              >
                                {sw.label}
                              </span>
                              <select
                                value={value}
                                onChange={(e) => setSwitch(c.id, sw.key, e.target.value)}
                                className="px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-700 text-[12px] focus:outline-none focus:border-indigo-500"
                              >
                                {sw.options.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                              {changed && <span className="text-[10px] text-amber-400/80">was {stock}</span>}
                            </div>
                          );
                        })}
                        <p className="text-[11px] text-slate-600 pt-1">
                          NSFW text is not checked — the bot has no detector for it yet, so there is
                          no switch for it here.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}

          {textChannels.length === 0 && (
            <p className="text-center py-10 text-sm text-slate-500">
              No text channels came back for this server.
            </p>
          )}
        </div>
      )}

      <div className="glass rounded-xl px-3 py-2 text-[11px] text-slate-500 flex items-start gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
        <p>
          Rules are saved on the bot, not in this app — so they apply whether or not the dashboard is
          open, and they survive the app being reinstalled.
        </p>
      </div>
    </div>
  );
}
