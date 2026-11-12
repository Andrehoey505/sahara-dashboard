import React, { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Server,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Plug,
  X,
  ChevronLeft,
  ChevronRight,
  Music,
  Volume2,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Download,
} from "lucide-react";
import { motionTokens } from "../lib/design";

export type AppSettings = {
  apiUrl: string;
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyRedirectUri: string;
  ttsEdDrop: boolean;
  edWaitsEnabled: boolean;
  ttsNewMember: boolean;
  ttsVoice: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  apiUrl: "http://192.168.1.128:8080",
  spotifyClientId: "",
  spotifyClientSecret: "",
  spotifyRedirectUri: "http://127.0.0.1:5173/callback",
  ttsEdDrop: true,
  edWaitsEnabled: true,
  ttsNewMember: false,
  ttsVoice: "calm",
};

const SETTINGS_KEY = "sahara_settings";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  const legacy = localStorage.getItem("sahara_api_url");
  return { ...DEFAULT_SETTINGS, ...(legacy ? { apiUrl: legacy } : {}) };
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  localStorage.setItem("sahara_api_url", s.apiUrl);
}

type Props = {
  initial: AppSettings;
  onSave: (s: AppSettings) => void;
  /** Called when dismissed without saving. Omitted on first run. */
  onClose?: () => void;
  firstRun?: boolean;
};

type StepId = "welcome" | "bot" | "spotify" | "voice" | "about" | "done";

const STEPS: { id: StepId; title: string; blurb: string; icon: typeof Server }[] = [
  { id: "welcome", title: "Welcome", blurb: "Two minutes to get Sahara talking to Babblebot", icon: Sparkles },
  { id: "bot", title: "Babblebot", blurb: "Where the bot's API is listening", icon: Server },
  { id: "spotify", title: "Spotify", blurb: "Optional — control your own music here", icon: Music },
  { id: "voice", title: "Announcements", blurb: "Which spoken alerts you actually want", icon: Volume2 },
  { id: "about", title: "About", blurb: "Version and updates", icon: RefreshCw },
  { id: "done", title: "Ready", blurb: "You're set up", icon: CheckCircle2 },
];

const field =
  "w-full px-3 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition";
const label = "block text-sm font-medium text-slate-300 mb-2";

export default function SetupScreen({ initial, onSave, onClose, firstRun = false }: Props) {
  const [draft, setDraft] = useState<AppSettings>(initial);
  const [stepIndex, setStepIndex] = useState(firstRun ? 0 : 1);
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [updateState, setUpdateState] = useState<
    { status: "idle" } | { status: "checking" } | { status: "none" } | { status: "found"; version: string } | { status: "error"; message: string }
  >({ status: "idle" });

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
    setUpdateState({ status: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update?.available) {
        setUpdateState({ status: "found", version: update.version });
        const go = window.confirm(`Update ${update.version} available. Install now?`);
        if (go) {
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await update.downloadAndInstall();
          await relaunch();
        }
      } else {
        setUpdateState({ status: "none" });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setUpdateState({ status: "error", message });
    }
  };

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const apiLooksValid = useMemo(
    () => /^https?:\/\/.+/.test(draft.apiUrl.trim()),
    [draft.apiUrl]
  );

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

  const commit = () => {
    saveSettings(draft);
    onSave(draft);
  };

  const next = () => {
    if (step.id === "bot" && !apiLooksValid) return;
    if (isLast) {
      commit();
      return;
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={motionTokens.enter}
        onClick={(e) => e.stopPropagation()}
        className="glass rounded-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <header className="accent-wash px-6 pt-6 pb-5 border-b border-slate-700/50 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
                <step.icon className="w-5 h-5" />
              </div>
              <div>
                <h2 id="setup-title" className="text-lg font-semibold leading-tight">
                  {step.title}
                </h2>
                <p className="text-sm text-slate-400 mt-0.5">{step.blurb}</p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                aria-label="Close setup"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
              
            data-tip="Close setup">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <p className="sr-only" aria-live="polite">
            Step {stepIndex + 1} of {STEPS.length}: {step.title}
          </p>
        </header>

        <div className="flex flex-1 min-h-0">
          {/* Section rail — jump straight to any section instead of paging */}
          <nav className="w-44 shrink-0 border-r border-slate-700/50 p-3 space-y-1 overflow-y-auto hidden sm:block">
            {STEPS.map((s, i) => {
              const SIcon = s.icon;
              const isCurrent = i === stepIndex;
              const isDone = i < stepIndex;
              return (
                <button
                  key={s.id}
                  onClick={() => setStepIndex(i)}
                  className={
                    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-sm transition-colors " +
                    (isCurrent
                      ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/30"
                      : isDone
                      ? "text-slate-300 hover:bg-slate-800/50 border border-transparent"
                      : "text-slate-500 hover:bg-slate-800/50 border border-transparent")
                  }
                
            data-tip="Turn this on or off">
                  <span
                    className={
                      "w-6 h-6 rounded-lg flex items-center justify-center shrink-0 " +
                      (isCurrent
                        ? "bg-gradient-to-br from-indigo-500 to-violet-600 text-white"
                        : isDone
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-slate-800/60 text-slate-500")
                    }
                  >
                    {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <SIcon className="w-3.5 h-3.5" />}
                  </span>
                  <span className="truncate">{s.title}</span>
                </button>
              );
            })}
          </nav>

        {/* Body */}
        <div className="px-6 py-6 overflow-y-auto flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={motionTokens.base}
            >
              {step.id === "welcome" && (
                <div className="space-y-4 max-w-[65ch]">
                  <p className="text-sm text-slate-300 leading-relaxed">
                    Sahara is the control centre for your Discord bot. Point it at the machine
                    running Babblebot and it can show you live moderation, member lookups,
                    emergency department waits and more.
                  </p>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    You can change any of this later in Settings. Nothing here is permanent.
                  </p>
                </div>
              )}

              {step.id === "bot" && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="apiUrl" className={label}>
                      API address
                    </label>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        id="apiUrl"
                        value={draft.apiUrl}
                        onChange={(e) => set("apiUrl", e.target.value)}
                        placeholder="http://192.168.1.128:8080"
                        spellCheck={false}
                        autoComplete="off"
                        className={field}
                      />
                      <button
                        onClick={testConnection}
                        disabled={testing || !apiLooksValid}
                        className="shrink-0 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-700/60 text-sm text-slate-200 hover:bg-slate-600/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40 transition-colors"
                      
            data-tip="Connect this service">
                        <Plug className="w-4 h-4" />
                        {testing ? "Testing…" : "Test"}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-2 max-w-[65ch]">
                      The LAN address of the machine running Babblebot. Default port is 8080.
                    </p>
                  </div>

                  {testResult === "ok" && (
                    <p className="flex items-center gap-2 text-sm text-emerald-300" role="status">
                      <CheckCircle2 className="w-4 h-4" /> Connected
                    </p>
                  )}
                  {testResult === "fail" && (
                    <p className="flex items-center gap-2 text-sm text-rose-300" role="status">
                      <XCircle className="w-4 h-4" /> Couldn&apos;t reach that address
                    </p>
                  )}
                </div>
              )}

              {step.id === "spotify" && (
                <div className="space-y-4">
                  <p className="text-sm text-slate-400 leading-relaxed max-w-[65ch]">
                    Optional. Create an app at{" "}
                    <a
                      href="https://developer.spotify.com/dashboard"
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2"
                    >
                      developer.spotify.com
                    </a>{" "}
                    and paste the credentials here. Needs an active Premium account.
                  </p>

                  <div>
                    <label htmlFor="spClientId" className={label}>
                      Client ID
                    </label>
                    <input
                      id="spClientId"
                      value={draft.spotifyClientId}
                      onChange={(e) => set("spotifyClientId", e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      className={field}
                    />
                  </div>

                  <div>
                    <label htmlFor="spSecret" className={label}>
                      Client secret
                    </label>
                    <div className="relative">
                      <input
                        id="spSecret"
                        type={showSecret ? "text" : "password"}
                        value={draft.spotifyClientSecret}
                        onChange={(e) => set("spotifyClientSecret", e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        className={field + " pr-11"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret((v) => !v)}
                        aria-label={showSecret ? "Hide client secret" : "Show client secret"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded text-slate-400 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
                       data-tip="Show or hide what you typed">
                        {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="spRedirect" className={label}>
                      Redirect URI
                    </label>
                    <input
                      id="spRedirect"
                      value={draft.spotifyRedirectUri}
                      onChange={(e) => set("spotifyRedirectUri", e.target.value)}
                      spellCheck={false}
                      className={field}
                    />
                    <p className="text-xs text-slate-500 mt-2 max-w-[65ch]">
                      Must match exactly what you entered in the Spotify dashboard.
                    </p>
                  </div>
                </div>
              )}

              {step.id === "voice" && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-400 mb-4 max-w-[65ch]">
                    Spoken alerts use a calm voice. Choose which ones you actually want to hear —
                    you can change these any time.
                  </p>
                  <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-slate-800/40 border border-indigo-500/30 cursor-pointer hover:bg-slate-800/60 transition-colors">
                    <span>
                      <span className="text-sm text-slate-200 block">Emergency department waits</span>
                      <span className="text-xs text-slate-500 block mt-0.5">
                        Shows the ED Waits tab and turns its spoken alerts on. Off hides both.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.edWaitsEnabled}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setDraft({ ...draft, edWaitsEnabled: on, ttsEdDrop: on });
                      }}
                      className="w-4 h-4 accent-indigo-500 rounded shrink-0"
                    />
                  </label>

                  {[
                    { key: "ttsEdDrop" as const, text: "Emergency department wait drops", dep: "edWaitsEnabled" as const },
                    { key: "ttsNewMember" as const, text: "New member joins" },
                  ].map(({ key, text, dep }) => (
                    <label
                      key={key}
                      className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-slate-800/40 border border-slate-700/40 cursor-pointer hover:bg-slate-800/60 transition-colors"
                    >
                      <span className={"text-sm " + (dep && !draft[dep] ? "text-slate-600" : "text-slate-300")}>{text}</span>
                      <input
                        type="checkbox"
                        checked={draft[key]}
                        disabled={!!(dep && !draft[dep])}
                        onChange={(e) => set(key, e.target.checked)}
                        className="w-4 h-4 accent-indigo-500 rounded disabled:opacity-40"
                      />
                    </label>
                  ))}
                </div>
              )}

              {step.id === "about" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3.5 rounded-lg bg-slate-800/40 border border-slate-700/40">
                    <span className="text-sm text-slate-300">Installed version</span>
                    <span className="text-sm font-mono text-slate-100">{appVersion || "unknown"}</span>
                  </div>

                  <button
                    onClick={checkForUpdates}
                    disabled={updateState.status === "checking"}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-slate-800/60 border border-indigo-500/40 text-sm text-indigo-200 hover:bg-indigo-500/15 disabled:opacity-50 transition"
                  
            data-tip="Check for a newer version now">
                    <RefreshCw className={"w-4 h-4 " + (updateState.status === "checking" ? "animate-spin" : "")} />
                    {updateState.status === "checking" ? "Checking…" : "Check for updates"}
                  </button>

                  {updateState.status === "none" && (
                    <p className="text-sm text-emerald-300 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> You're on the latest version.
                    </p>
                  )}
                  {updateState.status === "found" && (
                    <p className="text-sm text-indigo-300 flex items-center gap-2">
                      <Download className="w-4 h-4" /> Version {updateState.version} is available.
                    </p>
                  )}
                  {updateState.status === "error" && (
                    <div className="rounded-lg p-3 bg-rose-500/10 border border-rose-500/30">
                      <p className="text-sm text-rose-200">Update check failed</p>
                      <p className="text-xs text-rose-300/80 mt-1 break-words">{updateState.message}</p>
                      <p className="text-xs text-slate-400 mt-2">
                        You can always download the latest installer from the GitHub releases page.
                      </p>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-700/50">
                    <p className="text-sm font-medium text-slate-300 mb-1">Emergency department waits</p>
                    <label className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-slate-800/40 border border-slate-700/40 cursor-pointer hover:bg-slate-800/60 transition-colors">
                      <span className="text-sm text-slate-400">
                        Show the ED Waits tab and its spoken alerts
                      </span>
                      <input
                        type="checkbox"
                        checked={draft.edWaitsEnabled}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setDraft({ ...draft, edWaitsEnabled: on, ttsEdDrop: on });
                        }}
                        className="w-4 h-4 accent-indigo-500 rounded shrink-0"
                      />
                    </label>
                  </div>
                </div>
              )}

              {step.id === "done" && (
                <div className="text-center py-4">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <p className="text-sm text-slate-300 max-w-[45ch] mx-auto leading-relaxed">
                    Sahara will connect to{" "}
                    <span className="text-slate-100 font-medium">{draft.apiUrl}</span>. You can
                    change this and everything else in Settings.
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 border-t border-slate-700/50 flex items-center justify-between gap-3 shrink-0">
          <button
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={isFirst}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-0 disabled:pointer-events-none transition-colors"
           data-tip="Back a step">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>

          <div className="flex items-center gap-2">
            {!isLast && (
              <button
                onClick={() => {
                  commit();
                  onClose?.();
                }}
                className="px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
              
            data-tip="Skip the rest of setup">
                Skip setup
              </button>
            )}
            <button
              onClick={next}
              disabled={step.id === "bot" && !apiLooksValid}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 font-semibold text-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-40 transition"
            
            data-tip="Go to the next step">
              {isLast ? "Finish" : "Continue"}
              {isLast ? <ArrowRight className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </footer>
      </motion.div>
    </div>
  );
}
