import React, { useState } from "react";
import {
  LayoutDashboard, Activity, Users, Shield, Music, Settings,
  Crown, Sparkles, Bell, Search, ChevronRight, Zap
} from "lucide-react";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "activity", label: "Live Activity", icon: Activity },
  { id: "members", label: "Members", icon: Users },
  { id: "moderation", label: "Moderation", icon: Shield },
  { id: "music", label: "Music", icon: Music },
  { id: "settings", label: "Settings", icon: Settings },
];

const STATS = [
  { label: "Servers", value: "6", delta: "+0", color: "from-indigo-500 to-purple-500" },
  { label: "Members", value: "1,247", delta: "+12", color: "from-cyan-500 to-blue-500" },
  { label: "Messages Today", value: "8,432", delta: "+340", color: "from-emerald-500 to-teal-500" },
  { label: "Violations", value: "23", delta: "-5", color: "from-rose-500 to-orange-500" },
];

const EVENTS = [
  { type: "join", user: "smg4_2010", server: "Babble Playpen", time: "2m ago", color: "text-emerald-400" },
  { type: "violation", user: "wolfman_4328", server: "Bear Café", time: "5m ago", color: "text-rose-400" },
  { type: "leave", user: "debra04628", server: "Babble Playpen", time: "12m ago", color: "text-slate-400" },
  { type: "music", user: "stitchy_gw", server: "SocialLink.io", time: "18m ago", color: "text-purple-400" },
  { type: "join", user: "alex_dev", server: "Bear Café", time: "24m ago", color: "text-emerald-400" },
];

export default function App() {
  const [active, setActive] = useState("dashboard");
  const [premium, setPremium] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 glass flex flex-col p-4">
        <div className="flex items-center gap-3 px-2 py-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center pulse-glow">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-lg">Sahara</h1>
            <p className="text-xs text-slate-400">Control Center</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {NAV.map((n) => {
            const Icon = n.icon;
            const isActive = active === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setActive(n.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                }`}
              >
                <Icon className="w-4 h-4" />
                {n.label}
                {isActive && <ChevronRight className="w-3 h-3 ml-auto" />}
              </button>
            );
          })}
        </nav>

        {/* Premium upsell */}
        <div className="mt-4 p-3 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Crown className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-amber-300">Premium</span>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Unlock advanced analytics, auto-moderation AI, and custom themes.
          </p>
          <button
            onClick={() => setPremium(!premium)}
            className="w-full py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-xs font-semibold hover:opacity-90 transition"
          >
            {premium ? "✓ Premium Active" : "Upgrade — $9/mo"}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold capitalize">{active}</h2>
            <p className="text-sm text-slate-400">Real-time Discord bot control</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                placeholder="Search..."
                className="pl-9 pr-4 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 w-64"
              />
            </div>
            <button className="p-2 rounded-lg bg-slate-800/50 border border-slate-700 hover:bg-slate-700/50 relative">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full" />
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-xs text-emerald-300">Bot Online</span>
            </div>
          </div>
        </div>

        {active === "dashboard" && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              {STATS.map((s) => (
                <div key={s.label} className="glass rounded-xl p-4 glow">
                  <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                  <div className="flex items-end justify-between">
                    <span className="text-2xl font-bold">{s.value}</span>
                    <span className={`text-xs ${s.delta.startsWith("+") ? "text-emerald-400" : "text-rose-400"}`}>
                      {s.delta}
                    </span>
                  </div>
                  <div className={`h-1 mt-3 rounded-full bg-gradient-to-r ${s.color} opacity-60`} />
                </div>
              ))}
            </div>

            {/* Two columns */}
            <div className="grid grid-cols-3 gap-4">
              {/* Activity feed */}
              <div className="col-span-2 glass rounded-xl p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-400" />
                    Live Activity Feed
                  </h3>
                  <span className="text-xs text-slate-500">Auto-refresh 5s</span>
                </div>
                <div className="space-y-2">
                  {EVENTS.map((e, i) => (
                    <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-800/30 transition">
                      <div className={`w-2 h-2 rounded-full ${e.color.replace("text", "bg")}`} />
                      <div className="flex-1">
                        <span className="text-sm font-medium">{e.user}</span>
                        <span className="text-xs text-slate-500 ml-2">{e.type}</span>
                      </div>
                      <span className="text-xs text-slate-500">{e.server}</span>
                      <span className="text-xs text-slate-600">{e.time}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick actions */}
              <div className="glass rounded-xl p-4">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  Quick Actions
                </h3>
                <div className="space-y-2">
                  {["Restart Bot", "Clear Cache", "Send Announcement", "Run Troll Sweep", "Export Logs"].map((a) => (
                    <button
                      key={a}
                      className="w-full text-left px-3 py-2 rounded-lg bg-slate-800/40 hover:bg-slate-700/50 text-sm transition flex items-center justify-between group"
                    >
                      {a}
                      <ChevronRight className="w-3 h-3 text-slate-600 group-hover:text-slate-300" />
                    </button>
                  ))}
                </div>

                {premium && (
                  <div className="mt-4 p-3 rounded-lg bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20">
                    <p className="text-xs font-semibold text-purple-300 mb-1">✨ Premium Active</p>
                    <p className="text-xs text-slate-400">AI auto-mod, custom themes, advanced analytics unlocked.</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {active !== "dashboard" && (
          <div className="glass rounded-xl p-8 text-center">
            <Sparkles className="w-12 h-12 mx-auto mb-4 text-indigo-400 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">{active.charAt(0).toUpperCase() + active.slice(1)} View</h3>
            <p className="text-sm text-slate-400">
              This section is being built. Connect to the bot session to populate live data.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
