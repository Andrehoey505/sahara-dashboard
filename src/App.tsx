import React, { useState, useEffect, useRef } from "react";
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
  const [violations, setViolations] = useState([
    { id: 1, user: "wolfman_4328", server: "Bear Café", type: "profanity", severity: "medium", words: ["fuck"], time: "2m ago", status: "pending" },
    { id: 2, user: "spammer99", server: "Babble Playpen", type: "spam", severity: "high", words: ["buy now"], time: "15m ago", status: "pending" },
  ]);
  const [contextMenu, setContextMenu] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [violationFilter, setViolationFilter] = useState("all");

  useEffect(() => {
    const saved = localStorage.getItem("sahara_user");
    const savedPin = localStorage.getItem("sahara_pin");
    if (saved) { setUserId(saved); setLoggedIn(true); }
    if (savedPin) { setPin(savedPin); setPinSet(true); setLocked(true); }
  }, []);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const notify = (msg, type = "info") => {
    const id = Date.now();
    setNotifications((n) => [...n, { id, msg, type }]);
    setTimeout(() => setNotifications((n) => n.filter((x) => x.id !== id)), 3000);
  };

  const handleLogin = () => {
    if (!userId.trim()) { notify("Enter your Discord User ID", "error"); return; }
    localStorage.setItem("sahara_user", userId);
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

  const clearFeed = () => { setMessages([]); notify("Feed cleared", "info"); };

  const handleContextAction = (action, msg) => {
    setContextMenu(null);
    if (action === "approve") { setViolations((v) => v.map((x) => x.id === msg.id ? { ...x, status: "resolved" } : x)); notify("Approved", "success"); }
    else if (action === "deny") { setViolations((v) => v.map((x) => x.id === msg.id ? { ...x, status: "denied" } : x)); notify("Denied", "error"); }
    else if (action === "delete") { setMessages((m) => m.filter((x) => x.id !== msg.id)); notify("Deleted", "info"); }
    else { notify(action + " " + msg.user, "info"); }
  };

  const filteredMessages = messages.filter((m) =>
    m.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.server.toLowerCase().includes(searchQuery.toLowerCase())
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
          <p className="text-xs text-slate-400 mb-1">Logged in as</p>
          <p className="text-sm font-mono truncate">{userId}</p>
          <div className="flex gap-2 mt-2">
            <button onClick={() => { setLocked(true); notify("Locked", "info"); }} className="flex-1 text-xs py-1 rounded bg-slate-700/50 hover:bg-slate-600/50 transition">Lock</button>
            <button onClick={() => { localStorage.removeItem("sahara_user"); setLoggedIn(false); }} className="flex-1 text-xs py-1 rounded bg-slate-700/50 hover:bg-slate-600/50 transition">Sign Out</button>
          </div>
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
                { label: "Messages Today", value: "8,432", color: "from-emerald-500 to-teal-500" },
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
                    { label: "Run Troll Sweep", action: () => notify("Troll sweep started", "info") },
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
          </motion.div>
        )}

        {active === "livefeed" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-slate-400">{filteredMessages.length} messages - Right-click for actions</p>
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
                    <div className="text-right">
                      <span className="text-xs text-slate-500">{m.time}</span>
                      {m.flagged && <div className="text-xs text-rose-400 mt-1">flagged</div>}
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
                  </div>
                  <div className="flex gap-2">
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
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-8 text-center">
            <Sparkles className="w-12 h-12 mx-auto mb-4 text-indigo-400 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">{active.charAt(0).toUpperCase() + active.slice(1)}</h3>
            <p className="text-sm text-slate-400">Coming soon - connect to bot session for live data.</p>
          </motion.div>
        )}
      </main>
    </div>
  );
}
EOF