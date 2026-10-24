/**
 * Mixing maths from 16 sections B4 and B5, as pure functions: decibel conversion, stereo pan and
 * distance gain for positional sounds, one-pole smoothing for gain changes, and the music ducking
 * envelope. The engine calls these; nothing here touches WebAudio.
 */
import type { SpatialIntensity } from './options.ts';
import { spatialScale } from './options.ts';

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Stereo pan for a source at `sourceX` seen from the screen centre `centreX`, in tiles (B4):
 * clamp((sx - cx) / (halfView * 1.2), -1, 1) * 0.8, scaled by the spatial intensity option.
 */
export function panFor(sourceX: number, centreX: number, halfViewTiles: number, intensity: SpatialIntensity = 'normal'): number {
  if (halfViewTiles <= 0) return 0;
  const raw = clamp((sourceX - centreX) / (halfViewTiles * 1.2), -1, 1) * 0.8;
  return clamp(raw * spatialScale(intensity), -1, 1);
}

/** Distance scale d0 in tiles: 8 when zoomed in, 40 when zoomed out, interpolated by zoom 0..1 (B4). */
export function distanceScale(zoom01: number): number {
  const z = clamp(zoom01, 0, 1);
  return 40 + (8 - 40) * z;
}

/** Gain for a source `d` tiles from the centre: 1 / (1 + (d / d0)^2) (B4). */
export function distanceGain(d: number, d0: number): number {
  if (d0 <= 0) return 0;
  return 1 / (1 + (d / d0) * (d / d0));
}

/**
 * One-pole smoothing toward `target` over `dtSeconds`. The time constant is `attack` when the
 * value rises and `release` when it falls (B8 mixing rule 3). A zero constant jumps to the target.
 */
export function smoothGain(current: number, target: number, dtSeconds: number, attack: number, release: number): number {
  const tau = target > current ? attack : release;
  if (tau <= 0) return target;
  const k = 1 - Math.exp(-dtSeconds / tau);
  return current + (target - current) * k;
}

/**
 * Music ducking offset in dB for a priority 0-1 sound flagged with `depthDb` (B5): ramps down over
 * `downMs`, holds for `holdMs`, then ramps back over `upMs`. Returns 0 before and after the event.
 */
export function duckEnvelopeDb(elapsedMs: number, depthDb: number, downMs = 80, holdMs = 0, upMs = 600): number {
  if (depthDb <= 0 || elapsedMs < 0) return 0;
  // Written as 0 minus the depth so a zero result is +0, not -0.
  if (elapsedMs < downMs) return 0 - depthDb * (elapsedMs / downMs);
  const holdEnd = downMs + holdMs;
  if (elapsedMs < holdEnd) return 0 - depthDb;
  const t = elapsedMs - holdEnd;
  if (t < upMs) return 0 - depthDb * (1 - t / upMs);
  return 0;
}
