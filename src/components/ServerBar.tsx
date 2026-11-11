import React from "react";
import ServerPicker from "./ServerPicker";
import type { Server } from "../lib/servers";

type Props = {
  servers: Server[];
  active: string;
  onSelect: (id: string) => void;
  /** What the picker is choosing for, shown above it. */
  label?: string;
  hint?: string;
  /** Renders the picker as a wide block instead of a chip. */
  full?: boolean;
};

/**
 * A server picker strip for the top of a screen.
 *
 * Only screens whose content belongs to a single server get one; the picker
 * used to sit in the global header, where it was in the way on every screen
 * and could collide with the search box on a narrow window.
 */
export default function ServerBar({ servers, active, onSelect, label, hint, full }: Props) {
  if (servers.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {label && (
        <span className="text-xs uppercase tracking-wide text-slate-500 font-medium">
          {label}
        </span>
      )}
      <div className={full ? "w-full sm:w-72" : "w-56 shrink-0"}>
        <ServerPicker servers={servers} active={active} onSelect={onSelect} full={full} />
      </div>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </div>
  );
}
