/**
 * Which address the app talks to, and why it changed.
 *
 * The connection code has been rewritten several times over two nights chasing
 * "the LAN address will not save and Tailscale keeps taking over". Each rewrite
 * was a reasoned guess at which layer was refusing, and the guesses were the
 * problem: there was no way to see what the running app had actually decided.
 *
 * So the decision is recorded here -- every probe, which address, what came
 * back, how long it took, which one was chosen, and every write to the saved
 * settings -- and the app can show it. Not a debug console for a developer, a
 * short plain-English list for whoever is looking at the screen and trying to
 * work out why the thing they typed is not the thing it is using.
 *
 * It holds the last N entries in memory only. It is a view of what just
 * happened, not a log to keep.
 */

export type TraceEvent = {
  /** When, as a clock time, because that is how someone reads it. */
  at: string;
  /** What kind of thing happened. */
  kind: "probe" | "chosen" | "saved" | "load" | "error";
  /** One line, already human. */
  line: string;
};

const MAX = 60;
const buffer: TraceEvent[] = [];
type Listener = (events: TraceEvent[]) => void;
const listeners = new Set<Listener>();

function stamp(): string {
  const d = new Date();
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Record one thing that happened. */
export function trace(kind: TraceEvent["kind"], line: string) {
  buffer.push({ at: stamp(), kind, line });
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  for (const l of listeners) l([...buffer]);
}

/** The entries so far, oldest first. */
export function traceRead(): TraceEvent[] {
  return [...buffer];
}

/** Watch for new entries. Returns the unsubscribe. */
export function traceWatch(fn: Listener): () => void {
  listeners.add(fn);
  fn([...buffer]);
  return () => listeners.delete(fn);
}

/** Clear it, for when the next thing tried should not be read through the last. */
export function traceClear() {
  buffer.length = 0;
  for (const l of listeners) l([]);
}
