import React from "react";
import { motion } from "framer-motion";
import { Moon, X, MessageCircle } from "lucide-react";
import { motionTokens } from "../lib/design";
import { formatDateTime } from "../lib/time";

export type AsleepMention = {
  timestamp: string;
  author_name: string;
  text: string;
  channel_name: string;
  guild_name?: string;
  jump_url?: string;
};

type Props = {
  flags: number;
  mentions?: AsleepMention[];
  since?: string | null;
  onDismiss: () => void;
};

/**
 * The morning card: everything that happened while the Mac was closed.
 *
 * One card, not one notification per event. Eleven pings at 3am is not company, it is
 * an alarm clock; the same eleven listed at 9am is just information. Mentions come
 * first because they are people who wanted an answer.
 */
export default function CatchUpBanner({ flags, mentions = [], since, onDismiss }: Props) {
  const hasMentions = mentions.length > 0;
  if (flags <= 0 && !hasMentions) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={motionTokens.enter}
      className="rounded-xl p-4 bg-indigo-500/10 border border-indigo-500/30 flex items-start gap-3"
      role="status"
    >
      <Moon className="w-5 h-5 text-indigo-300 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200">
          {hasMentions &&
            `${mentions.length} ${mentions.length === 1 ? "person mentioned you" : "people mentioned you"} while you were asleep.`}
          {hasMentions && flags > 0 && " "}
          {flags > 0 && `${flags} ${flags === 1 ? "flag" : "flags"} came in too.`}
        </p>
        {since && (
          <p className="text-xs text-slate-400 mt-1">Since {formatDateTime(since)}</p>
        )}

        {hasMentions && (
          <ul className="mt-3 space-y-2">
            {mentions.map((m, i) => (
              <li key={i} className="rounded-lg bg-slate-950/40 px-3 py-2">
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <MessageCircle className="w-3 h-3" />
                  <span className="font-medium text-slate-300">{m.author_name}</span>
                  {m.channel_name && <span>· #{m.channel_name}</span>}
                  <span>· {formatDateTime(m.timestamp)}</span>
                </div>
                <p className="text-[13px] text-slate-200 mt-1 whitespace-pre-wrap break-words">
                  {m.text || "(no text)"}
                </p>
                {m.jump_url && (
                  <a
                    href={m.jump_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-indigo-300 hover:text-indigo-200 mt-1 inline-block"
                  >
                    Open in Discord →
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss catch-up notice"
        className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 transition-colors"
        data-tip="Dismiss this summary">
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}
