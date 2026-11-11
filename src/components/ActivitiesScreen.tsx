import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Hash, Link2, Gift, RefreshCw, Trophy } from "lucide-react";
import { motionTokens } from "../lib/design";

type Activities = {
  guild_id: string;
  counting: {
    last_count: number;
    last_counter_id?: string | null;
    last_counter_name?: string | null;
    next_number?: number;
  };
  wordchain: {
    active?: boolean;
    last_word?: string;
    used_words?: string[];
    last_user_id?: string;
    last_user_name?: string | null;
  };
  giveaways: { prize?: string; ends_at?: string; host?: string; [k: string]: unknown }[];
};

type Props = { apiUrl: string };

export default function ActivitiesScreen({ apiUrl }: Props) {
  const [data, setData] = useState<Activities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl + "/api/activities");
      if (!res.ok) throw new Error("bad status");
      setData(await res.json());
      setError("");
    } catch {
      setError("Couldn't reach the bot API — is the Windows laptop awake?");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const card = "glass rounded-2xl p-5";

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Activities</h2>
          <p className="text-sm text-slate-400 mt-1">Games running in Babble Playpen.</p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh activities"
          className="p-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="rounded-xl p-4 bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={card}>
            <div className="flex items-center gap-2 mb-3">
              <Hash className="w-4 h-4 text-indigo-300" />
              <h3 className="font-medium">Counting</h3>
            </div>
            <p className="text-4xl font-bold tabular-nums text-indigo-300">
              {data.counting?.last_count ?? 0}
            </p>
            <p className="text-xs text-slate-500 mt-2">
              {data.counting?.last_counter_id
                ? `counted by ${data.counting?.last_counter_name || "a member"}`
                : "no counts yet"}
            </p>
            <p className="text-xs text-indigo-300/80 mt-1">
              next is {data.counting?.next_number ?? (data.counting?.last_count ?? 0) + 1}
            </p>
          </div>

          <div className={card}>
            <div className="flex items-center gap-2 mb-3">
              <Link2 className="w-4 h-4 text-indigo-300" />
              <h3 className="font-medium">Word chain</h3>
            </div>
            <p className="text-2xl font-semibold">
              {data.wordchain?.last_word || "—"}
            </p>
            {data.wordchain?.active && data.wordchain?.last_word ? (
              <>
                <p className="text-xs text-slate-500 mt-2">
                  played by {data.wordchain?.last_user_name || "a member"}
                </p>
                <p className="text-xs text-indigo-300/80 mt-1">
                  next must start with{" "}
                  <span className="font-semibold uppercase">
                    {data.wordchain.last_word.slice(-1)}
                  </span>
                  {" · "}
                  {data.wordchain?.used_words?.length ?? 0} words used
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-500 mt-2">
                {data.wordchain?.active ? "waiting for the first word" : "not running"}
              </p>
            )}
          </div>

          <div className={card + " sm:col-span-2"}>
            <div className="flex items-center gap-2 mb-3">
              <Gift className="w-4 h-4 text-indigo-300" />
              <h3 className="font-medium">
                Giveaways {data.giveaways?.length ? `(${data.giveaways.length})` : ""}
              </h3>
            </div>
            {!data.giveaways?.length ? (
              <p className="text-sm text-slate-500">No giveaways running.</p>
            ) : (
              <div className="space-y-2">
                {data.giveaways.map((g, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/40"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Trophy className="w-4 h-4 text-amber-300 shrink-0" />
                      <span className="text-sm truncate">{g.prize || "Prize"}</span>
                    </div>
                    {g.ends_at && (
                      <span className="text-xs text-slate-500 shrink-0">
                        ends {new Date(g.ends_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </motion.section>
  );
}
