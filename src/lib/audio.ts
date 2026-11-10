/**
 * Notification sounds and speech.
 *
 * Sounds are synthesised with the Web Audio API rather than shipped as files:
 * they're short, they stay consistent across platforms, and there's nothing to
 * load. Each cue is a small two-note phrase so they're pleasant rather than a
 * harsh beep.
 */

type Cue = "success" | "error" | "violation" | "join" | "sleep" | "wake";

type Note = { freq: number; at: number; dur: number; gain?: number };

const CUES: Record<Cue, Note[]> = {
  // Rising fifth — friendly, done.
  success: [
    { freq: 587.33, at: 0, dur: 0.12 },
    { freq: 880.0, at: 0.09, dur: 0.18 },
  ],
  // Soft descending third — something needs a look, but not alarming.
  error: [
    { freq: 392.0, at: 0, dur: 0.14 },
    { freq: 311.13, at: 0.11, dur: 0.22 },
  ],
  // Two even notes, slightly higher — a flag came in.
  violation: [
    { freq: 659.25, at: 0, dur: 0.1 },
    { freq: 659.25, at: 0.14, dur: 0.14 },
  ],
  // Gentle ascending triad — someone arrived.
  join: [
    { freq: 523.25, at: 0, dur: 0.1 },
    { freq: 659.25, at: 0.08, dur: 0.1 },
    { freq: 783.99, at: 0.16, dur: 0.16 },
  ],
  // Low, slow, calming — bedtime.
  sleep: [
    { freq: 329.63, at: 0, dur: 0.24 },
    { freq: 261.63, at: 0.2, dur: 0.36 },
  ],
  // Bright, quick — morning.
  wake: [
    { freq: 440.0, at: 0, dur: 0.1 },
    { freq: 587.33, at: 0.08, dur: 0.1 },
    { freq: 880.0, at: 0.16, dur: 0.2 },
  ],
};

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // Browsers suspend the context until a gesture; resume on demand.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** Play a notification cue. Silently does nothing if audio is unavailable. */
export function playCue(cue: Cue, enabled = true) {
  if (!enabled) return;
  const ac = context();
  if (!ac) return;
  const notes = CUES[cue];
  if (!notes) return;

  notes.forEach(({ freq, at, dur, gain = 0.08 }) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(g);
    g.connect(ac.destination);

    const start = ac.currentTime + at;
    // Short attack, exponential decay — avoids clicks at either end.
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.start(start);
    osc.stop(start + dur + 0.02);
  });
}

/**
 * Speak a line. Prefers a calmer, slower delivery: the app is often used at
 * night and a clipped default voice is jarring.
 */
export function speak(text: string, enabled = true, rate = 0.95, pitch = 0.95) {
  if (!enabled) return;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = pitch;
    u.volume = 1;

    // Prefer a natural-sounding local voice when one is available.
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => /Samantha|Serena|Daniel|Google UK English Female/i.test(v.name)) ||
      voices.find((v) => v.lang === "en-GB") ||
      voices[0];
    if (preferred) u.voice = preferred;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {}
}

/** Warm the voice list so the first announcement isn't silent while it loads. */
export function primeVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}
