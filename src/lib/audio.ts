import { db } from "./storage.js";

// ---------- types ----------

export type SfxName =
  | "tap" | "place" | "score" | "coin" | "merge"
  | "shoot" | "hit" | "kill" | "bounce" | "pop"
  | "jump" | "slide" | "match" | "flip"
  | "win" | "lose" | "gameover" | "levelup"
  | "click" | "error" | "countdown" | "go";

// ---------- config ----------

const MASTER_GAIN = 0.25;
const MAX_VOICES = 8;
const DEBOUNCE_MS = 30;
const SETTINGS_KEY = "audio:muted";

// ---------- state ----------

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

let muted = false;
let muteLoaded = false;

let activeVoices = 0;
const lastPlayTime = new Map<SfxName, number>();
const muteSubscribers = new Set<(m: boolean) => void>();

// ---------- init ----------

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = MASTER_GAIN;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}

function getMasterGain(): GainNode {
  getCtx();
  return masterGain!;
}

function getNoiseBuffer(): AudioBuffer {
  const ac = getCtx();
  if (!noiseBuffer) {
    const len = ac.sampleRate * 0.5; // 500ms reusable white noise
    noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return noiseBuffer;
}

// ---------- voice management ----------

function trackVoice(node: AudioNode, durationSec: number): void {
  activeVoices++;
  setTimeout(() => { activeVoices = Math.max(0, activeVoices - 1); }, durationSec * 1000 + 50);
  void node; // reference kept alive by WebAudio graph
}

// ---------- envelope helpers ----------

function rampGain(gainNode: GainNode, peak: number, attackSec: number, decaySec: number, now: number): void {
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(peak, now + attackSec);
  gainNode.gain.linearRampToValueAtTime(0, now + attackSec + decaySec);
}

// ---------- synth primitives ----------

type OscType = OscillatorType;

function playOsc(
  type: OscType,
  freq: number,
  peak: number,
  attackSec: number,
  decaySec: number,
  freqEndHz?: number
): void {
  const ac = getCtx();
  const now = ac.currentTime;
  const total = attackSec + decaySec + 0.01;

  const osc = ac.createOscillator();
  const gn = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (freqEndHz !== undefined) {
    osc.frequency.linearRampToValueAtTime(freqEndHz, now + total);
  }
  rampGain(gn, peak, attackSec, decaySec, now);
  osc.connect(gn);
  gn.connect(getMasterGain());
  osc.start(now);
  osc.stop(now + total);
  trackVoice(osc, total);
}

function playNoise(
  cutoffHz: number,
  peak: number,
  attackSec: number,
  decaySec: number
): void {
  const ac = getCtx();
  const now = ac.currentTime;
  const total = attackSec + decaySec + 0.01;

  const src = ac.createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = true;

  const filt = ac.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = cutoffHz;

  const gn = ac.createGain();
  rampGain(gn, peak, attackSec, decaySec, now);

  src.connect(filt);
  filt.connect(gn);
  gn.connect(getMasterGain());
  src.start(now);
  src.stop(now + total);
  trackVoice(src, total);
}

function playArpeggio(
  type: OscType,
  freqs: number[],
  noteDurSec: number,
  peak: number
): void {
  const ac = getCtx();
  freqs.forEach((freq, i) => {
    const startTime = ac.currentTime + i * noteDurSec;
    const osc = ac.createOscillator();
    const gn = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gn.gain.setValueAtTime(0, startTime);
    gn.gain.linearRampToValueAtTime(peak, startTime + 0.005);
    gn.gain.linearRampToValueAtTime(0, startTime + noteDurSec * 0.9);
    osc.connect(gn);
    gn.connect(getMasterGain());
    osc.start(startTime);
    osc.stop(startTime + noteDurSec);
    trackVoice(osc, startTime - ac.currentTime + noteDurSec + 0.05);
  });
}

// ---------- sfx implementations ----------

const SFX_IMPL: Record<SfxName, () => void> = {
  // tap: square wave 800Hz, decay 60ms
  tap() { playOsc("square", 800, 0.6, 0.002, 0.058); },

  // place: sine 440Hz → 550Hz slide 80ms
  place() { playOsc("sine", 440, 0.7, 0.003, 0.077, 550); },

  // score: sine 660Hz + 880Hz bichord, decay 200ms
  score() {
    playOsc("sine", 660, 0.55, 0.005, 0.195);
    playOsc("sine", 880, 0.45, 0.005, 0.195);
  },

  // coin: triangle 1200Hz → 1600Hz chirp up 120ms
  coin() { playOsc("triangle", 1200, 0.7, 0.005, 0.115, 1600); },

  // merge: sine ascending glide 440→880 in 200ms
  merge() { playOsc("sine", 440, 0.65, 0.01, 0.19, 880); },

  // shoot: square 300Hz + noise burst 40ms
  shoot() {
    playOsc("square", 300, 0.5, 0.002, 0.038);
    playNoise(600, 0.3, 0.001, 0.039);
  },

  // hit: noise burst lowpass 200Hz, 80ms decay
  hit() { playNoise(200, 0.7, 0.001, 0.079); },

  // kill: noise burst + sine 120Hz hit, 150ms
  kill() {
    playNoise(400, 0.7, 0.001, 0.099);
    playOsc("sine", 120, 0.8, 0.003, 0.147);
  },

  // bounce: square 600Hz, decay 30ms
  bounce() { playOsc("square", 600, 0.55, 0.001, 0.029); },

  // pop: triangle 1000Hz, decay 70ms
  pop() { playOsc("triangle", 1000, 0.65, 0.002, 0.068); },

  // jump: sine 200Hz → 500Hz slide up 150ms
  jump() { playOsc("sine", 200, 0.7, 0.005, 0.145, 500); },

  // slide: sawtooth 150Hz → 200Hz, 200ms
  slide() { playOsc("sawtooth", 150, 0.5, 0.003, 0.197, 200); },

  // match: 3 sine notes ascending (C, E, G) 60ms each
  match() { playArpeggio("sine", [523, 659, 784], 0.06, 0.6); },

  // flip: square 1100Hz, 40ms
  flip() { playOsc("square", 1100, 0.5, 0.001, 0.039); },

  // win: arpeggio 4 notes ascending (C, E, G, C+1) 80ms each, total 320ms
  win() { playArpeggio("sine", [523, 659, 784, 1047], 0.08, 0.7); },

  // lose: sine 440Hz → 220Hz glide down 400ms
  lose() { playOsc("sine", 440, 0.65, 0.01, 0.39, 220); },

  // gameover: 3 notes descending minor (A, F, D) 150ms each
  gameover() { playArpeggio("sine", [440, 349, 294], 0.15, 0.65); },

  // levelup: arpeggio 5 notes (C D E G C+1) 60ms each
  levelup() { playArpeggio("sine", [523, 587, 659, 784, 1047], 0.06, 0.65); },

  // click: tick breve 1000Hz 20ms
  click() { playOsc("square", 1000, 0.4, 0.001, 0.019); },

  // error: square 200Hz 100ms buzz
  error() { playOsc("square", 200, 0.55, 0.002, 0.098); },

  // countdown: sine 600Hz 80ms (per tick)
  countdown() { playOsc("sine", 600, 0.65, 0.005, 0.075); },

  // go: sine 800Hz 200ms (loud start signal)
  go() { playOsc("sine", 800, 0.85, 0.008, 0.192); },
};

// ---------- mute persistence ----------

async function loadMuteState(): Promise<void> {
  if (muteLoaded) return;
  muteLoaded = true;
  try {
    const row = await db.settings.get(SETTINGS_KEY);
    if (row) {
      muted = row.value === "1";
    }
  } catch { /* non-critical */ }
}

async function saveMuteState(): Promise<void> {
  try {
    await db.settings.put({ key: SETTINGS_KEY, value: muted ? "1" : "0" });
  } catch { /* non-critical */ }
}

// ---------- public API ----------

export function isMuted(): boolean {
  return muted;
}

export async function toggleMute(): Promise<void> {
  // Ensure mute state is loaded before first toggle
  if (!muteLoaded) await loadMuteState();
  muted = !muted;
  await saveMuteState();
  for (const cb of muteSubscribers) cb(muted);
}

export function subscribeMute(cb: (m: boolean) => void): () => void {
  muteSubscribers.add(cb);
  return () => { muteSubscribers.delete(cb); };
}

export function playSfx(name: SfxName): void {
  if (muted) return;
  if (activeVoices >= MAX_VOICES) return;

  const now = performance.now();
  const last = lastPlayTime.get(name) ?? 0;
  if (now - last < DEBOUNCE_MS) return;
  lastPlayTime.set(name, now);

  try {
    SFX_IMPL[name]();
  } catch {
    // AudioContext may not be available (e.g. test environment) — silently skip
  }
}

// Load mute state eagerly (non-blocking) so first playSfx has correct state
void loadMuteState();
