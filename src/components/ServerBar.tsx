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
 *
 * The bar takes a row of its own and the hint sits underneath it. Side by side,
 * the hint ran out of width, wrapped to a second line inside a fixed-height
 * row, and the picker drew over the header and the search box below.
 */
export default function ServerBar({ servers, active, onSelect, label, hint, full }: Props) {
  if (servers.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
        {label && (
          <span className="text-xs uppercase tracking-wide text-slate-500 font-medium shrink-0">
            {label}
          </span>
        )}
        <div className={full ? "w-full sm:w-72" : "w-56 shrink-0"}>
          <ServerPicker servers={servers} active={active} onSelect={onSelect} full={full} />
        </div>
      </div>
      {hint && <p className="text-xs text-slate-500 mt-1.5 ml-0">{hint}</p>}
    </div>
  );
}
