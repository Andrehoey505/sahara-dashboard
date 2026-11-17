/**
 * One request at a time to the bot.
 *
 * ## Why
 *
 * The bot runs on a laptop with 6 GB of RAM sitting at 98% used. It does not
 * refuse connections when it is under pressure -- it accepts them and then
 * answers slowly, or drops some. That is the worst possible failure shape,
 * because every request looks independently fine and the app's only reaction is
 * to ask again.
 *
 * The app does ask again, from several places at once. Eleven screens poll, the
 * settings screen probes both addresses on every check, and the failover path
 * probes each address repeatedly. A slow answer means more requests in flight,
 * which means slower answers. Nothing caps it.
 *
 * So requests to the bot are serialised here. One at a time, in the order asked.
 * A LAN request that takes 25ms and a Tailscale request that takes 600ms do not
 * queue against each other in any way they did not before -- what changes is
 * that a burst of eleven screens plus a probe does not become thirty sockets at
 * a laptop that is already out of memory.
 *
 * ## What it is not
 *
 * Not a debounce and not a cache. Nothing is dropped and nothing is answered
 * from an older result: every caller gets its own real answer, it may just wait
 * its turn. Dropping a poll is the screen's decision to make, not this one's.
 */

let tail: Promise<unknown> = Promise.resolve();

/** Run `fn` after everything already queued. */
export function queueRequest<T>(fn: () => Promise<T>): Promise<T> {
  const next = tail.then(fn, fn);
  // The chain must not reject, or one failed request would poison every later
  // one. `fn`'s own promise still carries the failure back to its caller.
  tail = next.catch(() => undefined);
  return next;
}

/** How many are waiting, for the connection log. */
let waiting = 0;
export const queueDepth = () => waiting;

/** Wrap so the counter moves around the actual work. */
export function counted<T>(fn: () => Promise<T>): Promise<T> {
  waiting++;
  return fn().finally(() => {
    waiting--;
  });
}
