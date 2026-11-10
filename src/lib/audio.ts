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
 * Pick a calm, natural-sounding local voice.
 *
 * The list is empty until the platform finishes loading it, so this is called
 * at speak time rather than cached once at startup.
 */
function preferredVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => /Samantha|Serena|Daniel|Google UK English Female/i.test(v.name)) ||
    voices.find((v) => v.lang === "en-GB") ||
    voices[0]
  );
}

/**
 * Speech queue.
 *
 * One utterance at a time, strictly in arrival order: a line waits for the one
 * before it to finish. Nothing is cancelled to make room, because cancelling is
 * what used to cut announcements off mid-sentence.
 *
 * Two behaviours worth knowing:
 * - Duplicates within DUPLICATE_WINDOW_MS are dropped. Three violations landing
 *   together shouldn't be read out three times; the toast still shows each one.
 * - The queue is capped, and when it overflows the oldest waiting line goes
 *   first. A burst of twenty is less useful than the latest few.
 */
type QueuedSpeech = { text: string; rate: number; pitch: number; at: number };

const DUPLICATE_WINDOW_MS = 2000;
const MAX_QUEUE = 8;

const speechQueue: QueuedSpeech[] = [];
let speaking = false;
let lastSpoken: { text: string; at: number } = { text: "", at: 0 };

function dequeueAndSpeak() {
  if (speaking) return;
  const next = speechQueue.shift();
  if (!next) return;

  speaking = true;
  let settled = false;
  // onend fires on most paths, onerror on the rest, and neither on a few
  // platform bugs (notably voices that fail to load). Settle once, on whichever
  // comes first, with a duration-based backstop so the queue can't wedge.
  const settle = () => {
    if (settled) return;
    settled = true;
    speaking = false;
    dequeueAndSpeak();
  };

  try {
    const u = new SpeechSynthesisUtterance(next.text);
    u.rate = next.rate;
    u.pitch = next.pitch;
    u.volume = 1;
    const voice = preferredVoice();
    if (voice) u.voice = voice;

    u.onend = settle;
    u.onerror = settle;

    window.speechSynthesis.speak(u);
    // Backstop: roughly 90ms per character, capped, in case no event arrives.
    const backstop = Math.min(60000, 2000 + next.text.length * 90);
    setTimeout(() => {
      if (!settled) {
        speaking = false;
        dequeueAndSpeak();
      }
    }, backstop);
  } catch {
    settle();
  }
}

/**
 * Speak a line. Prefers a calmer, slower delivery: the app is often used at
 * night and a clipped default voice is jarring.
 *
 * Lines are queued, not played over the top of each other — one ends, the next
 * begins, in the order they were requested.
 */
export function speak(text: string, enabled = true, rate = 0.95, pitch = 0.95) {
  if (!enabled) return;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const line = (text || "").trim();
  if (!line) return;

  const now = Date.now();
  const isDuplicate =
    speechQueue.some((q) => q.text === line && now - q.at < DUPLICATE_WINDOW_MS) ||
    (speaking && lastSpoken.text === line && now - lastSpoken.at < DUPLICATE_WINDOW_MS);
  if (isDuplicate) return;

  if (speechQueue.length >= MAX_QUEUE) speechQueue.shift();
  speechQueue.push({ text: line, rate, pitch, at: now });
  lastSpoken = { text: line, at: now };
  dequeueAndSpeak();
}

/** Stop speaking and drop anything still waiting. */
export function stopSpeaking() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  speechQueue.length = 0;
  speaking = false;
  lastSpoken = { text: "", at: 0 };
  try {
    window.speechSynthesis.cancel();
  } catch {}
}

/** Warm the voice list so the first announcement isn't silent while it loads. */
export function primeVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}
