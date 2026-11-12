import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Search, Check, ShieldCheck, ShieldAlert, Hash, Users } from "lucide-react";
import { motionTokens } from "../lib/design";
import type { Server } from "../lib/servers";

type Props = {
  servers: Server[];
  active: string;
  onSelect: (id: string) => void;
  /** When true the picker is a full-width block rather than a compact chip. */
  full?: boolean;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

function Avatar({ server, size = 32 }: { server: Server; size?: number }) {
  const [failed, setFailed] = useState(false);
  const showImage = server.icon && !failed;
  return (
    <span
      className="shrink-0 rounded-xl overflow-hidden grid place-items-center bg-gradient-to-br from-indigo-500/30 to-fuchsia-500/30 border border-white/10 text-[11px] font-semibold text-slate-100"
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={server.icon as string}
          alt=""
          width={size}
          height={size}
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        initials(server.name) || "?"
      )}
    </span>
  );
}

/**
 * Server picker. The list comes from the bot, so it is always the servers the
 * bot is actually in — never a hardcoded set of names.
 */
export default function ServerPicker({ servers, active, onSelect, full }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const current = servers.find((s) => s.id === active);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter(
      (s) => s.name.toLowerCase().includes(q) || s.id.includes(q)
    );
  }, [servers, query]);

  if (servers.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm text-slate-400">
        <ShieldAlert className="w-4 h-4 text-amber-400" />
        No servers — the bot isn't in any, or it's offline.
      </div>
    );
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={
          "flex items-center gap-3 rounded-xl bg-slate-800/60 border border-slate-700 hover:border-indigo-500/50 hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 " +
          (full ? "w-full px-4 py-3" : "px-3 py-2")
        }
       data-tip="Choose a server">
        {current ? <Avatar server={current} size={full ? 36 : 28} /> : <ShieldAlert className="w-4 h-4 text-slate-500" />}
        <span className="min-w-0 text-left">
          <span className="block text-sm font-medium text-slate-100 truncate">
            {current?.name || "Pick a server"}
          </span>
          {full && current && (
            <span className="block text-xs text-slate-500 truncate">
              {current.member_count?.toLocaleString() ?? "?"} members
              {current.prefix ? ` · prefix ${current.prefix}` : ""}
            </span>
          )}
        </span>
        <ChevronDown
          className={"w-4 h-4 ml-auto shrink-0 text-slate-500 transition-transform " + (open ? "rotate-180" : "")}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={motionTokens.enter}
            role="listbox"
            /* min-w made the dropdown wider than the chip it hangs from, so on a
               narrow chip it spilled sideways over the screen header. It matches
               the button's width now and only grows when there is room. */
            className="absolute z-40 mt-2 left-0 w-full sm:min-w-[16rem] max-w-[min(22rem,calc(100vw-4rem))] rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-slate-700 shadow-2xl shadow-black/50 overflow-hidden"
          >
            {servers.length > 6 && (
              <div className="p-2 border-b border-slate-800">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search servers"
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-800/70 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto thin-scroll p-1.5">
              {filtered.length === 0 && (
                <p className="px-3 py-4 text-sm text-slate-500">No server matches that.</p>
              )}
              {filtered.map((s) => {
                const selected = s.id === active;
                return (
                  <button
                    key={s.id}
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onSelect(s.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={
                      "w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left transition-colors " +
                      (selected ? "bg-indigo-500/15" : "hover:bg-slate-800/70")
                    }
                  >
                    <Avatar server={s} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-slate-100 truncate">{s.name}</span>
                      <span className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                        <span className="inline-flex items-center gap-0.5">
                          <Users className="w-3 h-3" />
                          {s.member_count?.toLocaleString() ?? "?"}
                        </span>
                        {typeof s.text_channels === "number" && (
                          <span className="inline-flex items-center gap-0.5">
                            <Hash className="w-3 h-3" />
                            {s.text_channels}
                          </span>
                        )}
                        {s.can_moderate ? (
                          <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <ShieldAlert className="w-3 h-3 text-amber-400" />
                        )}
                      </span>
                    </span>
                    {selected && <Check className="w-4 h-4 shrink-0 text-indigo-400" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
