/**
 * Pure PCM renderer for the sound recipes in sounds.ts. Output is mono Float32 at the requested
 * rate, deterministic for a given definition (noise is seeded from the sound id), and free of
 * WebAudio so it runs under Vitest. The engine copies the result into an AudioBuffer.
 *
 * Loops: frequencies and LFO rates are rounded to whole cycles per loop, and noise filters run
 * twice around the buffer so the state at the seam matches the state at the start.
 */
import { createRng } from '../shared/rng.ts';
import type { Layer, NoiseLayer, SoundDef, ToneLayer } from './sounds.ts';
import { dbToGain } from './mix.ts';

/** Peak level after normalisation, before the definition's trim (leaves headroom for the limiter). */
const PEAK = 0.9;

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Rounds a rate to a whole number of cycles over the loop length (no-op for one-shots). */
function wholeCycles(hz: number, seconds: number, loop: boolean): number {
  if (!loop || hz <= 0) return hz;
  return Math.max(1, Math.round(hz * seconds)) / seconds;
}

function envelope(t: number, attack: number, decay: number): number {
  const a = attack > 0 ? Math.min(1, t / attack) : 1;
  const d = decay > 0 ? Math.exp(-t / decay) : 1;
  return a * d;
}

function waveSample(wave: ToneLayer['wave'], phase: number): number {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'sine':
      return Math.sin(2 * Math.PI * p);
    case 'triangle':
      return 1 - 4 * Math.abs(p - 0.5);
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * p - 1;
  }
}

function renderTone(layer: ToneLayer, out: Float32Array, sr: number, seconds: number, loop: boolean): void {
  const from = wholeCycles(layer.from, seconds, loop);
  const to = wholeCycles(layer.to, seconds, loop);
  const start = Math.round(layer.at * sr);
  const span = out.length - start;
  if (span <= 0) return;
  let phase = 0;
  for (let i = 0; i < span; i++) {
    const t = i / sr;
    const k = span > 1 ? i / (span - 1) : 0;
    const f = from + (to - from) * k;
    const idx = start + i;
    out[idx] = (out[idx] ?? 0) + layer.gain * envelope(t, layer.attack, layer.decay) * waveSample(layer.wave, phase);
    phase += f / sr;
  }
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ audio-EQ-cookbook biquad for the three filter shapes used by the recipes. */
function biquad(kind: NoiseLayer['filter'], freq: number, q: number, sr: number): Biquad {
  const w = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * Math.max(0.05, q));
  const a0 = 1 + alpha;
  let b0: number;
  let b1: number;
  let b2: number;
  if (kind === 'lowpass') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = b0;
  } else if (kind === 'highpass') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = b0;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

function renderNoise(layer: NoiseLayer, out: Float32Array, sr: number, seconds: number, loop: boolean, seed: number): void {
  const n = out.length;
  const rng = createRng(seed);
  const src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = rng.next() * 2 - 1;

  const c = biquad(layer.filter, layer.freq, layer.q, sr);
  const y = new Float32Array(n);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const lap = (write: boolean): void => {
    for (let i = 0; i < n; i++) {
      const x = src[i] ?? 0;
      const yy = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = yy;
      if (write) y[i] = yy;
    }
  };
  // Loops: a silent first lap carries the filter state around, so the second lap starts where the
  // first one ends and the seam is continuous. One-shots run once from silence.
  if (loop) lap(false);
  lap(true);

  const lfo = wholeCycles(layer.lfoHz, seconds, loop);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const mod = layer.lfoDepth > 0 ? 1 - layer.lfoDepth + layer.lfoDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * lfo * t)) : 1;
    out[i] = (out[i] ?? 0) + layer.gain * envelope(t, layer.attack, layer.decay) * mod * (y[i] ?? 0);
  }
}

/**
 * Renders one definition to mono PCM. The length is durationMs at `sampleRate`. The result is
 * normalised to a peak of 0.9 and then trimmed by gainDb, so it is always within -1..1.
 */
export function renderSound(def: SoundDef, sampleRate: number): Float32Array {
  const n = Math.max(1, Math.round((def.durationMs / 1000) * sampleRate));
  const out = new Float32Array(n);
  const seconds = n / sampleRate;
  const seed = hash(def.id);
  def.layers.forEach((layer: Layer, index: number) => {
    if (layer.kind === 'tone') renderTone(layer, out, sampleRate, seconds, def.loop);
    else renderNoise(layer, out, sampleRate, seconds, def.loop, (seed + index * 0x9e3779b9) >>> 0);
  });
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i] ?? 0));
  const scale = (peak > 0 ? PEAK / peak : 0) * dbToGain(def.gainDb);
  for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) * scale;
  return out;
}
