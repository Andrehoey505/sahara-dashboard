/**
 * The alarm.
 *
 * BabbleBot runs on a Windows laptop that can lose power. When it goes, nothing
 * moderates a 109-channel server, and the person who would notice is asleep. So
 * the app has to be loud: not a toast that fades, not a red dot, an alarm that
 * keeps going until a human says something.
 *
 * ## Why the Web Audio API and not an audio file
 *
 * No asset to ship, no file to fail to load, no codec to argue with. Two
 * oscillators and a gain envelope make a two-tone warble that is unpleasant in
 * the specific way an alarm should be -- it changes, so the ear cannot tune it
 * out the way it tunes out a steady beep.
 *
 * ## The rules this follows
 *
 * - **It stops when a human acts, and only then.** Not on a timer, not when the
 *   page is looked at. `stop()` is called by the acknowledge button or by a
 *   successful handover, and by nothing else.
 * - **It is never the only signal.** The screen says the same thing in words,
 *   because an alarm with no explanation is just noise at 4am.
 * - **It is cancellable in one press**, because an alarm nobody can silence gets
 *   muted at the system level and then it protects nothing.
 * - **It does not fight the sound setting.** If Andre has turned app sounds off,
 *   the alarm still runs: that setting is for notification blips, not for "your
 *   server is unmoderated". A separate, explicit mute exists in the offer box.
 */

let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** One two-tone warble: up, then down. ~380ms. */
function chirp(context: AudioContext) {
  const now = context.currentTime;
  const gain = context.createGain();
  gain.connect(context.destination);

  // A quick attack and decay per tone. A raw square wave at full gain is
  // startling in a bad way on laptop speakers -- it clips and sounds like a
  // fault. This shapes it into something deliberately attention-getting.
  const tone = (start: number, freq: number, len: number) => {
    const osc = context.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now + start);
    const g = context.createGain();
    g.gain.setValueAtTime(0.0001, now + start);
    g.gain.exponentialRampToValueAtTime(0.28, now + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + len);
    osc.connect(g);
    g.connect(gain);
    osc.start(now + start);
    osc.stop(now + start + len + 0.02);
  };

  tone(0, 880, 0.16);
  tone(0.19, 660, 0.16);
}

/** Start, or make sure it is still going. Safe to call repeatedly. */
export function alarmStart() {
  if (typeof window === "undefined") return;
  try {
    if (!ctx) ctx = new AudioContext();
    // Browsers suspend an AudioContext created without a gesture. Resuming is
    // allowed once the user has interacted with the window at all, which they
    // have if they are looking at it.
    void ctx.resume();
    if (timer) return;
    chirp(ctx);
    // Every 1.4s. Faster than a heartbeat, slower than panic: frequent enough to
    // wake someone, spaced enough to hear the screen's instructions between.
    timer = setInterval(() => {
      if (!ctx) return;
      if (ctx.state === "suspended") void ctx.resume();
      chirp(ctx);
    }, 1400);
  } catch {
    // No audio available (no output device, a locked-down webview). The screen
    // still says everything the alarm says; it must not throw on top of that.
  }
}

/** Silence it. Called on acknowledge, on handover, and on reconnect. */
export function alarmStop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Whether it is currently going, for the UI to show honestly. */
export const alarmRunning = () => timer !== null;
