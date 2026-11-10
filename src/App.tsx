import React, { useState, useEffect, useRef, useCallback } from "react";
import { LayoutDashboard, Activity, Users, Shield, Music, Settings, Sparkles, Bell, Search, ChevronRight, Zap, MessageSquare, AlertTriangle, Lock, LogIn, X, Trash2, Eye, VolumeX, Ban, CheckCircle, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [pinSet, setPinSet] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [locked, setLocked] = useState(false);
  const [active, setActive] = useState("dashboard");
  const [messages, setMessages] = useState([
    { id: 1, user: "smg4_2010", avatar: "🎮", server: "Babble Playpen", channel: "general", content: "hey everyone!", time: "just now", flagged: false },
    { id: 2, user: "wolfman_4328", avatar: "🐺", server: "Bear Café", channel: "general", content: "Fuck this", time: "2m ago", flagged: true },
    { id: 3, user: "glacy6832", avatar: "🌴", server: "Glacy's Tropical", channel: "chat", content: "welcome back!", time: "3m ago", flagged: false },
    { id: 4, user: "stitchy_gw", avatar: "🧵", server: "SocialLink.io Staff", channel: "main-chat", content: "bb!status", time: "5m ago", flagged: false },
  ]);
  const [messagesToday, setMessagesToday] = useState(0);
  const [selectedServer, setSelectedServer] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("");
  const [servers, setServers] = useState<any[]>([]);
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
  const [modTarget, setModTarget] = useState("");
  const [modServer, setModServer] = useState("");
  const [modAction, setModAction] = useState("warn");
  const [modReason, setModReason] = useState("");
  const [apiUrl, setApiUrl] = useState(localStorage.getItem("sahara_api_url") || "http://localhost:8080");
  const [modDuration, setModDuration] = useState(10);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [dmTarget, setDmTarget] = useState("");
  const [dmMessage, setDmMessage] = useState("");
  const [channelTarget, setChannelTarget] = useState("");
  const [channelMessage, setChannelMessage] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [contextViolation, setContextViolation] = useState<any>(null);
  const [theme, setTheme] = useState(localStorage.getItem("sahara_theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("sahara_theme", theme);
  }, [theme]);

  useEffect(() => {
    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const { relaunch } = await import("@tauri-apps/plugin-process");
        const update = await check();
        if (update?.available) {
          const ok = window.confirm(`Update ${update.version} available. Install now?`);
          if (ok) {
            await update.downloadAndInstall();
            await relaunch();
          }
        }
      } catch (e) {
        // Not running in Tauri or no update endpoint configured — ignore
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

  const fetchData = async () => {
    try {
      const healthRes = await fetch(apiUrl + "/api/health");
      if (!healthRes.ok) throw new Error("not ok");
      setConnected(true);
      setConnectionError("");
      const [msgRes, violRes, srvRes, statsRes] = await Promise.all([
        fetch(apiUrl + "/api/messages?limit=50"),
        fetch(apiUrl + "/api/violations?limit=50"),
        fetch(apiUrl + "/api/servers"),
        fetch(apiUrl + "/api/stats"),
      ]);
      if (msgRes.ok) setMessages(await msgRes.json());
      if (violRes.ok) {
        const newViols = await violRes.json();
        const newIds = new Set(newViols.map((v: any) => v.id));
        const added = newViols.filter((v: any) => !prevViolationIds.has(v.id) && prevViolationIds.size > 0);
        if (added.length > 0) {
          if (soundEnabled) playSound("violation");
          if (ttsEnabled) {
            const v = added[0];
            speak(`New violation: ${v.user}. ${v.full_message || v.message || v.type}`);
          }
          notify(`New violation: ${added[0].user}`, "error");
        }
        setPrevViolationIds(newIds);
        setViolations(newViols);
      }
      if (srvRes.ok) setServers(await srvRes.json());
      if (statsRes.ok) { const d = await statsRes.json(); setMessagesToday(d.messages_today ?? 0); }
    } catch (e) {
      setConnected(false);
      setConnectionError("Cannot reach bot API at " + apiUrl);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  const playSound = (type: string) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (type === "success") { osc.frequency.value = 880; gain.gain.value = 0.1; }
      else if (type === "error") { osc.frequency.value = 220; gain.gain.value = 0.15; }
      else if (type === "violation") { osc.frequency.value = 660; gain.gain.value = 0.12; }
      else if (type === "join") { osc.frequency.value = 523; gain.gain.value = 0.1; }
      else { osc.frequency.value = 440; gain.gain.value = 0.08; }
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.stop(ctx.currentTime + 0.2);
    } catch {}
  };

  const speak = (text: string) => {
    try {
      if (!("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 1.0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {}
  };

  const [prevViolationIds, setPrevViolationIds] = useState<Set<any>>(new Set());
  const [prevMemberIds, setPrevMemberIds] = useState<Set<any>>(new Set());
  const [ttsEnabled, setTtsEnabled] = useState(localStorage.getItem("sahara_tts") !== "off");
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem("sahara_sound") !== "off");

  const isAndre = userId === "264680643013771265";
  const [armReminder, setArmReminder] = useState(false);
  const [slingOn, setSlingOn] = useState(() => localStorage.getItem("sahara_sling") !== "off");
  const [slingStatusAsked, setSlingStatusAsked] = useState(() => localStorage.getItem("sahara_sling_asked") === "1");
  const [sleepMode, setSleepMode] = useState(false);
  useEffect(() => {
    if (!isAndre || !loggedIn || !slingOn || sleepMode) return;
    const show = () => { setArmReminder(true); try { const a=new Audio('/sounds/alarm_beep.wav'); a.play().catch(()=>{}); setTimeout(()=>{ const b=new Audio('/sounds/arm_reminder.ogg'); b.play().catch(()=>{}); }, 700); setTimeout(()=>{ const c=new Audio('/sounds/sling_back_on.ogg'); c.play().catch(()=>{}); }, 8*60*1000); } catch {} };
    const t = setTimeout(show, 90 * 60 * 1000);
    return () => clearTimeout(t);
  }, [isAndre, loggedIn, slingOn, sleepMode, armReminder]);
  const [edWaits, setEdWaits] = useState<{ Mater?: number; "Royal Victoria"?: number; miu?: string }>({});
  const prevWaitsRef = useRef<{ Mater?: number; "Royal Victoria"?: number }>({});
  const [edLastUpdate, setEdLastUpdate] = useState("");
  const [edStale, setEdStale] = useState(false);
  const [edLastFetch, setEdLastFetch] = useState<number>(0);
  const [edNow, setEdNow] = useState<number>(Date.now());

  // Arm care reminder (only for Andre's profile)
  useEffect(() => {
    if (!isAndre || !loggedIn) return;
    const interval = setInterval(() => {
      setArmReminder(true);
      if (soundEnabled) playSound("join");
      speak("Time to take your arm out of the sling and do gentle wrist movements.");
    }, 2 * 60 * 60 * 1000); // every 2 hours, gentle
    return () => clearInterval(interval);
  }, [isAndre, loggedIn, soundEnabled]);

  // Live ED waiting times
  const fetchEd = useCallback(async () => {
    if (!isAndre || !loggedIn) return;
    try {
      const res = await fetch(apiUrl + "/api/ed-waits");
      if (!res.ok) throw new Error("not ok");
      const data = await res.json();
      if (data.waits && Object.keys(data.waits).length) {
        // Check if waits dropped
        try {
          const prev = prevWaitsRef.current;
          if (prev && ((data.waits.Mater != null && prev.Mater != null && data.waits.Mater < prev.Mater) ||
                      (data.waits["Royal Victoria"] != null && prev["Royal Victoria"] != null && data.waits["Royal Victoria"] < prev["Royal Victoria"]))) {
            const a = new Audio('/sounds/alarm_beep.wav'); a.play().catch(()=>{});
            setTimeout(() => { const b = new Audio('/sounds/ed_wait_drop.ogg'); b.play().catch(()=>{}); }, 700);
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
  }, [isAndre, loggedIn, apiUrl]);

  useEffect(() => {
    if (!isAndre || !loggedIn) return;
    fetchEd();
    const interval = setInterval(fetchEd, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAndre, loggedIn, fetchEd]);

  useEffect(() => {
    const t = setInterval(() => setEdNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
    const notify = (msg: any, type = "info") => {
    playSound(type);
    const id = Date.now();
    setNotifications((n) => [...n, { id, msg, type }]);
    setTimeout(() => setNotifications((n) => n.filter((x) => x.id !== id)), 3000);
  };

  useEffect(() => {
    if (!selectedServer || !connected) return;
    fetch(apiUrl + "/api/channels?server=" + encodeURIComponent(selectedServer)).then(r => r.json()).then(setChannels).catch(() => {});
    fetch(apiUrl + "/api/members?server=" + encodeURIComponent(selectedServer) + "&staff_only=" + staffOnly).then(r => r.json()).then((m) => {
      const newIds = new Set((m || []).map((x: any) => x.id));
      const added = (m || []).filter((x: any) => !prevMemberIds.has(x.id) && prevMemberIds.size > 0);
      if (added.length > 0) {
        if (soundEnabled) playSound("join");
        if (ttsEnabled) speak(`New member joined: ${added[0].display_name || added[0].name}`);
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
      const data = await res.json();
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
    const srvs = servers.length ? servers : await (await fetch(apiUrl + "/api/servers")).json();
    const total = srvs.length;
    for (let i = 0; i < srvs.length; i++) {
      const s = srvs[i];
      setTrollSweepServer(s.name);
      setTrollSweepProgress(Math.round(((i) / total) * 100));
      try {
        const members = await (await fetch(apiUrl + "/api/members?server=" + encodeURIComponent(s.name))).json();
        setTrollSweepMembers((prev) => prev + (members?.length || 0));
        // Check for suspicious patterns (new accounts, no avatar, etc.)
        const suspicious = (members || []).filter((m: any) => !m.avatar || m.name.includes("http") || m.name.length < 3);
        if (suspicious.length > 0) {
          setTrollSweepResults((prev) => [...prev, { server: s.name, count: suspicious.length, users: suspicious.map((u: any) => u.name) }]);
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 800));
    }
    setTrollSweepProgress(100);
    setTrollSweepDone(true);
  };

  const clearFeed = () => { setMessages([]); notify("Feed cleared", "info"); };

  const fmtTime = (ts: string) => {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return ts; }
  };

  const handleContextAction = async (action: any, msg: any) => {
    setContextMenu(null);
    if (action === "approve" || action === "deny") {
      try {
        await fetch(apiUrl + "/api/violation/" + encodeURIComponent(msg.id) + "/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, user: msg.user, server: msg.server, channel: msg.channel || "", type: msg.type, words: msg.words || [], message: msg.full_message || msg.message || "" }),
        });
        setViolations((v) => v.map((x) => x.id === msg.id ? { ...x, status: action === "approve" ? "resolved" : "denied" } : x));
        notify(action === "approve" ? "Approved" : "Denied", action === "approve" ? "success" : "error");
      } catch (e) { notify("Failed", "error"); }
    } else if (action === "delete") {
      setMessages((m) => m.filter((x) => x.id !== msg.id));
      notify("Deleted", "info");
    } else {
      notify(action + " " + msg.user, "info");
    }
  };

  const filteredMessages = messages.filter((m) =>
    (!selectedServer || m.server === selectedServer) &&
    (!selectedChannel || m.channel === selectedChannel) &&
    (m.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
     m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
     m.server.toLowerCase().includes(searchQuery.toLowerCase()))
  );
  const filteredViolations = violations.filter((v) => violationFilter === "all" || v.status === violationFilter);

  if (locked) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950">
        <div className="glass rounded-2xl p-8 w-80 text-center">
          <Lock className="w-12 h-12 mx-auto mb-4 text-indigo-400" />
          <h2 className="text-xl font-bold mb-2">Locked</h2>
          <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleUnlock()} placeholder="PIN" className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-700 text-center text-2xl tracking-widest focus:outline-none focus:border-indigo-500 mb-4" />
          <button onClick={handleUnlock} className="w-full py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 font-semibold hover:opacity-90 transition">Unlock</button>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">
        <div className="w-full max-w-md p-8 rounded-2xl bg-slate-900/50 border border-slate-800">
          <h1 className="text-2xl font-bold mb-2 text-center">🐦 Sahara Dashboard</h1>
          <p className="text-sm text-slate-400 text-center mb-6">Connect to your Discord bot to continue</p>
          <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="http://192.168.1.131:8080" className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm mb-3 focus:outline-none focus:border-indigo-500" />
          {connectionError && <p className="text-xs text-rose-400 mb-3">{connectionError}</p>}
          <button onClick={() => { localStorage.setItem("sahara_api_url", apiUrl); fetchData(); }} className="w-full px-4 py-2 rounded-lg bg-indigo-500/20 text-indigo-300 text-sm hover:bg-indigo-500/30 transition">Connect</button>
        </div>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950">
        <div className="glass rounded-2xl p-8 w-96">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center"><Sparkles className="w-6 h-6" /></div>
            <div><h1 className="text-2xl font-bold">Sahara</h1><p className="text-sm text-slate-400">Control Center</p></div>
          </div>
          <label className="text-xs text-slate-400 mb-1 block">Discord User ID</label>
          <input value={userId} onChange={(e) => setUserId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} placeholder="Your Discord User ID" className="w-full px-4 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 mb-4" />
          <button onClick={handleLogin} className="w-full py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 font-semibold hover:opacity-90 transition flex items-center justify-center gap-2"><LogIn className="w-4 h-4" /> Sign In</button>
        </div>
      </div>
    );
  }

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "livefeed", label: "Live Messages", icon: MessageSquare },
    { id: "violations", label: "Violations", icon: AlertTriangle },
    { id: "members", label: "Members", icon: Users },
    { id: "moderation", label: "Moderation", icon: Shield },
    { id: "music", label: "Music", icon: Music },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      {contextViolation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setContextViolation(null)}>
          <div className="glass rounded-2xl p-6 w-[500px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Violation Context</h3>
              <button onClick={() => setContextViolation(null)} className="text-slate-400 hover:text-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-slate-800/30">
                <p className="text-xs text-slate-500 mb-1">Flagged message by {contextViolation.user} in {contextViolation.server}</p>
                <p className="text-sm font-medium mb-2">"{contextViolation.full_message || contextViolation.message}"</p>
                <p className="text-xs text-slate-400">Flagged words: {contextViolation.words?.join(", ")}</p>
              </div>
              <div className="text-xs text-slate-500">
                <p className="mb-1">Before:</p>
                <div className="p-2 rounded bg-slate-800/20 text-slate-400">... previous messages in channel ...</div>
              </div>
              <div className="text-xs text-slate-500">
                <p className="mb-1">After:</p>
                <div className="p-2 rounded bg-slate-800/20 text-slate-400">... following messages in channel ...</div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => { handleContextAction("approve", contextViolation); setContextViolation(null); }} className="flex-1 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 text-sm hover:bg-emerald-500/30">Approve</button>
                <button onClick={() => { handleContextAction("deny", contextViolation); setContextViolation(null); }} className="flex-1 py-2 rounded-lg bg-rose-500/20 text-rose-300 text-sm hover:bg-rose-500/30">Deny</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        <AnimatePresence>
          {notifications.map((n) => (
            <motion.div key={n.id} initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 100, opacity: 0 }} className={"px-4 py-2.5 rounded-lg text-sm shadow-lg " + (n.type === "success" ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300" : n.type === "error" ? "bg-rose-500/20 border border-rose-500/30 text-rose-300" : "bg-indigo-500/20 border border-indigo-500/30 text-indigo-300")}>
              {n.msg}
            </motion.div>
          ))}
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
            return <button key={a.action} onClick={() => handleContextAction(a.action, contextMenu.msg)} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-700/50 transition text-left"><Icon className="w-3.5 h-3.5" /> {a.label}</button>;
          })}
        </div>
      )}

      <aside className="w-60 glass flex flex-col p-4">
        <div className="flex items-center gap-3 px-2 py-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center"><Sparkles className="w-5 h-5" /></div>
          <div><h1 className="font-bold text-lg">Sahara</h1><p className="text-xs text-slate-400">Control Center</p></div>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map((n) => {
            const Icon = n.icon;
            const isActive = active === n.id;
            return <button key={n.id} onClick={() => setActive(n.id)} className={"w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all " + (isActive ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200")}>
              <Icon className="w-4 h-4" /> {n.label}
              {isActive && <ChevronRight className="w-3 h-3 ml-auto" />}
            </button>;
          })}
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
          <button onClick={() => { setLocked(true); notify("Locked", "info"); }} className="flex-1 text-xs py-1 rounded bg-slate-700/50 hover:bg-slate-600/50 transition">Lock</button>
          <button onClick={() => { localStorage.removeItem("sahara_user"); setLoggedIn(false); }} className="flex-1 text-xs py-1 rounded bg-slate-700/50 hover:bg-slate-600/50 transition">Sign Out</button>
          </div>
          {isAndre && (
          <button onClick={() => { if (!sleepMode) { setSleepMode(true); setArmReminder(false); notify("Sleep mode: remove sling before bed! ⚠️", "error"); try { const a=new Audio('/sounds/alarm_beep.wav'); a.play().catch(()=>{}); setTimeout(()=>{ const b=new Audio('/sounds/sleep_warning.ogg'); b.play().catch(()=>{}); }, 700); } catch {} } else { setSleepMode(false); setSlingOn(true); localStorage.setItem("sahara_sling","on"); notify("Sling mode re-enabled", "success"); } }} className={"mt-2 w-full text-xs py-1 rounded transition " + (sleepMode ? "bg-amber-500/20 text-amber-300" : "bg-slate-700/50 text-slate-300 hover:bg-slate-600/50")}>{sleepMode ? "☀️ Wake up (sling on)" : "🌙 Going to sleep"}</button>
          )}
        </div>
        {!pinSet && (
          <div className="mt-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-xs text-amber-300 mb-2">Set a PIN to lock the app</p>
            <div className="flex gap-2">
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" className="flex-1 px-2 py-1 rounded bg-slate-800/50 border border-slate-700 text-xs focus:outline-none" />
              <button onClick={handleSetPin} className="px-2 py-1 rounded bg-amber-500/20 text-amber-300 text-xs hover:bg-amber-500/30">Set</button>
            </div>
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold capitalize">{active.replace("livefeed", "Live Messages")}</h2>
            <p className="text-sm text-slate-400">Real-time Discord bot control</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search..." className="pl-9 pr-4 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 w-64" />
            </div>
            <button onClick={() => notify("No new notifications", "info")} className="p-2 rounded-lg bg-slate-800/50 border border-slate-700 hover:bg-slate-700/50 relative">
              <Bell className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-xs text-emerald-300">Bot Online</span>
            </div>
          </div>
        </div>

        {active === "dashboard" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="grid grid-cols-4 gap-4 mb-6">
              {[
                { label: "Servers", value: "6", color: "from-indigo-500 to-purple-500" },
                { label: "Members", value: "1,247", color: "from-cyan-500 to-blue-500" },
                { label: "Messages Today", value: messagesToday.toLocaleString(), color: "from-emerald-500 to-teal-500" },
                { label: "Violations", value: violations.filter(v => v.status === "pending").length, color: "from-rose-500 to-orange-500" },
              ].map((s) => (
                <div key={s.label} className="glass rounded-xl p-4">
                  <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                  <span className="text-2xl font-bold">{s.value}</span>
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
                      <span className="text-xs text-slate-600">{m.time}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="glass rounded-xl p-4">
                <h3 className="font-semibold mb-4 flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" /> Quick Actions</h3>
                <div className="space-y-2">
                  {[
                    { label: "Restart Bot", action: () => notify("Bot restart requested", "info") },
                    { label: "Clear Feed", action: clearFeed },
                    { label: "Run Troll Sweep", action: () => runTrollSweep() },
                    { label: "Export Logs", action: () => notify("Logs exported", "success") },
                    { label: "Refresh Data", action: () => { setLoading(true); setTimeout(() => { setLoading(false); notify("Data refreshed", "success"); }, 800); } },
                  ].map((a) => (
                    <button key={a.label} onClick={a.action} className="w-full text-left px-3 py-2 rounded-lg bg-slate-800/40 hover:bg-slate-700/50 text-sm transition flex items-center justify-between group">
                      {a.label}
                      <ChevronRight className="w-3 h-3 text-slate-600 group-hover:text-slate-300" />
                    </button>
                  ))}
                </div>
                {loading && <div className="mt-4 flex justify-center"><RefreshCw className="w-5 h-5 animate-spin text-indigo-400" /></div>}
              </div>
            </div>
            {isAndre && (
              <div className="glass rounded-xl p-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold flex items-center gap-2">🏥 ED Waiting Times (Belfast)</h3>
                  <button onClick={fetchEd} className="text-xs px-2 py-1 rounded bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 transition">↻ Refresh</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className={"p-4 rounded-xl " + (edStale ? "bg-slate-800/60" : "bg-gradient-to-br from-slate-800/60 to-slate-900/40")}>
                    <p className="text-xs text-slate-300 mb-1">Mater — typical (median) wait</p>
                    <p className={"text-4xl font-bold " + (edWaits.Mater == null ? "text-slate-500" : edWaits.Mater < 90 ? "text-emerald-400" : edWaits.Mater < 180 ? "text-amber-400" : "text-rose-400")}>{edWaits.Mater ?? "—"}<span className="text-base text-slate-500 ml-1">min</span></p>
                  </div>
                  <div className={"p-4 rounded-xl " + (edStale ? "bg-slate-800/60" : "bg-slate-800/40")}>
                    <p className="text-xs text-slate-300 mb-1">Royal Victoria — typical (median) wait</p>
                    <p className={"text-3xl font-bold " + (edWaits["Royal Victoria"] == null ? "text-slate-500" : edWaits["Royal Victoria"] < 90 ? "text-emerald-400" : edWaits["Royal Victoria"] < 180 ? "text-amber-400" : "text-rose-400")}>{edWaits["Royal Victoria"] ?? "—"}<span className="text-base text-slate-500 ml-1">min</span></p>
                  </div>
                </div>
                {edLastUpdate || edStale ? <p className="text-xs text-slate-400 mt-2" title={edLastUpdate || ""}>{edStale ? "⚠️ API offline — last known " + (edWaits.Mater ?? "—") + " min (Mater), " + (edWaits["Royal Victoria"] ?? "—") + " min (RVH)" : "Updated " + (edLastFetch ? Math.max(0, Math.round((edNow - edLastFetch) / 60000)) + " min ago" : edLastUpdate)}</p> : <p className="text-xs text-slate-400 mt-2">⚠️ API offline — no cached data yet</p>}
                <p className="text-xs text-slate-400 mt-2"><a href="https://www.nidirect.gov.uk/articles/minor-injuries-units" target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">MIUs &amp; Urgent Care Centres</a> are often quieter for non-emergency issues.</p>
                <details className="mt-3">
                  <summary className="text-xs text-rose-300/90 cursor-pointer hover:text-rose-200">⚠️ Not medical advice — when to go in person</summary>
                  <p className="text-xs text-rose-300/80 mt-2">New numbness/tingling in fingers, can't lift the arm, pain getting sharper instead of settling, or visible swelling/deformity → go in person, don't check the app.</p>
                </details>
              </div>
            )}
          </motion.div>
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
              <button onClick={clearFeed} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm hover:bg-rose-500/20 transition">
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
                        <button onClick={() => setMessages((msgs) => msgs.filter((x) => x.id !== m.id))} className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 hover:bg-rose-500/20" title="Delete from feed">🗑</button>
                        <button onClick={() => { setMoreOptionsMsg(m); setMoreOptionsAction("warn"); setMoreOptionsReason(""); }} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20" title="More options">⋯</button>
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
                      <button onClick={() => setMoreOptionsMsg(null)} className="px-4 py-2 rounded-lg bg-slate-700/50 text-slate-300 text-sm hover:bg-slate-600/50 transition">Cancel</button>
                      <button onClick={async () => {
                        if (!moreOptionsReason) { notify("Enter a reason", "error"); return; }
                        try {
                          const res = await fetch(apiUrl + "/api/moderation-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: moreOptionsAction, target_id: moreOptionsMsg.user_id || moreOptionsMsg.user, server: moreOptionsMsg.server, reason: moreOptionsReason, duration: 10 }) });
                          const data = await res.json();
                          if (data.success) { notify(data.action + " applied to " + data.user, "success"); setMoreOptionsMsg(null); }
                          else { notify(data.error || "Failed", "error"); }
                        } catch (e) { notify("Connection failed", "error"); }
                      }} className="px-4 py-2 rounded-lg bg-rose-500/20 text-rose-300 text-sm hover:bg-rose-500/30 transition">Execute</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {active === "violations" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-3 mb-4">
              {["all", "pending", "resolved", "denied"].map((f) => (
                <button key={f} onClick={() => setViolationFilter(f)} className={"px-3 py-1.5 rounded-lg text-sm transition " + (violationFilter === f ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30" : "bg-slate-800/40 text-slate-400 hover:text-slate-200")}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {filteredViolations.map((v) => (
                <div key={v.id} className="glass rounded-xl p-4 flex items-center gap-4">
                  <div className={"w-2 h-10 rounded-full " + (v.severity === "critical" ? "bg-rose-500" : v.severity === "high" ? "bg-orange-500" : "bg-amber-500")} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">{v.user}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">{v.server}</span>
                      <span className={"text-xs px-1.5 py-0.5 rounded " + (v.severity === "critical" ? "bg-rose-500/20 text-rose-300" : v.severity === "high" ? "bg-orange-500/20 text-orange-300" : "bg-amber-500/20 text-amber-300")}>{v.severity}</span>
                    </div>
                    <p className="text-xs text-slate-400">{v.type} - words: {v.words.join(", ")} - {v.time}</p>
                    {v.full_message && <p className="text-xs text-slate-300 mt-1 italic">"{v.full_message}"</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setContextViolation(v); }} className="px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-300 text-xs hover:bg-slate-600/50 transition">View Context</button>
                    {v.status === "pending" && (
                      <>
                        <button onClick={() => handleContextAction("approve", v)} className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 text-xs hover:bg-emerald-500/20 transition">Approve</button>
                        <button onClick={() => handleContextAction("deny", v)} className="px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 text-xs hover:bg-rose-500/20 transition">Deny</button>
                      </>
                    )}
                    {v.status !== "pending" && (
                      <span className={"text-xs px-2 py-1 rounded " + (v.status === "resolved" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")}>{v.status}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {["members", "moderation", "music", "settings"].includes(active) && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {active === "members" && (
              <>
                <div className="glass rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-4 flex-wrap">
                    <select value={selectedServer} onChange={(e) => setSelectedServer(e.target.value)} className="px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500">
                      <option value="">Select server...</option>
                      {servers.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                    <label className="flex items-center gap-2 text-sm text-slate-400">
                      <input type="checkbox" checked={staffOnly} onChange={(e) => setStaffOnly(e.target.checked)} className="rounded" />
                      Staff only
                    </label>
                    <span className="text-sm text-slate-400">{members.length} members</span>
                  </div>
                  <div className="space-y-2">
                    {members.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/30">
                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center overflow-hidden">
                          {m.avatar ? <img src={m.avatar} alt="" className="w-full h-full object-cover" /> : "👤"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium">{m.display_name || m.name}</span>
                          <span className="text-xs text-slate-500 ml-2">{m.id}</span>
                          {m.joined_at && <span className="text-xs text-slate-600 ml-2">joined {fmtTime(m.joined_at)}</span>}
                        </div>
                        <div className="flex gap-1 flex-wrap">
                          {m.roles?.slice(0, 2).map((r: string) => <span key={r} className="text-xs px-2 py-0.5 rounded bg-slate-700/50">{r}</span>)}
                        </div>
                        <span className={"w-2 h-2 rounded-full " + (m.status === "online" ? "bg-emerald-400" : m.status === "idle" ? "bg-amber-400" : "bg-slate-600")} />
                      </div>
                    ))}
                    {members.length === 0 && <p className="text-sm text-slate-500 text-center py-4">Select a server to view members</p>}
                  </div>
                </div>
              </>
            )}
            {active === "moderation" && (
              <div className="glass rounded-xl p-4 space-y-4">
                <h3 className="font-semibold mb-3">Moderation Controls</h3>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">User ID</label>
                    <input value={modTarget} onChange={(e) => setModTarget(e.target.value)} placeholder="Discord User ID" className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Server</label>
                    <select value={modServer} onChange={(e) => setModServer(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500">
                      <option value="">Select server...</option>
                      {["Babble Playpen", "Bear Café", "Glacy's Tropical", "SocialLink.io Staff"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Action</label>
                    <select value={modAction} onChange={(e) => setModAction(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500">
                      <option value="warn">Warn</option>
                      <option value="mute">Mute</option>
                      <option value="timeout">Timeout (10 min)</option>
                      <option value="kick">Kick</option>
                      <option value="ban">Ban</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Reason</label>
                    <textarea value={modReason} onChange={(e) => setModReason(e.target.value)} placeholder="Reason for action..." rows={3} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 resize-none" />
                  </div>
                  <button onClick={async () => {
                    if (!modTarget || !modServer || !modReason) { notify("Fill in user ID, server, and reason", "error"); return; }
                    try {
                      const res = await fetch(apiUrl + "/api/moderation-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: modAction, target_id: modTarget, server: modServer, reason: modReason, duration: modDuration }) });
                      const data = await res.json();
                      if (data.success) { notify(data.action + " applied to " + data.user, "success"); setModTarget(""); setModReason(""); }
                      else { notify(data.error || "Failed", "error"); }
                    } catch (e) { notify("Connection failed", "error"); }
                  }} className="px-4 py-2 rounded-lg bg-rose-500/20 text-rose-300 text-sm hover:bg-rose-500/30 transition">Execute Action</button>
                </div>
                <div className="border-t border-slate-700/50 pt-4">
                  <h4 className="font-semibold mb-2 text-sm">Send DM to User</h4>
                  <input value={dmTarget} onChange={(e) => setDmTarget(e.target.value)} placeholder="User ID" className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm mb-2 focus:outline-none focus:border-indigo-500" />
                  <textarea value={dmMessage} onChange={(e) => setDmMessage(e.target.value)} placeholder="Message (sent as SocialLink.io Staff)" rows={3} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm mb-2 focus:outline-none focus:border-indigo-500 resize-none" />
                  <button onClick={async () => { if (!dmTarget || !dmMessage) { notify("Fill in user ID and message", "error"); return; } try { const res = await fetch(apiUrl + "/api/dm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_id: dmTarget, message: dmMessage }) }); const data = await res.json(); if (data.success) { notify("DM sent to " + data.sent_to, "success"); setDmTarget(""); setDmMessage(""); } else { notify(data.error || "Failed", "error"); } } catch (e) { notify("Connection failed", "error"); } }} className="px-4 py-2 rounded-lg bg-indigo-500/20 text-indigo-300 text-sm hover:bg-indigo-500/30 transition">Send DM</button>
                </div>
                <div className="border-t border-slate-700/50 pt-4">
                  <h4 className="font-semibold mb-2 text-sm">Send Message to Channel</h4>
                  <input value={channelTarget} onChange={(e) => setChannelTarget(e.target.value)} placeholder="Server/Channel (e.g. Babble Playpen / general)" className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm mb-2 focus:outline-none focus:border-indigo-500" />
                  <textarea value={channelMessage} onChange={(e) => setChannelMessage(e.target.value)} placeholder="Message to send to channel" rows={3} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm mb-2 focus:outline-none focus:border-indigo-500 resize-none" />
                  <button onClick={async () => { if (!channelTarget || !channelMessage) { notify("Fill in channel and message", "error"); return; } const parts = channelTarget.split("/"); try { const res = await fetch(apiUrl + "/api/channel-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ server: parts[0]?.trim(), channel: parts[1]?.trim(), message: channelMessage }) }); const data = await res.json(); if (data.success) { notify("Message sent to " + data.channel, "success"); setChannelTarget(""); setChannelMessage(""); } else { notify(data.error || "Failed", "error"); } } catch (e) { notify("Connection failed", "error"); } }} className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-300 text-sm hover:bg-purple-500/30 transition">Send to Channel</button>
                </div>
              </div>
            )}
            {active === "music" && (
              <div className="glass rounded-xl p-4">
                <h3 className="font-semibold mb-3">Music Player</h3>
                <div className="flex items-center gap-4 mb-4">
                  <button onClick={() => notify("Playing", "success")} className="px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 text-sm hover:bg-emerald-500/30">Play</button>
                  <button onClick={() => notify("Paused", "info")} className="px-4 py-2 rounded-lg bg-slate-700/50 text-slate-300 text-sm hover:bg-slate-600/50">Pause</button>
                  <button onClick={() => notify("Skipped", "info")} className="px-4 py-2 rounded-lg bg-slate-700/50 text-slate-300 text-sm hover:bg-slate-600/50">Skip</button>
                  <button onClick={() => notify("Stopped", "error")} className="px-4 py-2 rounded-lg bg-rose-500/20 text-rose-300 text-sm hover:bg-rose-500/30">Stop</button>
                </div>
                <p className="text-xs text-slate-500">Now playing: Nothing (queue empty)</p>
              </div>
            )}
            {active === "settings" && (
              <div className="glass rounded-xl p-4 space-y-4">
                <h3 className="font-semibold mb-3">Settings</h3>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Bot API URL</label>
                  <input value={apiUrl} onChange={(e) => { setApiUrl(e.target.value); localStorage.setItem("sahara_api_url", e.target.value); }} placeholder="http://192.168.1.128:8080" className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500" />
                  <p className="text-xs text-slate-500 mt-1">Local IP for same-network, or tunnel URL for remote access.</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Theme</label>
                  <select value={theme} onChange={(e) => setTheme(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm">
                    <option value="dark">Dark (default)</option>
                    <option value="light">Light</option>
                    <option value="midnight">Midnight</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Sound alerts</span>
                  <button onClick={() => { setSoundEnabled(!soundEnabled); localStorage.setItem("sahara_sound", !soundEnabled ? "on" : "off"); }} className={"px-3 py-1 rounded text-xs " + (soundEnabled ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700/50 text-slate-400")}>{soundEnabled ? "On" : "Off"}</button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">TTS announcements</span>
                  <button onClick={() => { setTtsEnabled(!ttsEnabled); localStorage.setItem("sahara_tts", !ttsEnabled ? "on" : "off"); }} className={"px-3 py-1 rounded text-xs " + (ttsEnabled ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700/50 text-slate-400")}>{ttsEnabled ? "On" : "Off"}</button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Auto-refresh interval</span>
                  <select className="px-3 py-1 rounded bg-slate-800/50 border border-slate-700 text-xs">
                    <option>5s</option>
                    <option>10s</option>
                    <option>30s</option>
                  </select>
                </div>
              </div>
            )}
          </motion.div>
        )}
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
                <button onClick={() => { setTrollSweepActive(false); setTrollSweepMembers(0); }} className="w-full mt-4 px-4 py-2 rounded-lg bg-indigo-500/20 text-indigo-300 text-sm hover:bg-indigo-500/30 transition">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
      {isAndre && loggedIn && !slingStatusAsked && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass rounded-2xl p-6 w-96 text-center">
            <div className="text-4xl mb-3">🦴</div>
            <h3 className="font-bold text-lg mb-2">Sling status?</h3>
            <p className="text-sm text-slate-300 mb-4">Are you wearing the sling right now? This controls the reminders.</p>
            <div className="flex gap-2">
              <button onClick={() => { setSlingOn(true); localStorage.setItem("sahara_sling","on"); localStorage.setItem("sahara_sling_asked","1"); setSlingStatusAsked(true); }} className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 font-semibold hover:opacity-90 transition">Yes, sling on</button>
              <button onClick={() => { setSlingOn(false); localStorage.setItem("sahara_sling","off"); localStorage.setItem("sahara_sling_asked","1"); setSlingStatusAsked(true); }} className="flex-1 py-2.5 rounded-lg bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 transition">No, it's off</button>
            </div>
          </motion.div>
        </motion.div>
      )}
      {armReminder && isAndre && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setArmReminder(false)}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass rounded-2xl p-6 w-96 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl mb-3">💪</div>
            <h3 className="font-bold text-lg mb-2">Gentle Arm Care</h3>
            <p className="text-sm text-slate-300 mb-4">Time to take your arm out of the sling for a bit — gentle shoulder/elbow movement, then back in. Ice ~10 min if sore.</p>
            <div className="flex gap-2">
              <button onClick={() => { setArmReminder(false); setTimeout(() => setArmReminder(true), 2 * 60 * 60 * 1000); }} className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 font-semibold hover:opacity-90 transition">Done</button>
              <button onClick={() => { setArmReminder(false); setTimeout(() => setArmReminder(true), 30 * 60 * 1000); }} className="flex-1 py-2.5 rounded-lg bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 transition">Snooze 30m</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
