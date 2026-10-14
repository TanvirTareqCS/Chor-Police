"use client";

/**
 * Tiny synthesized sound engine.
 *
 * All effects are generated with the Web Audio API — no asset files, no
 * downloads, works fully offline. Call `unlockAudio()` from a user gesture
 * (tap/click) so browsers allow playback.
 */

export type SoundName =
  | "deal"
  | "reveal"
  | "start"
  | "tick"
  | "warning"
  | "lock"
  | "correct"
  | "wrong"
  | "win"
  | "lose"
  | "message"
  | "join";

const STORAGE_KEY = "cp_muted";
const MASTER_GAIN = 0.22;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  try {
    muted = window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    muted = false;
  }
}

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
  }
  return ctx;
}

export function subscribeMuted(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getMutedSnapshot(): boolean {
  return muted;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  if (muted === next) return;
  muted = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (ctx && master) {
    master.gain.setTargetAtTime(next ? 0 : MASTER_GAIN, ctx.currentTime, 0.02);
  }
  listeners.forEach((cb) => cb());
}

export function unlockAudio(): void {
  const c = ensureContext();
  if (c && c.state === "suspended") void c.resume();
}

interface ToneOptions {
  freq: number;
  type?: OscillatorType;
  dur?: number;
  delay?: number;
  gain?: number;
  slideTo?: number;
}

function tone({
  freq,
  type = "sine",
  dur = 0.15,
  delay = 0,
  gain = 0.5,
  slideTo,
}: ToneOptions): void {
  const c = ensureContext();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function siren(): void {
  for (let i = 0; i < 3; i++) {
    tone({
      freq: i % 2 === 0 ? 660 : 880,
      type: "triangle",
      dur: 0.18,
      delay: i * 0.18,
      gain: 0.16,
      slideTo: i % 2 === 0 ? 880 : 660,
    });
  }
}

function chord(freqs: number[], delay = 0, dur = 0.5, type: OscillatorType = "triangle"): void {
  freqs.forEach((freq, i) => {
    tone({ freq, type, dur, delay: delay + i * 0.06, gain: 0.22 });
  });
}

export function playSound(name: SoundName): void {
  if (muted) return;
  switch (name) {
    case "deal":
      tone({ freq: 320, type: "triangle", dur: 0.16, gain: 0.2, slideTo: 180 });
      break;
    case "reveal":
      chord([523.25, 659.25, 783.99], 0, 0.35, "sine");
      break;
    case "start":
      tone({ freq: 660, type: "sine", dur: 0.12, gain: 0.18 });
      tone({ freq: 990, type: "sine", dur: 0.16, delay: 0.12, gain: 0.16 });
      break;
    case "tick":
      tone({ freq: 780, type: "sine", dur: 0.04, gain: 0.09 });
      break;
    case "warning":
      tone({ freq: 620, type: "triangle", dur: 0.14, gain: 0.16 });
      tone({ freq: 480, type: "triangle", dur: 0.14, delay: 0.18, gain: 0.16 });
      break;
    case "lock":
      siren();
      break;
    case "correct":
      chord([523.25, 659.25, 783.99, 1046.5], 0, 0.45, "sine");
      break;
    case "wrong":
      tone({ freq: 220, type: "sine", dur: 0.24, gain: 0.18, slideTo: 110 });
      tone({ freq: 170, type: "sine", dur: 0.3, delay: 0.2, gain: 0.16, slideTo: 90 });
      break;
    case "win":
      chord([523.25, 659.25, 783.99], 0, 0.3, "sine");
      chord([587.33, 739.99, 880], 0.26, 0.3, "sine");
      chord([659.25, 830.61, 1046.5], 0.52, 0.6, "sine");
      break;
    case "lose":
      chord([392, 329.63, 261.63], 0, 0.5, "sine");
      break;
    case "message":
      tone({ freq: 880, type: "sine", dur: 0.05, gain: 0.06 });
      break;
    case "join":
      tone({ freq: 660, type: "sine", dur: 0.09, gain: 0.14 });
      tone({ freq: 990, type: "sine", dur: 0.11, delay: 0.09, gain: 0.12 });
      break;
    default:
      break;
  }
}
