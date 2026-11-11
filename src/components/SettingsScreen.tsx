import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Server,
  Music,
  Volume2,
  Settings2,
  RefreshCw,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Palette,
  Bell,
  Activity,
  ExternalLink,
} from "lucide-react";
import { motionTokens } from "../lib/design";
import type { AppSettings } from "./SetupScreen";

/**
 * Settings.
 *
 * The setup wizard is for the first run; this is the screen you come back to.
 * Everything that can be changed lives here grouped by what it affects, rather
 * than behind a five-step pager.
 *
 * The update check is deliberately near the top and always visible: it is the
 * one thing you reach for when something feels stale, and it used to be buried
 * three steps into the wizard.
 */

type Props = {
  settings: AppSettings;
  onSaveSettings: (s: AppSettings) => void;
  apiUrl: string;
  onSaveApiUrl: (url: string) => void;
  theme: string;
  onSaveTheme: (t: string) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  ttsEnabled: boolean;
  onToggleTts: () => void;
  onOpenSetup: () => void;
};

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "none" }
  | { status: "found"; version: string }
  | { status: "error"; message: string };

const RELEASES = "https://github.com/Andrehoey505/sahara-dashboard/releases/latest";

function Card({
  icon: Icon,
  title,
  blurb,
  children,
  tone = "text-indigo-300",
}: {
  icon: typeof Server;
  title: string;
  blurb?: string;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <motion.section {...{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: motionTokens.enter }} className="card p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className={"w-9 h-9 rounded-xl bg-slate-800/70 flex items-center justify-center shrink-0 " + tone}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm">{title}</h3>
          {blurb && <p className="text-xs text-slate-500 mt-0.5">{blurb}</p>}
        </div>
      </div>
      {children}
    </motion.section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-800/60 last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-slate-300">{label}</p>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={
        "relative w-11 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 " +
        (on ? "bg-gradient-to-r from-indigo-500 to-violet-600" : "bg-slate-700")
      }
    >
      <span
        className={
          "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 " +
          (on ? "left-[22px]" : "left-0.5")
        }
      />
    </button>
  );
}

export default function SettingsScreen({
  settings,
  onSaveSettings,
  apiUrl,
  onSaveApiUrl,
  theme,
  onSaveTheme,
  soundEnabled,
  onToggleSound,
  ttsEnabled,
  onToggleTts,
  onOpenSetup,
}: Props) {
  const [appVersion, setAppVersion] = useState("");
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const [apiDraft, setApiDraft] = useState(apiUrl);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setAppVersion(await getVersion());
      } catch {
        setAppVersion("");
      }
    })();
  }, []);

  const checkForUpdates = async () => {
    setUpdate({ status: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const found = await check();
      if (found?.available) {
        setUpdate({ status: "found", version: found.version });
        const go = window.confirm(`Update ${found.version} available. Install now?`);
        if (go) {
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await found.downloadAndInstall();
          await relaunch();
        }
      } else {
        setUpdate({ status: "none" });
      }
    } catch (e) {
      setUpdate({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(apiDraft.replace(/\/$/, "") + "/api/health");
      setTestResult(res.ok ? "ok" : "fail");
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  };

  const saveApi = () => {
    const clean = apiDraft.trim().replace(/\/$/, "");
    setApiDraft(clean);
    onSaveApiUrl(clean);
  };

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    onSaveSettings({ ...settings, [key]: value });

  const checking = update.status === "checking";

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Updates first — it is what people come here for */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionTokens.enter}
        className="card p-5 border-indigo-500/25"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
              <Download className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-semibold">Updates</h3>
              <p className="text-xs text-slate-500">
                {appVersion ? `Version ${appVersion} installed` : "Version unknown"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={checkForUpdates}
              disabled={checking}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <RefreshCw className={"w-4 h-4 " + (checking ? "animate-spin" : "")} />
              {checking ? "Checking…" : "Check for updates"}
            </button>
            <a
              href={RELEASES}
              target="_blank"
              rel="noreferrer"
              className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              aria-label="Open releases page"
              title="Open releases page"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        {update.status === "none" && (
          <p className="mt-3 text-sm text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> You're on the latest version.
          </p>
        )}
        {update.status === "found" && (
          <p className="mt-3 text-sm text-indigo-300 flex items-center gap-2">
            <Download className="w-4 h-4" /> Version {update.version} is available.
          </p>
        )}
        {update.status === "error" && (
          <div className="mt-3 rounded-xl p-3 bg-rose-500/10 border border-rose-500/30">
            <p className="text-sm text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Update check failed
            </p>
            <p className="text-xs text-rose-300/80 mt-1 break-words">{update.message}</p>
            <p className="text-xs text-slate-400 mt-2">
              You can still download the latest installer from the releases page.
            </p>
          </div>
        )}
      </motion.section>

      <Card icon={Server} title="Babblebot connection" blurb="Where the bot's API is listening" tone="text-sky-300">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={apiDraft}
            onChange={(e) => setApiDraft(e.target.value)}
            placeholder="http://192.168.1.128:8080"
            spellCheck={false}
            className="flex-1 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={testConnection}
            disabled={testing}
            className="px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-slate-300 hover:bg-slate-700/60 disabled:opacity-40 transition-colors"
          >
            {testing ? "Testing…" : "Test"}
          </button>
          <button
            onClick={saveApi}
            className="px-3 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-sm text-indigo-200 hover:bg-indigo-500/30 transition-colors"
          >
            Save
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          {testResult === "ok" && (
            <span className="text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Bot reachable
            </span>
          )}
          {testResult === "fail" && (
            <span className="text-rose-300 flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5" /> Couldn't reach it — is the Windows machine awake?
            </span>
          )}
          {testResult === null && (
            <span className="text-slate-500">Local IP for same-network, or a tunnel URL for remote.</span>
          )}
        </div>
        <button
          onClick={onOpenSetup}
          className="mt-4 text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5"
        >
          <Settings2 className="w-3.5 h-3.5" /> Open the full setup wizard
        </button>
      </Card>

      <Card icon={Activity} title="Health features" blurb="What appears in the Health section" tone="text-rose-300">
        <Row
          label="Emergency department waits"
          hint="Shows the ED Waits tab and turns its spoken alerts on"
        >
          <Switch
            on={settings.edWaitsEnabled}
            label="Emergency department waits"
            onChange={(on) => onSaveSettings({ ...settings, edWaitsEnabled: on, ttsEdDrop: on })}
          />
        </Row>
      </Card>

      <Card icon={Volume2} title="Announcements" blurb="Which spoken alerts you actually want" tone="text-amber-300">
        <Row label="Voice announcements" hint="Master switch for all spoken alerts">
          <Switch on={ttsEnabled} onChange={onToggleTts} label="Voice announcements" />
        </Row>
        <Row label="Sound effects" hint="Beeps and chimes, no speech">
          <Switch on={soundEnabled} onChange={onToggleSound} label="Sound effects" />
        </Row>
        <Row label="ED wait drops" hint={settings.edWaitsEnabled ? "Announced when the queue shortens" : "Turn on ED waits above first"}>
          <Switch
            on={settings.ttsEdDrop && settings.edWaitsEnabled}
            label="ED wait drops"
            onChange={(on) => onSaveSettings({ ...settings, ttsEdDrop: on })}
          />
        </Row>
        <Row label="New member joins">
          <Switch
            on={settings.ttsNewMember}
            label="New member joins"
            onChange={(on) => onSaveSettings({ ...settings, ttsNewMember: on })}
          />
        </Row>
      </Card>

      <Card icon={Palette} title="Appearance" blurb="How the app looks" tone="text-fuchsia-300">
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: "dark", label: "Dark" },
            { id: "midnight", label: "Midnight" },
            { id: "light", label: "Light" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => onSaveTheme(t.id)}
              className={
                "py-3 rounded-xl text-sm border transition-colors " +
                (theme === t.id
                  ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200"
                  : "bg-slate-800/40 border-slate-700 text-slate-400 hover:bg-slate-700/50")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      <Card icon={Music} title="Spotify" blurb="Optional — control your own music here" tone="text-emerald-300">
        <Row label="Client ID" hint={settings.spotifyClientId ? "Saved" : "Not set"}>
          <span className="text-xs font-mono text-slate-500">
            {settings.spotifyClientId ? settings.spotifyClientId.slice(0, 8) + "…" : "—"}
          </span>
        </Row>
        <button
          onClick={onOpenSetup}
          className="mt-3 text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5"
        >
          <Settings2 className="w-3.5 h-3.5" /> Change Spotify credentials
        </button>
      </Card>

      <Card icon={Bell} title="About" tone="text-slate-300">
        <Row label="Sahara Dashboard" hint="Front end for Babblebot">
          <span className="text-xs font-mono text-slate-400">{appVersion || "—"}</span>
        </Row>
        <Row label="Repository">
          <a
            href="https://github.com/Andrehoey505/sahara-dashboard"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-indigo-300 hover:text-indigo-200 flex items-center gap-1"
          >
            GitHub <ExternalLink className="w-3 h-3" />
          </a>
        </Row>
      </Card>
    </div>
  );
}
