import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  LayoutDashboard,
  Activity,
  Users,
  Shield,
  ShieldAlert,
  Music,
  Music2,
  Trophy,
  Smile,
  FileText,
  Settings,
  Sparkles,
  Bell,
  Search,
  ChevronRight,
  Zap,
  MessageSquare,
  AlertTriangle,
  Lock,
  LogIn,
  X,
  Trash2,
  Eye,
  VolumeX,
  Ban,
  CheckCircle,
  RefreshCw,
  Info,
  Brain,
  HeartPulse,
  SlidersHorizontal,
  Ticket,
  Database,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import EdWaits from "./components/EdWaits";
import MigraineScreen from "./components/MigraineScreen";
import SettingsScreen from "./components/SettingsScreen";
import ArmCareScreen from "./components/ArmCareScreen";
import SleepMode from "./components/SleepMode";
import MembersScreen from "./components/MembersScreen";
import ModerationScreen from "./components/ModerationScreen";
import SetupScreen, { loadSettings, saveSettings, type AppSettings } from "./components/SetupScreen";
import LockScreen from "./components/LockScreen";
import MusicScreen from "./components/MusicScreen";
import TrollWatch from "./components/TrollWatch";
import CatchUpBanner from "./components/CatchUpBanner";
import SpotifyScreen from "./components/SpotifyScreen";
import ActivitiesScreen from "./components/ActivitiesScreen";
import ReactionRoles from "./components/ReactionRoles";
import TicketScreen from "./components/TicketScreen";
import RelayScreen from "./components/RelayScreen";
import TrollsScreen from "./components/TrollsScreen";
import AuditLog from "./components/AuditLog";
import DatabaseScreen from "./components/DatabaseScreen";
import { SCREENS } from "./lib/screens";
import { areaFor, areaTone } from "./lib/design";
import ServerBar from "./components/ServerBar";
import ConfigScreen from "./components/ConfigScreen";
import { loadActiveServer, saveActiveServer, resolveActive } from "./lib/servers";
import { handleCallback, loadToken } from "./lib/spotify";
import { playCue, speak as speakText, primeVoices } from "./lib/audio";
import { formatDateTime, formatShort, formatClock, formatTitle } from "./lib/time";

// Screens whose content belongs to one server. Everything else must not show a
// server picker — it was in the global header before, in the way everywhere.
const SERVER_SCOPED = [
  "config",
  "reactionroles",
  "trollwatch",
  "trolls",
  "audit",
  "members",
  "moderation",
  "tickets",
  "relay",
];

export default function App() {
  // Finish the Spotify handshake if we came back from the authorise screen.
  const [spotifyReady, setSpotifyReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [pinSet, setPinSet] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [locked, setLocked] = useState(false);
  const [active, setActive] = useState("dashboard");
  // What the live feed draws. The API does not always send a user id (older log
  // rows carry only a name), so both are optional: a quick action that needs an
  // id has to say it has not got one rather than post the name as one.
  type FeedMessage = {
    id: number | string;
    user: string;
    user_id?: string;
    avatar?: string;
    server: string;
    server_id?: string;
    channel: string;
    content: string;
    time: string;
    flagged: boolean;
  };
  const [messages, setMessages] = useState<FeedMessage[]>([]);
  const [messagesToday, setMessagesToday] = useState(0);
  const [violationsToday, setViolationsToday] = useState(0);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [botHealthy, setBotHealthy] = useState(false);
  const [selectedServer, setSelectedServer] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("");
  const [servers, setServers] = useState<any[]>([]);
  const [activeServer, setActiveServer] = useState<string>(() => loadActiveServer());
  const chooseServer = (id: string) => {
    setActiveServer(id);
    saveActiveServer(id);
  };
  const [channels, setChannels] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [staffOnly, setStaffOnly] = useState(false);
  const [moreOptionsMsg, setMoreOptionsMsg] = useState<any>(null);
  const [moreOptionsAction, setMoreOptionsAction] = useState("warn");
  const [moreOptionsReason, setMoreOptionsReason] = useState("");
  const [violations, setViolations] = useState<any[]>([
    { id: 1, user: "wolfman_4328", server: "Bear Café", type: "profanity", severity: "medium", words: ["fuck"], time: "2m ago", status: "pending" },
    { id: 2, user: "spammer99", server: "Babble Playpen", type: "spam", severity: "high", words: ["buy now"], time: "15m ago", status: "pending" },
  ]);
  const [contextMenu, setContextMenu] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [apiUrl, setApiUrl] = useState(localStorage.getItem("sahara_api_url") || "http://localhost:8080");
  const [userProfile, setUserProfile] = useState<any>(null);
  const [showContext, setShowContext] = useState(false);
  const [contextViolation, setContextViolation] = useState<any>(null);
  const [theme, setTheme] = useState(localStorage.getItem("sahara_theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("sahara_theme", theme);
  }, [theme]);

  // Update check on launch. LOOKS only — it never downloads.
  //
  // Nothing is fetched until the user asks for it, in Settings → Check for
  // updates. An automatic download here meant a large file arriving over
  // whatever connection the machine was on, and a relaunch the user did not
  // ask for. A one-line notice is enough: it says an update exists and where
  // to go, and nothing more happens unless they go there.
  useEffect(() => {
    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!update?.available) {
          console.info("[sahara] updater: already up to date");
          return;
        }
        console.info("[sahara] updater: " + update.version + " available");
        notify(
          `Version ${update.version} is available — Settings → Check for updates`,
          "info",
          { sound: false },
        );
      } catch (e) {
        console.error("[sahara] updater check failed:", e);
        const msg = e instanceof Error ? e.message : String(e);
        // Don't nag on every launch in the browser dev server, where there is
        // no Tauri runtime and the check cannot work at all.
        if ("__TAURI_INTERNALS__" in window) {
          notify("Update check failed — " + msg, "error");
        }
      }
    })();
  }, []);

  const [trollSweepActive, setTrollSweepActive] = useState(false);
  const [trollSweepProgress, setTrollSweepProgress] = useState(0);
  const [trollSweepServer, setTrollSweepServer] = useState("");
  const [trollSweepMembers, setTrollSweepMembers] = useState(0);
  const [trollSweepResults, setTrollSweepResults] = useState<any[]>([]);
  const [violationFilter, setViolationFilter] = useState("all");
  const [trollSweepDone, setTrollSweepDone] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("sahara_user");
    const savedPin = localStorage.getItem("sahara_pin");
    const api = localStorage.getItem("sahara_api_url") || "http://localhost:8080";
    if (saved) {
      setUserId(saved);
      setUserProfile({ name: "User " + saved.slice(-4), avatar: "👤", id: saved });
      setLoggedIn(true);
      // Fetch real profile from bot API on launch (so username shows immediately)
      fetch(api + "/api/user/" + saved)
        .then((r) => r.json())
        .then((data) => {
          if (data?.name) setUserProfile({ name: data.name, avatar: "👤", id: saved, avatarUrl: data.avatar });
        })
        .catch(() => {});
    }
    if (savedPin) { setPin(savedPin); setPinSet(true); setLocked(true); }
  }, []);

  // Cleared items return on the next refresh because the feed is polled, so
  // "clear" has to mean "hide from now on": keep a set of hidden ids and filter
  // the server response through it rather than only emptying local state.
  const [hiddenMessages, setHiddenMessages] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("sahara_hidden_messages");
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<string>();
    }
  });
  const [contextMessages, setContextMessages] = useState<any>(null);
  const [hiddenViolations, setHiddenViolations] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("sahara_hidden_violations");
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<string>();
    }
  });

  const fetchData = async () => {
    try {
      const healthRes = await fetch(apiUrl + "/api/health");
      if (!healthRes.ok) throw new Error("not ok");
      setConnected(true);
      setConnectionError("");
      const [msgRes, violRes, srvRes, statsRes] = await Promise.all([
        fetch(apiUrl + "/api/messages?limit=50"),
        fetch(apiUrl + "/api/violations?limit=200" + (violationFilter !== "all" ? "&status=" + encodeURIComponent(violationFilter) : "")),
        fetch(apiUrl + "/api/servers"),
        fetch(apiUrl + "/api/stats"),
      ]);
      if (msgRes.ok) {
        const msgs = await msgRes.json();
        setMessages(
          Array.isArray(msgs)
            ? msgs.filter((m: any) => !hiddenMessages.has(String(m.id)))
            : []
        );
      }
      if (violRes.ok) {
        const newViols = await violRes.json();
        const newIds = new Set(newViols.map((v: any) => v.id));
        // Only something that has not been seen before AND is still waiting on a
        // decision is new. Announcing every id that appeared since the last poll
        // meant a resolved violation shouted again whenever its id changed shape
        // or the list was re-read — the same one "arriving" over and over.
        const added = newViols.filter(
          (v: any) =>
            v.status === "pending" &&
            !prevViolationIds.has(v.id) &&
            !hiddenViolations.has(String(v.id))
        );
        if (added.length > 0) {
          if (soundEnabled) playSound("violation");
          if (ttsEnabled) {
            const v = added[0];
            speak(`New violation: ${v.user}. ${v.full_message || v.message || v.type}`);
          }
          notify(`New violation: ${added[0].user}`, "error");
        }
        setPrevViolationIds(newIds);
        try {
          localStorage.setItem(
            "sahara_seen_violations",
            JSON.stringify(Array.from(newIds).slice(-500))
          );
        } catch {
          /* storage full or blocked — the in-memory set still works */
        }
        setViolations(newViols.filter((v: any) => !hiddenViolations.has(String(v.id))));
      }
      if (srvRes.ok) {
        const list = await srvRes.json();
        setServers(Array.isArray(list) ? list : []);
        setActiveServer((prev) => resolveActive(Array.isArray(list) ? list : [], prev));
      }
      if (statsRes.ok) {
        const d = await statsRes.json();
        setMessagesToday(d.messages_today ?? 0);
        setViolationsToday(d.violations_today ?? 0);
      }
      setBotHealthy(true);
    } catch (e) {
      setConnected(false);
      setBotHealthy(false);
      setConnectionError("Cannot reach bot API at " + apiUrl);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
    // hiddenMessageIds/hiddenViolationIds are read inside fetchData; including
    // them restarts the poll when either changes so the closure isn't stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, hiddenMessages, hiddenViolations, violationFilter]);

  // Total member count across servers. /api/members only returns a capped list,
  // so this is asked of each guild and summed; null until we have an answer.
  useEffect(() => {
    if (!connected || servers.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const totals = await Promise.all(
          servers.map((s: any) =>
            fetch(apiUrl + "/api/members?server=" + encodeURIComponent(s.id) + "&limit=2000")
              .then((r) => (r.ok ? r.json() : []))
              .then((list) => (Array.isArray(list) ? list.length : 0))
              .catch(() => 0)
          )
        );
        if (!cancelled) setMemberCount(totals.reduce((a, b) => a + b, 0));
      } catch {
        if (!cancelled) setMemberCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, apiUrl, servers.length]);

  const playSound = (type: string) => {
    const map: Record<string, any> = {
      success: "success",
      error: "error",
      violation: "violation",
      join: "join",
      sleep: "sleep",
      wake: "wake",
    };
    playCue(map[type] || "success", soundEnabled);
  };

  const speak = (text: string) => speakText(text, settings.ttsVoice !== "off");

  // Survives a reload. Held in a ref-like state seeded from localStorage so the
  // first poll after opening the app does not treat the whole backlog as new.
  const [prevViolationIds, setPrevViolationIds] = useState<Set<any>>(() => {
    try {
      const raw = localStorage.getItem("sahara_seen_violations");
      return new Set<any>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<any>();
    }
  });
  const [prevMemberIds, setPrevMemberIds] = useState<Set<any>>(new Set());
  const [ttsEnabled, setTtsEnabled] = useState(localStorage.getItem("sahara_tts") !== "off");
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem("sahara_sound") !== "off");

  const isAndre = userId === "264680643013771265";
  const [sleepMode, setSleepMode] = useState(false);
  const [edWaits, setEdWaits] = useState<{ Mater?: number; "Royal Victoria"?: number; miu?: string }>({});
  // Sleep mode: shown before the Mac is closed. Posts to the bot so anything
  // missed overnight can be surfaced on wake.
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  useEffect(() => {
    primeVoices();
  }, []);

  useEffect(() => {
    (async () => {
      let spotifyError = "";
      try {
        if (window.location.search.includes("code=")) {
          const current = loadSettings();
          if (!current.spotifyClientId) {
            spotifyError = "Spotify returned a code, but no Client ID is saved.";
          } else {
            await handleCallback(current.spotifyClientId, current.spotifyRedirectUri);
            // Land on the Spotify screen so the result is visible.
            setActive("spotify");
          }
        }
      } catch (e: any) {
        // Surface it rather than only logging — this is the one place a silent
        // failure leaves the user staring at a screen that never changes.
        spotifyError = e?.message || "Spotify connection failed";
        console.warn("Spotify callback failed", e);
      } finally {
        if (spotifyError) {
          try {
            sessionStorage.setItem("sahara_spotify_error", spotifyError);
          } catch {}
        }
        setSpotifyReady(true);
      }
    })();
  }, []);
  const [showSetup, setShowSetup] = useState(false);
  const [showSleep, setShowSleep] = useState(false);
  const [catchUp, setCatchUp] = useState<{ flags: number; since?: string | null } | null>(null);
  // Seed from cache only if it is recent: a stale baseline would report a drop
  // that already happened, or hide one that just did.
  const _cachedWaits = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem("sahara_ed_waits") || "null");
      if (!raw || !raw.waits) return {};
      const age = Date.now() - (raw.fetch || 0);
      return age <= 10 * 60 * 1000 ? raw.waits : {};
    } catch {
      return {};
    }
  })();
  const prevWaitsRef = useRef<{ Mater?: number; "Royal Victoria"?: number }>(_cachedWaits);
  const [edLastUpdate, setEdLastUpdate] = useState("");
  const [edStale, setEdStale] = useState(false);
  const [edLastFetch, setEdLastFetch] = useState<number>(0);
  const [edNow, setEdNow] = useState<number>(Date.now());

  // Live ED waiting times
  const fetchEd = useCallback(async () => {
    if (!isAndre || !loggedIn) return;
    try {
      const res = await fetch(apiUrl + "/api/ed-waits");
      if (!res.ok) throw new Error("not ok");
      const data = await res.json().catch(() => ({}));
      if (data.waits && Object.keys(data.waits).length) {
        // Check if waits dropped (only if not in sleep mode)
        try {
          if (!sleepMode && settings.edWaitsEnabled && settings.ttsEdDrop) {
            const prev = prevWaitsRef.current;
            const drops: {key:string; start:string; amount:number}[] = [];
            if (prev && data.waits.Mater != null && prev.Mater != null && data.waits.Mater < prev.Mater) {
              drops.push({key:'Mater', start:'/sounds/mater_drop_start.ogg', amount: prev.Mater - data.waits.Mater});
            }
            if (prev && data.waits["Royal Victoria"] != null && prev["Royal Victoria"] != null && data.waits["Royal Victoria"] < prev["Royal Victoria"]) {
              drops.push({key:'Royal Victoria', start:'/sounds/royal_drop_start.ogg', amount: prev["Royal Victoria"] - data.waits["Royal Victoria"]});
            }
            if (drops.length) {
              // Play a sound clip and resolve when it finishes (or immediately
              // if it can't play, so a blocked beep can't silence the rest).
              const playClip = (src: string) =>
                new Promise<void>((resolve) => {
                  try {
                    const audio = new Audio(src);
                    audio.onended = () => resolve();
                    audio.onerror = () => resolve();
                    const p = audio.play();
                    if (p) p.catch(() => resolve());
                    // Backstop: a clip that never fires onended must not wedge
                    // the sequence.
                    setTimeout(resolve, 8000);
                  } catch {
                    resolve();
                  }
                });

              // Sequence: beep → Sahara's "wait dropped" clip → number (mac
              // TTS) → Sahara's "minutes" clip. Each step waits for the last.
              const runSequence = async () => {
                await playClip('/sounds/alarm_beep.wav');
                for (const d of drops) {
                  await playClip(d.start);
                  await speakText(String(d.amount), settings.ttsVoice !== "off");
                  await playClip('/sounds/minutes_end.ogg');
                }
              };
              runSequence().catch(() => {});
            }
          }
        } catch {}
        prevWaitsRef.current = data.waits;
        setEdWaits(data.waits);
        if (data.last_updated) setEdLastUpdate(data.last_updated);
        setEdStale(!!data.stale);
        setEdLastFetch(Date.now());
        try { localStorage.setItem("sahara_ed_waits", JSON.stringify({ waits: data.waits, last_updated: data.last_updated, fetch: Date.now() })); } catch {}
      } else {
        setEdStale(true);
      }
    } catch {
      // Dead API fallback: load last known from localStorage
      try {
        const cached = JSON.parse(localStorage.getItem("sahara_ed_waits") || "null");
        if (cached && cached.waits) {
          setEdWaits(cached.waits);
          if (cached.last_updated) setEdLastUpdate(cached.last_updated);
          setEdLastFetch(cached.fetch || 0);
        }
      } catch {}
      setEdStale(true);
    }
  }, [isAndre, loggedIn, apiUrl, sleepMode]);

  useEffect(() => {
    if (!isAndre || !loggedIn) return;
    fetchEd();
    // A hospital's time can move every 20 minutes, so poll well inside that
    // window to catch each published change rather than jumping over several.
    const interval = setInterval(fetchEd, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAndre, loggedIn, fetchEd]);

  useEffect(() => {
    const t = setInterval(() => setEdNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  // Toasts. Errors and violations stay up longer than a plain acknowledgement,
  // because they carry information the user may need to act on. Hovering a toast
  // clears its timer so it can be read without racing it.
  const toastSeq = useRef(0);
  const toastTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismissToast = useCallback((id: number) => {
    const t = toastTimers.current[id];
    if (t) { clearTimeout(t); delete toastTimers.current[id]; }
    setNotifications((n) => n.filter((x) => x.id !== id));
  }, []);

  const armToastTimer = useCallback((id: number, life: number) => {
    const t = toastTimers.current[id];
    if (t) clearTimeout(t);
    toastTimers.current[id] = setTimeout(() => {
      delete toastTimers.current[id];
      setNotifications((n) => n.filter((x) => x.id !== id));
    }, life);
  }, []);

  const notify = (msg: any, type = "info", opts?: { sound?: boolean }) => {
    // Repeated status chatter ("No new notifications", "Feed cleared") shouldn't
    // chirp every time; anything that reports an outcome or a failure keeps its
    // cue. Callers can force either way with opts.sound.
    const quietTypes = new Set(["info"]);
    const shouldSound = opts?.sound ?? !quietTypes.has(type);
    if (shouldSound) playSound(type);
    const id = ++toastSeq.current;
    setNotifications((n) => {
      // Cap the stack so a burst can't fill the screen; drop the oldest.
      const next = [...n, { id, msg, type }];
      return next.length > 4 ? next.slice(next.length - 4) : next;
    });
    armToastTimer(id, type === "error" || type === "violation" ? 6000 : 3200);
  };

  useEffect(() => {
    if (!selectedServer || !connected) return;
    fetch(apiUrl + "/api/channels?server=" + encodeURIComponent(selectedServer)).then(r => r.json()).then(setChannels).catch(() => {});
    fetch(apiUrl + "/api/members?server=" + encodeURIComponent(selectedServer) + "&staff_only=" + staffOnly).then(r => r.json()).then((m) => {
      const newIds = new Set((m || []).map((x: any) => x.id));
      const added = (m || []).filter((x: any) => !prevMemberIds.has(x.id) && prevMemberIds.size > 0);
      if (added.length > 0) {
        if (soundEnabled) playSound("join");
        if (settings.ttsNewMember) speak(`New member joined: ${added[0].display_name || added[0].name}`);
        notify(`New member: ${added[0].display_name || added[0].name}`, "info");
      }
      setPrevMemberIds(newIds);
      setMembers(m || []);
    }).catch(() => {});
  }, [selectedServer, staffOnly, connected, apiUrl]);

  const handleLogin = async () => {
    if (!userId.trim()) { notify("Enter your Discord User ID", "error"); return; }
    localStorage.setItem("sahara_user", userId);
    try {
      const res = await fetch(apiUrl + "/api/user/" + userId);
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.error) data.error = `HTTP ${res.status}`;
      if (data.name) setUserProfile({ name: data.name, avatar: "👤", id: userId, avatarUrl: data.avatar });
      else setUserProfile({ name: "User " + userId.slice(-4), avatar: "👤", id: userId });
    } catch (e) {
      setUserProfile({ name: "User " + userId.slice(-4), avatar: "👤", id: userId });
    }
    setLoggedIn(true);
    notify("Welcome back!", "success");
  };

  const handleSetPin = () => {
    if (pin.length < 4) { notify("PIN must be 4+ digits", "error"); return; }
    localStorage.setItem("sahara_pin", pin);
    setPinSet(true);
    notify("PIN set!", "success");
  };

  const handleUnlock = () => {
    if (pinInput === pin) { setLocked(false); setPinInput(""); notify("Unlocked!", "success"); }
    else { notify("Wrong PIN", "error"); setPinInput(""); }
  };

  const runTrollSweep = async () => {
    setTrollSweepActive(true);
    setTrollSweepDone(false);
    setTrollSweepProgress(0);
    setTrollSweepResults([]);
    // Both of these assumed the reply was a JSON list. An error reply is an
    // object, so `srvs.length` was undefined and the loop either skipped
    // silently or threw on a non-array — the sweep looked like it had found
    // nothing rather than like it had failed.
    let srvs: any[] = servers;
    if (!srvs.length) {
      try {
        const r = await fetch(apiUrl + "/api/servers");
        const body = await r.json().catch(() => null);
        srvs = Array.isArray(body) ? body : [];
      } catch {
        srvs = [];
      }
    }
    if (!srvs.length) {
      notify("Couldn't read the server list — check the bot is reachable.", "error");
      setTrollSweepDone(true);
      return;
    }
    const total = srvs.length;
    for (let i = 0; i < srvs.length; i++) {
      const s = srvs[i];
      setTrollSweepServer(s.name);
      setTrollSweepProgress(Math.round(((i) / total) * 100));
      try {
        const mres = await fetch(apiUrl + "/api/members?server=" + encodeURIComponent(s.name));
        const mbody = await mres.json().catch(() => null);
        const members = Array.isArray(mbody) ? mbody : [];
        if (!Array.isArray(mbody)) {
          // Name the server that failed instead of quietly counting zero.
          notify(`Couldn't read members for ${s.name}`, "error");
        }
        setTrollSweepMembers((prev) => prev + (members?.length || 0));
        // Check for suspicious patterns (new accounts, no avatar, etc.)
        // Only things the bot actually knows are suspicious. No avatar and a
        // short name were flagging ordinary members (and bots).
        const suspicious = (members || []).filter(
          (m: any) =>
            !m.is_troll === false &&
            (m.is_troll === true ||
              (typeof m.account_age_days === "number" && m.account_age_days < 2))
        );
        if (suspicious.length > 0) {
          const named = suspicious
            .filter((u: any) => !u.bot)
            .map((u: any) => u.display_name || u.name);
          if (named.length > 0) {
            setTrollSweepResults((prev) => [...prev, { server: s.name, count: named.length, users: named }]);
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 800));
    }
    setTrollSweepProgress(100);
    setTrollSweepDone(true);
  };

  const persistHidden = (key: string, ids: Set<string>) => {
    try {
      // Keep the list bounded — older ids fall off the end.
      const arr = Array.from(ids).slice(-500);
      localStorage.setItem(key, JSON.stringify(arr));
    } catch {}
  };

  const hideMessage = (id: string) => {
    setHiddenMessages((prev) => {
      const next = new Set(prev).add(String(id));
      persistHidden("sahara_hidden_messages", next);
      return next;
    });
    setMessages((msgs) => msgs.filter((x) => String(x.id) !== String(id)));
  };

  const clearFeed = () => {
    setHiddenMessages((prev) => {
      const next = new Set(prev);
      messages.forEach((m) => next.add(String(m.id)));
      persistHidden("sahara_hidden_messages", next);
      return next;
    });
    setMessages([]);
    notify("Feed cleared", "info", { sound: false });
  };

  // Clearing hides ids for the session. A violation that still exists on the bot
  // must always be reachable again, or "clear" is indistinguishable from "gone".
  const showHiddenViolations = () => {
    setHiddenViolations(new Set());
    persistHidden("sahara_hidden_violations", new Set());
    notify("Hidden violations are showing again", "info", { sound: false });
  };
  const hiddenViolationCount = hiddenViolations.size;

  const clearViolations = () => {
    setHiddenViolations((prev) => {
      const next = new Set(prev);
      violations.forEach((v) => next.add(String(v.id)));
      persistHidden("sahara_hidden_violations", next);
      return next;
    });
    setViolations([]);
    notify("Violations cleared", "info", { sound: false });
  };

  // One shared formatter, so a moment reads the same on every screen.
  const fmtTime = (ts: string) => formatDateTime(ts) || ts;

  const handleContextAction = async (action: any, msg: any) => {
    setContextMenu(null);
    if (action === "approve" || action === "deny" || action === "undo") {
      // The old version never checked the response, so a failed save still
      // looked like it worked and came back wrong on the next refresh.
      try {
        const res = await fetch(apiUrl + "/api/violation/" + encodeURIComponent(msg.id) + "/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: action === "undo" ? "pending" : action,
            user: msg.user,
            server: msg.server,
            channel: msg.channel || "",
            type: msg.type,
            words: msg.words || [],
            message: msg.full_message || msg.message || "",
            timestamp: msg.timestamp || msg.time || "",
            // A decision may already be filed under one of these; the bot moves
            // it across rather than leaving it stranded under an old scheme.
            alias_keys: msg.alias_keys || [],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          notify(data.error || "Couldn't save that decision", "error");
          return;
        }
        const status = data.status === "resolved" ? "resolved" : data.status === "denied" ? "denied" : "pending";
        setViolations((v) =>
          v.map((x) =>
            x.id === msg.id
              ? { ...x, status, decided_at: status === "pending" ? undefined : new Date().toISOString() }
              : x
          )
        );
        notify(
          status === "pending" ? "Undone" : status === "resolved" ? "Approved" : "Denied",
          status === "denied" ? "error" : "success"
        );
        // Re-read from the bot. Updating local state alone is how a decision
        // that did not stick kept looking done until the next poll put it back.
        fetchData();
      } catch {
        notify("Connection failed — is the bot reachable?", "error");
      }
    } else if (action === "delete") {
      setMessages((m) => m.filter((x) => x.id !== msg.id));
      notify("Deleted", "success");
    } else {
      notify(action + " " + msg.user, "success");
    }
  };

  useEffect(() => {
    if (!contextViolation) {
      setContextMessages(null);
      return;
    }
    // A violation carries a channel name; the bot's context endpoint matches on
    // id or name, and a name is all a violation has.
    const channel = contextViolation.channel;
    if (!channel) {
      setContextMessages(null);
      return;
    }
    let cancelled = false;
    // The violation's own endpoint. The generic /api/context reads the log by
    // channel and timestamp, which cannot tell two violations in the same
    // channel apart, and returns no flagged message at all.
    const params = new URLSearchParams({ before: "4", after: "4" });
    if (contextViolation.server) params.set("guild_id", String(contextViolation.server));
    fetch(apiUrl + "/api/violations/" + encodeURIComponent(contextViolation.id) + "/context?" + params.toString())
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) return { error: body?.error || "Couldn't read the conversation." };
        return body;
      })
      .then((d) => {
        if (!cancelled) setContextMessages(d);
      })
      .catch(() => {
        if (!cancelled) setContextMessages(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, contextViolation]);

  const filteredMessages = messages.filter((m) =>
    (!selectedServer || m.server === selectedServer) &&
    (!selectedChannel || m.channel === selectedChannel) &&
    (m.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
     m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
     m.server.toLowerCase().includes(searchQuery.toLowerCase()))
  );
  const filteredViolations = violations.filter((v) => violationFilter === "all" || v.status === violationFilter);

  if (!spotifyReady) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  if (locked) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <LockScreen
          value={pinInput}
          onChange={setPinInput}
          onSubmit={handleUnlock}
          error={!!pinInput && pinInput !== pin}
        />
      </div>
    );
  }

  if (!connected || showSetup) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="max-w-3xl mx-auto p-6">
          {!showSetup && (
            <header className="mb-6">
              <h1 className="text-xl font-semibold">Sahara Dashboard</h1>
              <p className="text-sm text-slate-400 mt-1">
                {connectionError || "Set up the connection to Babblebot to continue."}
              </p>
            </header>
          )}
          <SetupScreen
            initial={settings}
            firstRun={!showSetup}
            onClose={showSetup ? () => setShowSetup(false) : undefined}
            onSave={(next) => {
              setSettings(next);
              setApiUrl(next.apiUrl);
              setShowSetup(false);
              fetchData();
            }}
          />
        </div>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="glass rounded-2xl p-8 w-full max-w-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center"><Sparkles className="w-6 h-6" /></div>
            <div><h1 className="text-2xl font-semibold">Sahara</h1><p className="text-sm text-slate-400">Control Center</p></div>
          </div>
          <label htmlFor="userId" className="text-sm text-slate-300 mb-2 block">Discord User ID</label>
          <input id="userId" value={userId} onChange={(e) => setUserId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} placeholder="Your Discord User ID" className="w-full px-4 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 mb-4 transition" />
          <button onClick={handleLogin} className="w-full py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 font-semibold hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition flex items-center justify-center gap-2" data-tip="Sign in to the dashboard"><LogIn className="w-4 h-4" /> Sign In</button>
          <p className="text-xs text-slate-500 mt-3 max-w-[65ch]">
            Your user ID links this app to you across sessions. The PIN lock is separate and asked on launch.
          </p>
        </div>
      </div>
    );
  }

  // Sidebar is grouped rather than one flat list: at 14 entries it had stopped
  // being scannable. Each group is a heading with its items under it.
const NAV: { group: string; items: { id: string; label: string; icon: typeof LayoutDashboard }[] }[] = [
    {
      group: "Overview",
      items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }],
    },
    {
      group: "Health",
      items: [
        { id: "migraine", label: "Migraine Diary", icon: Brain },
        { id: "armcare", label: "Arm Care", icon: HeartPulse },
        ...(settings.edWaitsEnabled ? [{ id: "edwaits", label: "ED Waits", icon: Activity }] : []),
      ],
    },
    {
      group: "Server",
      items: [
        { id: "livefeed", label: "Live Messages", icon: MessageSquare },
        { id: "members", label: "Members", icon: Users },
        { id: "activities", label: "Activities", icon: Trophy },
        { id: "reactionroles", label: "Reaction Roles", icon: Smile },
      ],
    },
    {
      group: "Moderation",
      items: [
        { id: "moderation", label: "Moderation", icon: Shield },
        { id: "violations", label: "Violations", icon: AlertTriangle },
        { id: "trollwatch", label: "Troll Watch", icon: ShieldAlert },
        { id: "trolls", label: "Troll List", icon: Shield },
        { id: "audit", label: "Server Log", icon: FileText },
      ],
    },
    {
      group: "Bot",
      items: [
        { id: "config", label: "Server Settings", icon: SlidersHorizontal },
        { id: "tickets", label: "Tickets", icon: Ticket },
        { id: "relay", label: "Texan Relay", icon: Sparkles },
        { id: "database", label: "Database", icon: Database },
      ],
    },
    {
      group: "Media",
      items: [
        { id: "music", label: "Music", icon: Music },
        { id: "spotify", label: "Spotify", icon: Music2 },
      ],
    },
    {
      group: "",
      items: [{ id: "settings", label: "Settings", icon: Settings }],
    },
  ];

  // Dev-time safety net: every nav item must have a screen defined below.
  // (A screen that exists in NAV but has no render block used to fail silently,
  // showing a heading with nothing under it.)
  if ((import.meta as any).env?.DEV) {
    NAV.flatMap((g) => g.items).forEach(({ id, label }) => {
      if (!(SCREENS as readonly string[]).includes(id)) {
        console.warn(
          `[sahara] "${label}" (${id}) is in the nav but has no screen. ` +
            "Add it to SCREENS and give it a render block."
        );
      }
    });
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {contextViolation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setContextViolation(null)}>
          <div className="glass rounded-2xl p-6 w-[500px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Violation Context</h3>
              <button onClick={() => setContextViolation(null)} className="text-slate-400 hover:text-slate-200"
            data-tip="Close this panel"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-slate-800/30">
                <p className="text-xs text-slate-500 mb-1">Flagged message by {contextViolation.user} in {contextViolation.server}</p>
                <p className="text-sm font-medium mb-2">"{contextViolation.full_message || contextViolation.message}"</p>
                <p className="text-xs text-slate-400">Flagged words: {contextViolation.words?.join(", ")}</p>
              </div>
              {contextMessages ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">
                    Conversation in{" "}
                    {contextViolation.channel ? `#${contextViolation.channel}` : "channel"}
                    <span className="ml-1.5 opacity-60">
                      {(contextMessages.before || []).length} before ·{" "}
                      {(contextMessages.after || []).length} after
                    </span>
                  </p>
                  <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                    {(contextMessages.before || []).length === 0 &&
                      (contextMessages.after || []).length === 0 && (
                        <p className="text-xs text-slate-500 p-2">
                          Nothing either side of it — this may be the only message in
                          the channel that the bot still has.
                        </p>
                      )}
                    {[...(contextMessages.before || []), contextMessages.target, ...(contextMessages.after || [])]
                      .filter(Boolean)
                      .map((m: any, i: number) => (
                        <div
                          key={i}
                          className={
                            "text-xs p-2 rounded border " +
                            (m.flagged
                              ? "bg-rose-500/15 border-rose-500/40 text-rose-100"
                              : "bg-slate-800/30 border-transparent text-slate-400")
                          }
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span
                              className={
                                "font-medium " +
                                (m.flagged ? "text-rose-200" : "text-slate-300")
                              }
                            >
                              {m.author}
                            </span>
                            {m.flagged && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-500/25 text-rose-200 text-[10px] uppercase tracking-wide">
                                {m.reason || "flagged"}
                              </span>
                            )}
                            {m.flagged && m.deleted && (
                              <span
                                className="px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 text-[10px]"
                                title="The bot deleted this message, so the text shown is the copy from the log" data-tip="The bot deleted this message, so the text shown is the copy from the log"
                              >
                                deleted
                              </span>
                            )}
                            {m.time && (
                              <span className="ml-auto text-[10px] text-slate-500">
                                {formatClock(m.time)}
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap break-words">
                            {m.content || <span className="italic opacity-60">(no text stored)</span>}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Reading the conversation…</p>
              )}

              <div className="text-xs text-slate-500 grid grid-cols-2 gap-2">
                <div className="p-2 rounded bg-slate-800/20">
                  <p className="mb-1">Severity</p>
                  <p className="text-slate-300 capitalize">{contextViolation.severity || "unknown"}</p>
                </div>
                <div className="p-2 rounded bg-slate-800/20">
                  <p className="mb-1">Channel</p>
                  <p className="text-slate-300">{contextViolation.channel ? `#${contextViolation.channel}` : "—"}</p>
                </div>
                <div className="p-2 rounded bg-slate-800/20">
                  <p className="mb-1">Type</p>
                  <p className="text-slate-300">{contextViolation.type || "unknown"}</p>
                </div>
                <div className="p-2 rounded bg-slate-800/20">
                  <p className="mb-1">Flagged</p>
                  <p className="text-slate-300">
                    {contextViolation.time
                      ? formatShort(contextViolation.time) || "—"
                      : "—"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => { handleContextAction("approve", contextViolation); setContextViolation(null); }} className="flex-1 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 text-sm hover:bg-emerald-500/30" data-tip="Approve — action the member as suggested">Approve</button>
                <button onClick={() => { handleContextAction("deny", contextViolation); setContextViolation(null); }} className="flex-1 py-2 rounded-lg bg-rose-500/20 text-rose-300 text-sm hover:bg-rose-500/30" data-tip="Deny — leave the member alone">Deny</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-[min(22rem,calc(100vw-2rem))]" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {notifications.map((n) => {
            const tone =
              n.type === "success"
                ? { border: "border-emerald-400/30", glow: "shadow-emerald-500/10", icon: "text-emerald-300", bar: "bg-emerald-400/70", accent: "bg-emerald-400" }
                : n.type === "error"
                ? { border: "border-rose-400/30", glow: "shadow-rose-500/10", icon: "text-rose-300", bar: "bg-rose-400/70", accent: "bg-rose-400" }
                : n.type === "violation"
                ? { border: "border-amber-400/30", glow: "shadow-amber-500/10", icon: "text-amber-300", bar: "bg-amber-400/70", accent: "bg-amber-400" }
                : { border: "border-indigo-400/30", glow: "shadow-indigo-500/10", icon: "text-indigo-300", bar: "bg-indigo-400/70", accent: "bg-indigo-400" };
            const Icon = n.type === "success" ? CheckCircle : n.type === "error" || n.type === "violation" ? AlertTriangle : Info;
            return (
              <motion.div
                key={n.id}
                layout
                initial={{ opacity: 0, x: 24, scale: 0.97 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.97, transition: { duration: 0.18 } }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
                onMouseEnter={() => {
                  const t = toastTimers.current[n.id];
                  if (t) { clearTimeout(t); delete toastTimers.current[n.id]; }
                }}
                onMouseLeave={() => armToastTimer(n.id, 1800)}
                className={"relative overflow-hidden rounded-xl border backdrop-blur-xl bg-slate-900/80 px-3.5 py-3 shadow-xl " + tone.border + " " + tone.glow}
              >
                <div className="flex items-start gap-2.5">
                  <Icon className={"w-4 h-4 mt-0.5 shrink-0 " + tone.icon} />
                  <p className="text-sm text-slate-200 leading-snug flex-1 break-words">{n.msg}</p>
                  <button
                    onClick={() => dismissToast(n.id)}
                    aria-label="Dismiss"
                    className="shrink-0 -mr-1 -mt-1 p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-700/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
                   data-tip="Dismiss this notification">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <motion.div
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{ duration: (n.type === "error" || n.type === "violation" ? 6000 : 3200) / 1000, ease: "linear" }}
                  className={"absolute bottom-0 left-0 right-0 h-0.5 origin-left " + tone.accent + " opacity-40"}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {contextMenu && (
        <div className="fixed z-40 glass rounded-lg py-1 shadow-xl min-w-[160px]" style={{ top: contextMenu.y, left: contextMenu.x }}>
          {[
            { action: "view", label: "View Profile", icon: Eye },
            { action: "approve", label: "Approve", icon: CheckCircle },
            { action: "deny", label: "Deny", icon: X },
            { action: "mute", label: "Mute User", icon: VolumeX },
            { action: "ban", label: "Ban User", icon: Ban },
            { action: "delete", label: "Delete Message", icon: Trash2 },
          ].map((a) => {
            const Icon = a.icon;
            return <button key={a.action} onClick={() => handleContextAction(a.action, contextMenu.msg)} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-700/50 transition text-left" data-tip="Apply this action to the message"><Icon className="w-3.5 h-3.5" /> {a.label}</button>;
          })}
        </div>
      )}

      <aside className="w-60 glass flex flex-col p-4">
        <div className="flex items-center gap-3 px-2 py-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center"><Sparkles className="w-5 h-5" /></div>
          <div><h1 className="font-bold text-lg">Sahara</h1><p className="text-xs text-slate-400">Control Center</p></div>
        </div>
        <nav className="flex-1 overflow-y-auto space-y-4 pr-1">
          {NAV.map((group, gi) => (
            <div key={group.group || "root-" + gi} className="space-y-0.5">
              {group.group && (
                <p className="flex items-center gap-2 px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  <span className={"w-1.5 h-1.5 rounded-full " + (areaTone[group.group.toLowerCase() as keyof typeof areaTone]?.dot ?? "bg-slate-500")} />
                  {group.group}
                </p>
              )}
              {group.items.map((n) => {
                const Icon = n.icon;
                const isActive = active === n.id;
                const tone = areaFor(n.id);
                return (
                  <button
                    key={n.id}
                    onClick={() => setActive(n.id)}
                    className={
                      "group relative w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-150 " +
                      (isActive
                        ? tone.soft + " " + tone.text + " border " + tone.border
                        : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 border border-transparent")
                    }
                  
            data-tip="Switch the bot in and out of sleep mode">
                    <span
                      className={
                        "w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors " +
                        (isActive ? "bg-gradient-to-br " + tone.grad + " text-white" : "bg-slate-800/60 text-slate-400 group-hover:text-slate-200")
                      }
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="truncate">{n.label}</span>
                    {isActive && <ChevronRight className="w-3 h-3 ml-auto shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="mt-4 p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">{userProfile?.avatar || "👤"}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{userProfile?.name || "User"}</p>
              <p className="text-xs text-slate-500 font-mono truncate">{userId}</p>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
          <button onClick={() => { setLocked(true); notify("Locked", "success"); }} className="flex-1 text-xs py-1 rounded bg-slate-700/50 hover:bg-slate-600/50 transition" data-tip="Lock the app — needs your PIN to unlock">Lock</button>
          <button onClick={() => { localStorage.removeItem("sahara_user"); setLoggedIn(false); }} className="flex-1 text-xs py-1 rounded bg-slate-700/50 hover:bg-slate-600/50 transition" data-tip="Sign out and forget this login">Sign Out</button>
          </div>
          {isAndre && (
          <button onClick={() => {
            if (!sleepMode) {
              setShowSleep(true);
            } else {
              setSleepMode(false);
              notify("Welcome back", "success");
              if (soundEnabled) playSound("wake");
              fetch(apiUrl.replace(/\/$/, "") + "/api/sleep", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sleeping: false }),
              })
                .then((r) => r.json())
                .then((d) => {
                  if (d?.catch_up?.flags > 0) {
                    setCatchUp({ flags: d.catch_up.flags, since: d.catch_up.since });
                  }
                })
                .catch(() => {});
            }
          }} className={"mt-2 w-full text-xs py-1 rounded transition " + (sleepMode ? "bg-amber-500/20 text-amber-300" : "bg-slate-700/50 text-slate-300 hover:bg-slate-600/50")}
            data-tip="Put the bot to sleep or wake it up">{sleepMode ? "☀️ Wake up" : "🌙 Going to sleep"}</button>
          )}
        </div>
        {!pinSet && (
          <div className="mt-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-xs text-amber-300 mb-2">Set a PIN to lock the app</p>
            <div className="flex gap-2">
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" className="flex-1 px-2 py-1 rounded bg-slate-800/50 border border-slate-700 text-xs focus:outline-none" />
              <button onClick={handleSetPin} className="px-2 py-1 rounded bg-amber-500/20 text-amber-300 text-xs hover:bg-amber-500/30" data-tip="Save this PIN">Set</button>
            </div>
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto thin-scroll p-6">
        {/* Keyed on the screen so the whole body is replaced on navigation.
            Without this a stale subtree could survive a tab change and leave the
            server bar sitting over screens that have nothing to do with it. */}
        <div key={active}>
        {catchUp && (
          <div className="mb-4">
            <CatchUpBanner
              flags={catchUp.flags}
              since={catchUp.since}
              onDismiss={() => setCatchUp(null)}
            />
          </div>
        )}
        {SERVER_SCOPED.includes(active) && (
          <ServerBar
            servers={servers}
            active={activeServer}
            onSelect={chooseServer}
            label="Server"
            hint={
              servers.length > 1
                ? "Everything on this screen follows the server you pick."
                : undefined
            }
          />
        )}

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className={"w-1.5 h-9 rounded-full bg-gradient-to-b " + areaFor(active).grad} />
            <div>
              <h2 className="screen-title capitalize">{active.replace("livefeed", "Live Messages")}</h2>
              <p className={"text-sm " + areaFor(active).text}>{areaFor(active).name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search..." className="pl-9 pr-4 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 w-64" />
            </div>
            <button onClick={() => notify("No new notifications", "info", { sound: false })} className="p-2 rounded-lg bg-slate-800/50 border border-slate-700 hover:bg-slate-700/50 relative" data-tip="Notifications">
              <Bell className="w-4 h-4" />
            </button>
            <div
              className={
                "flex items-center gap-2 px-3 py-1.5 rounded-lg border " +
                (botHealthy
                  ? "bg-emerald-500/10 border-emerald-500/30"
                  : "bg-rose-500/10 border-rose-500/30")
              }
              role="status"
            >
              <span
                className={
                  "w-2 h-2 rounded-full " +
                  (botHealthy ? "bg-emerald-400 animate-pulse" : "bg-rose-400")
                }
              />
              <span className={"text-xs " + (botHealthy ? "text-emerald-300" : "text-rose-300")}>
                {botHealthy ? "Bot online" : "Bot unreachable"}
              </span>
            </div>
          </div>
        </div>

        {active === "dashboard" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="grid grid-cols-4 gap-4 mb-6">
              {[
                {
                  label: "Servers",
                  value: servers.length ? servers.length.toLocaleString() : "—",
                  color: "from-indigo-500 to-violet-500",
                  hint: "",
                },
                {
                  label: "Members",
                  value:
                    memberCount != null
                      ? memberCount.toLocaleString()
                      : members.length
                        ? `${members.length.toLocaleString()}+`
                        : "—",
                  color: "from-cyan-500 to-blue-500",
                  hint: memberCount == null ? "across loaded servers" : "",
                },
                {
                  label: "Messages today",
                  value: messagesToday.toLocaleString(),
                  color: "from-emerald-500 to-teal-500",
                  hint: "",
                },
                {
                  label: "Violations today",
                  value: violationsToday.toLocaleString(),
                  color: "from-rose-500 to-orange-500",
                  hint: violations.filter((v) => v.status === "pending").length
                    ? `${violations.filter((v) => v.status === "pending").length} pending review`
                    : "",
                },
              ].map((s) => (
                <div key={s.label} className="glass rounded-xl p-4">
                  <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                  <span className="text-2xl font-bold tabular-nums">{s.value}</span>
                  {s.hint && <p className="text-[11px] text-slate-500 mt-1">{s.hint}</p>}
                  <div className={"h-1 mt-3 rounded-full bg-gradient-to-r " + s.color + " opacity-60"} />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 glass rounded-xl p-4">
                <h3 className="font-semibold mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-400" /> Live Activity</h3>
                <div className="space-y-2">
                  {messages.slice(0, 5).map((m) => (
                    <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/30">
                      <span className="text-lg">{m.avatar}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{m.user}</span>
                        <span className="text-xs text-slate-500 ml-2">{m.server}</span>
                        <p className="text-xs text-slate-400 truncate">{m.content}</p>
                      </div>
                      <span className="text-xs text-slate-600" title={formatTitle(m.time)}>{formatClock(m.time) || m.time}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="glass rounded-xl p-4">
                <h3 className="font-semibold mb-4 flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" /> Quick Actions</h3>
                <div className="space-y-2">
                  {[
                    { label: "Refresh now", action: () => { setLoading(true); fetchData().finally(() => setLoading(false)); } },
                    { label: "Clear feed", action: clearFeed },
                    { label: "Clear violations", action: clearViolations },
                    { label: "Run troll sweep", action: () => runTrollSweep() },
                    { label: "Open server log", action: () => setActive("audit") },
                    { label: "Open troll list", action: () => setActive("trolls") },
                  ].map((a) => (
                    <button key={a.label} onClick={a.action} data-tip={a.label} className="w-full text-left px-3 py-2 rounded-lg bg-slate-800/40 hover:bg-slate-700/50 text-sm transition flex items-center justify-between group">
                      {a.label}
                      <ChevronRight className="w-3 h-3 text-slate-600 group-hover:text-slate-300" />
                    </button>
                  ))}
                </div>
                {loading && <div className="mt-4 flex justify-center"><RefreshCw className="w-5 h-5 animate-spin text-indigo-400" /></div>}
              </div>
            </div>

          </motion.div>
        )}

        {active === "migraine" && <MigraineScreen apiUrl={apiUrl} />}

        {active === "armcare" && <ArmCareScreen />}

        {active === "edwaits" && settings.edWaitsEnabled && (
          <div className="space-y-4">
            <EdWaits apiUrl={apiUrl} variant="page" />
          </div>
        )}

        {active === "livefeed" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <select value={selectedServer} onChange={(e) => { setSelectedServer(e.target.value); setSelectedChannel(""); }} className="px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500">
                <option value="">All servers</option>
                {servers.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
              <select value={selectedChannel} onChange={(e) => setSelectedChannel(e.target.value)} className="px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500" disabled={!selectedServer}>
                <option value="">All channels</option>
                {channels.map((c) => <option key={c.id} value={c.name}>#{c.name}</option>)}
              </select>
              <p className="text-sm text-slate-400 flex-1">{filteredMessages.length} messages</p>
              <button onClick={clearFeed} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm hover:bg-rose-500/20 transition"
            data-tip="Clear the message feed — hidden messages come back with Show hidden">
                <Trash2 className="w-3.5 h-3.5" /> Clear Feed
              </button>
            </div>
            <div className="space-y-2">
              <AnimatePresence>
                {filteredMessages.map((m) => (
                  <motion.div key={m.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, msg: m }); }} className="glass rounded-xl p-3 flex items-center gap-3 hover:bg-slate-800/30 transition cursor-context-menu">
                    <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-lg">{m.avatar}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{m.user}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">{m.server}</span>
                        <span className="text-xs text-slate-500">#{m.channel}</span>
                      </div>
                      <p className="text-sm text-slate-300 truncate">{m.content}</p>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <span className="text-xs text-slate-500">{fmtTime(m.time)}</span>
                      {m.flagged && <div className="text-xs text-rose-400 mt-1">flagged</div>}
                      <div className="flex gap-1 mt-1">
                        <button onClick={() => hideMessage(String(m.id))} className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 hover:bg-rose-500/20" title="Delete from feed" data-tip="Remove this message from the feed">🗑</button>
                        <button onClick={() => { setMoreOptionsMsg(m); setMoreOptionsAction("warn"); setMoreOptionsReason(""); }} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20" title="More options" data-tip="Warn, mute, kick or ban this person">⋯</button>
                        <button onClick={async () => { const who = m.user_id || m.user; if (!who) { notify("That message has no user id", "error"); return; } const reason = await Promise.resolve(window.prompt(`Warn ${m.user} — why?`, "Breach of server rules")); if (reason === null) return; if (!reason.trim()) { notify("A warning needs a reason — it goes in the record", "error"); return; } try { const res = await fetch(apiUrl + "/api/warn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_id: who, server: m.server_id || m.server, reason: reason.trim(), issued_by: "dashboard" }) }); const data = await res.json().catch(() => ({})); if (res.ok && !data.error) { notify(data.dm_delivered ? `Warning ${data.warning_number} recorded and DM'd to ${data.user}` : `Warning ${data.warning_number} recorded. ${data.detail || "The DM did not land."}`, data.dm_delivered ? "success" : "info"); } else { notify(data.error || `That did not work (${res.status})`, "error"); } } catch { notify("Connection failed — is the bot running?", "error"); } }} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 hover:bg-amber-500/20" data-tip="Warn this person now, in one press — the reason goes in the record">⚠</button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {filteredMessages.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No messages yet. New messages will appear here live.</p>
                </div>
              )}
            </div>
            {moreOptionsMsg && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setMoreOptionsMsg(null)}>
                <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-lg font-semibold mb-4">More Options — {moreOptionsMsg.user}</h3>
                  <p className="text-xs text-slate-400 mb-4">Server: {moreOptionsMsg.server} | Channel: #{moreOptionsMsg.channel}</p>
                  <p className="text-sm text-slate-300 mb-4 italic">"{moreOptionsMsg.content}"</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Action</label>
                      <select value={moreOptionsAction} onChange={(e) => setMoreOptionsAction(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500">
                        <option value="warn">Warn</option>
                        <option value="mute">Mute</option>
                        <option value="timeout">Timeout (10 min)</option>
                        <option value="kick">Kick</option>
                        <option value="ban">Ban</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Reason</label>
                      <textarea value={moreOptionsReason} onChange={(e) => setMoreOptionsReason(e.target.value)} placeholder="Reason..." rows={3} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 resize-none" />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setMoreOptionsMsg(null)} className="px-4 py-2 rounded-lg bg-slate-700/50 text-slate-300 text-sm hover:bg-slate-600/50 transition" data-tip="Cancel and close">Cancel</button>
                      <button onClick={async () => {
                        if (!moreOptionsReason) { notify("Enter a reason", "error"); return; }
                        try {
                          const warnOnly = moreOptionsAction === "warn";
                          const res = await fetch(apiUrl + (warnOnly ? "/api/warn" : "/api/moderation-action"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: moreOptionsAction, target_id: moreOptionsMsg.user_id || moreOptionsMsg.user, server: moreOptionsMsg.server_id || moreOptionsMsg.server, reason: moreOptionsReason, duration: 10, issued_by: "dashboard" }) });
                          const data = await res.json().catch(() => ({}));
                          if (res.ok && !data.error) {
                            // A warning is a record first: say what was saved, and whether
                            // the DM landed, rather than a flat "success".
                            if (warnOnly) {
                              const line = data.dm_delivered
                                ? `Warning ${data.warning_number} recorded and DM'd to ${data.user}`
                                : `Warning ${data.warning_number} recorded. ${data.detail || "The DM did not land."}`;
                              notify(line, data.dm_delivered ? "success" : "info");
                            } else {
                              notify(`${data.action} applied to ${data.user}`, "success");
                            }
                            setMoreOptionsMsg(null);
                          } else {
                            notify(data.error || `That did not work (${res.status})`, "error");
                          }
                        } catch (e) { notify("Connection failed — is the bot running?", "error"); }
                      }} className="px-4 py-2 rounded-lg bg-rose-500/20 text-rose-300 text-sm hover:bg-rose-500/30 transition" data-tip="Run this action">Execute</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {active === "relay" && (
          <RelayScreen apiUrl={apiUrl} servers={servers} selectedServer={selectedServer} notify={notify} />
        )}

        {active === "violations" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-3 mb-4">
              {["all", "pending", "resolved", "denied"].map((f) => {
                const n =
                  f === "all"
                    ? violations.length
                    : violations.filter((v) => v.status === f).length;
                return (
                  <button
                    key={f}
                    onClick={() => setViolationFilter(f)}
                    className={
                      "px-3 py-1.5 rounded-lg text-sm transition " +
                      (violationFilter === f
                        ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                        : "bg-slate-800/40 text-slate-400 hover:text-slate-200")
                    }
                  
            data-tip="Show only these violations">
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                    <span className="ml-1.5 text-xs opacity-60">{n}</span>
                  </button>
                );
              })}
              {hiddenViolationCount > 0 && (
                <button
                  onClick={showHiddenViolations}
                  className="px-3 py-1.5 rounded-lg text-sm bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition"
                  data-tip={`${hiddenViolationCount} violation(s) hidden by Clear — bring them back`}
                >
                  Show {hiddenViolationCount} hidden
                </button>
              )}
            </div>
            <div className="space-y-2">
              {[...filteredViolations]
                // Anything waiting on a decision comes first; a long history of
                // settled ones should not bury the two that need an answer.
                .sort((a, b) => {
                  const rank = (v: any) => (v.status === "pending" ? 0 : 1);
                  return rank(a) - rank(b) || String(b.time).localeCompare(String(a.time));
                })
                .map((v) => (
                <div key={v.id} className="glass rounded-xl p-4 flex items-center gap-4">
                  <div className={"w-2 h-10 rounded-full " + (v.severity === "critical" ? "bg-rose-500" : v.severity === "high" ? "bg-orange-500" : "bg-amber-500")} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">{v.user}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">{v.server}</span>
                      <span className={"text-xs px-1.5 py-0.5 rounded " + (v.severity === "critical" ? "bg-rose-500/20 text-rose-300" : v.severity === "high" ? "bg-orange-500/20 text-orange-300" : "bg-amber-500/20 text-amber-300")}>{v.severity}</span>
                    </div>
                    <p className="text-xs text-slate-400">{v.type} - words: {v.words.join(", ")} - {formatShort(v.time) || v.time}</p>
                    {v.full_message && <p className="text-xs text-slate-300 mt-1 italic">"{v.full_message}"</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setContextViolation(v); }} className="px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-300 text-xs hover:bg-slate-600/50 transition" data-tip="See the flagged message in context">View Context</button>
                    {v.status === "pending" && (
                      <>
                        <button onClick={() => handleContextAction("approve", v)} className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 text-xs hover:bg-emerald-500/20 transition" data-tip="Approve — action the member as suggested">Approve</button>
                        <button onClick={() => handleContextAction("deny", v)} className="px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 text-xs hover:bg-rose-500/20 transition" data-tip="Deny — leave the member alone">Deny</button>
                      </>
                    )}
                    {v.status !== "pending" && (
                      <>
                        <span
                          className={"text-xs px-2 py-1 rounded " + (v.status === "resolved" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")}
                          title={v.decided_at ? "Decided " + formatDateTime(v.decided_at) : undefined}
                        >
                          {v.status}
                        </span>
                        <button
                          onClick={() => handleContextAction("undo", v)}
                          className="px-2 py-1 rounded-lg bg-slate-700/50 text-slate-300 text-xs hover:bg-slate-600/50 transition"
                          title="Put this back to pending" data-tip="Put this back to pending"
                        >
                          Undo
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Every screen renders unconditionally; each block below checks `active`
            itself. The old whitelist here meant a new screen rendered blank
            until someone remembered to add it to the list. */}
        {(
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {active === "members" && (
              <MembersScreen
                apiUrl={apiUrl}
                onLookupViolations={(id) => {
                  setSearchQuery(id);
                  setActive("violations");
                }}
              />
            )}
            {active === "moderation" && (
              <ModerationScreen
                apiUrl={apiUrl}
                notify={notify}
                servers={servers}
                selectedServer={servers.find((x: any) => x.id === activeServer)?.name || ""}
              />
            )}
            {active === "music" && (
              <MusicScreen
                apiUrl={apiUrl}
                notify={notify}
                userId={userId}
                servers={servers}
                selectedServer={servers.find((x: any) => x.id === activeServer)?.name || ""}
              />
            )}
            {active === "trollwatch" && <TrollWatch apiUrl={apiUrl} notify={notify} />}
            {active === "config" && (
              <ConfigScreen
                apiUrl={apiUrl}
                servers={servers}
                server={servers.find((s: any) => s.id === activeServer)}
                notify={notify}
              />
            )}
            {active === "tickets" && (
              <TicketScreen
                apiUrl={apiUrl}
                servers={servers}
                selectedServer={servers.find((s: any) => s.id === activeServer)?.name || ""}
                userId={userId}
                notify={notify}
              />
            )}
            {active === "trolls" && <TrollsScreen apiUrl={apiUrl} notify={notify} />}
            {active === "audit" && (
              <AuditLog apiUrl={apiUrl} notify={notify} serverId={activeServer} />
            )}
            {active === "database" && <DatabaseScreen apiUrl={apiUrl} notify={notify} />}
            {active === "spotify" && <SpotifyScreen settings={settings} notify={notify} />}
            {active === "activities" && <ActivitiesScreen apiUrl={apiUrl} notify={notify} />}
            {active === "reactionroles" && (
              <ReactionRoles
                apiUrl={apiUrl}
                server={servers.find((s: any) => s.id === activeServer)}
                servers={servers}
                notify={notify}
              />
            )}
            {active === "settings" && (
              <SettingsScreen
                settings={settings}
                onSaveSettings={(next) => {
                  saveSettings(next);
                  setSettings(next);
                }}
                apiUrl={apiUrl}
                onSaveApiUrl={(url) => {
                  setApiUrl(url);
                  localStorage.setItem("sahara_api_url", url);
                  notify("API address saved", "success");
                }}
                theme={theme}
                onSaveTheme={setTheme}
                soundEnabled={soundEnabled}
                onToggleSound={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  localStorage.setItem("sahara_sound", next ? "on" : "off");
                }}
                ttsEnabled={ttsEnabled}
                onToggleTts={() => {
                  const next = !ttsEnabled;
                  setTtsEnabled(next);
                  localStorage.setItem("sahara_tts", next ? "on" : "off");
                }}
                onOpenSetup={() => setShowSetup(true)}
              />
            )}
          </motion.div>
        )}
        </div>
      </main>

      {trollSweepActive && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="w-full max-w-2xl p-8">
            <h2 className="text-3xl font-bold text-center mb-2">🔍 Troll Sweep</h2>
            <p className="text-sm text-slate-400 text-center mb-8">Scanning all servers for suspicious activity</p>
            <div className="mb-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-300">{trollSweepServer || "Starting..."}</span>
                <span className="text-indigo-400">{trollSweepProgress}%</span>
              </div>
              <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500" style={{ width: trollSweepProgress + "%" }} />
              </div>
            </div>
            <div className="flex justify-between text-sm text-slate-400 mb-6">
              <span>Members scanned: {trollSweepMembers}</span>
              <span>Servers: {servers.length}</span>
            </div>
            {trollSweepDone && (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-emerald-400">✅ Sweep Complete</h3>
                {trollSweepResults.length === 0 ? (
                  <p className="text-sm text-slate-400">No suspicious activity detected.</p>
                ) : (
                  trollSweepResults.map((r, i) => (
                    <div key={i} className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30">
                      <p className="text-sm font-medium text-rose-300">{r.server}: {r.count} suspicious</p>
                      <p className="text-xs text-slate-400">{r.users.join(", ")}</p>
                    </div>
                  ))
                )}
                <button onClick={() => { setTrollSweepActive(false); setTrollSweepMembers(0); }} className="w-full mt-4 px-4 py-2 rounded-lg bg-indigo-500/20 text-indigo-300 text-sm hover:bg-indigo-500/30 transition" data-tip="Close the sweep summary">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
      <SleepMode
        open={showSleep}
        onClose={() => setShowSleep(false)}
        onSleep={() => {
          setSleepMode(true);
          notify("Sleep mode on, goodnight 🌙", "success");
          if (soundEnabled) playSound("sleep");
          fetch(apiUrl.replace(/\/$/, "") + "/api/sleep", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sleeping: true }),
          }).catch(() => {});
        }}
      />
    </div>
  );
}
