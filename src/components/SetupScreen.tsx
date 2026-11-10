import React, { useState } from "react";
import { motion } from "framer-motion";
import { Server, Eye, EyeOff, CheckCircle2, XCircle, Plug } from "lucide-react";
import { motionTokens } from "../lib/design";

export type AppSettings = {
  apiUrl: string;
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyRedirectUri: string;
  ttsEdDrop: boolean;
  ttsArmReminder: boolean;
  ttsNewMember: boolean;
  ttsVoice: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  apiUrl: "http://192.168.1.131:8080",
  spotifyClientId: "",
  spotifyClientSecret: "",
  spotifyRedirectUri: "http://127.0.0.1:5173/callback",
  ttsEdDrop: true,
  ttsArmReminder: true,
  ttsNewMember: false,
  ttsVoice: "calm",
};

const SETTINGS_KEY = "sahara_settings";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  // Migrate the old single-value key so existing installs keep working.
  const legacy = localStorage.getItem("sahara_api_url");
  return { ...DEFAULT_SETTINGS, ...(legacy ? { apiUrl: legacy } : {}) };
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  // Keep the legacy key in sync for any code still reading it.
  localStorage.setItem("sahara_api_url", s.apiUrl);
}

type Props = {
  initial: AppSettings;
  onSave: (s: AppSettings) => void;
  /** First run shows a welcome header; the settings page reuses the form. */
  firstRun?: boolean;
};

export default function SetupScreen({ initial, onSave, firstRun = false }: Props) {
  const [draft, setDraft] = useState<AppSettings>(initial);
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(draft.apiUrl.replace(/\/$/, "") + "/api/health");
      setTestResult(res.ok ? "ok" : "fail");
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  };

  const field =
    "w-full px-3 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition";
  const label = "block text-sm font-medium text-slate-300 mb-2";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="max-w-2xl"
    >
      {firstRun && (
        <header className="mb-8">
          <h1 className="text-2xl font-semibold">Welcome to Sahara</h1>
          <p className="text-slate-400 mt-2 max-w-[65ch]">
            Point the app at the machine running Babblebot, then add Spotify if you want to control
            music from here. You can change all of this later in Settings.
          </p>
        </header>
      )}

      {/* Bot API */}
      <section className="glass rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Server className="w-4 h-4 text-indigo-300" />
          <h2 className="font-semibold">Babblebot connection</h2>
        </div>
        <p className="text-sm text-slate-400 mb-5 max-w-[65ch]">
          The LAN address of the machine running the bot. Default port is 8080.
        </p>

        <label htmlFor="apiUrl" className={label}>
          API address
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="apiUrl"
            value={draft.apiUrl}
            onChange={(e) => set("apiUrl", e.target.value)}
            placeholder="http://192.168.1.131:8080"
            className={field}
          />
          <button
            onClick={testConnection}
            disabled={testing}
            className="shrink-0 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-700/60 text-sm text-slate-200 hover:bg-slate-600/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-50 transition-colors"
          >
            <Plug className="w-4 h-4" />
            {testing ? "Testing…" : "Test"}
          </button>
        </div>

        {testResult === "ok" && (
          <p className="flex items-center gap-2 text-sm text-emerald-300 mt-3">
            <CheckCircle2 className="w-4 h-4" /> Connected
          </p>
        )}
        {testResult === "fail" && (
          <p className="flex items-center gap-2 text-sm text-rose-300 mt-3">
            <XCircle className="w-4 h-4" /> Couldn&apos;t reach that address
          </p>
        )}
      </section>

      {/* Spotify */}
      <section className="glass rounded-2xl p-6 mb-6">
        <h2 className="font-semibold mb-1">Spotify</h2>
        <p className="text-sm text-slate-400 mb-5 max-w-[65ch]">
          Optional. Create an app at developer.spotify.com, then paste the credentials here. Needs
          an active Premium account.
        </p>

        <label htmlFor="spClientId" className={label}>
          Client ID
        </label>
        <input
          id="spClientId"
          value={draft.spotifyClientId}
          onChange={(e) => set("spotifyClientId", e.target.value)}
          className={field + " mb-4"}
          autoComplete="off"
          spellCheck={false}
        />

        <label htmlFor="spSecret" className={label}>
          Client secret
        </label>
        <div className="relative mb-4">
          <input
            id="spSecret"
            type={showSecret ? "text" : "password"}
            value={draft.spotifyClientSecret}
            onChange={(e) => set("spotifyClientSecret", e.target.value)}
            className={field + " pr-11"}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            aria-label={showSecret ? "Hide client secret" : "Show client secret"}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded text-slate-400 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
          >
            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <label htmlFor="spRedirect" className={label}>
          Redirect URI
        </label>
        <input
          id="spRedirect"
          value={draft.spotifyRedirectUri}
          onChange={(e) => set("spotifyRedirectUri", e.target.value)}
          className={field}
          spellCheck={false}
        />
        <p className="text-xs text-slate-500 mt-2 max-w-[65ch]">
          Must match exactly what you entered in the Spotify dashboard.
        </p>
      </section>

      {/* Voice */}
      <section className="glass rounded-2xl p-6 mb-8">
        <h2 className="font-semibold mb-1">Announcements</h2>
        <p className="text-sm text-slate-400 mb-5 max-w-[65ch]">
          Spoken alerts use a calm voice. Choose which ones you actually want to hear.
        </p>
        <div className="space-y-3">
          {[
            { key: "ttsEdDrop" as const, text: "Emergency department wait drops" },
            { key: "ttsArmReminder" as const, text: "Arm care reminders" },
            { key: "ttsNewMember" as const, text: "New member joins" },
          ].map(({ key, text }) => (
            <label
              key={key}
              className="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-800/40 cursor-pointer hover:bg-slate-800/60 transition-colors"
            >
              <span className="text-sm text-slate-300">{text}</span>
              <input
                type="checkbox"
                checked={draft[key]}
                onChange={(e) => set(key, e.target.checked)}
                className="w-4 h-4 accent-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 rounded"
              />
            </label>
          ))}
        </div>
      </section>

      <button
        onClick={() => {
          saveSettings(draft);
          onSave(draft);
        }}
        className="px-6 py-3 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 font-semibold hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition"
      >
        Save settings
      </button>
    </motion.div>
  );
}
