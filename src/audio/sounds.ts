/**
 * Sound definitions (16 sections B2, B3 and the loudness-by-Age table). Every sound is a short
 * recipe of oscillator and noise layers that src/audio/synth.ts renders to PCM, so there are no
 * sample files and no third-party assets. The recipes cover a representative subset of the B2
 * categories; the rest of the 660-file brief is recorded in src/audio/README.md.
 *
 * Priority, cooldown, instance cap and spatial flag come from the class table in B3. A sound
 * inherits its class defaults and overrides only what it needs.
 */
import type { Priority } from './model.ts';

export type Wave = 'sine' | 'triangle' | 'square' | 'saw';
export type StealPolicy = 'oldest' | 'quietest' | 'none';

/** A pitched layer; frequency glides linearly from `from` to `to` over the layer's length. */
export interface ToneLayer {
  kind: 'tone';
  wave: Wave;
  from: number;
  to: number;
  /** Start offset in seconds. */
  at: number;
  gain: number;
  /** Attack in seconds (0 means instant). */
  attack: number;
  /** Decay time constant in seconds (0 means no decay). */
  decay: number;
}

/** A noise layer through one biquad filter, optionally amplitude-modulated by a slow LFO. */
export interface NoiseLayer {
  kind: 'noise';
  filter: 'lowpass' | 'bandpass' | 'highpass';
  freq: number;
  q: number;
  gain: number;
  attack: number;
  decay: number;
  /** LFO rate in Hz (0 for none). Loops round it to whole cycles per loop. */
  lfoHz: number;
  /** LFO depth 0..1. */
  lfoDepth: number;
}

export type Layer = ToneLayer | NoiseLayer;

export interface SoundDef {
  id: string;
  category: string;
  priority: Priority;
  /** Minimum gap between two starts of this sound. */
  cooldownMs: number;
  /** Most copies of this sound playing at once. */
  maxInstances: number;
  stealPolicy: StealPolicy;
  /** Positioned in the world (pan and distance) rather than played flat. */
  spatial: boolean;
  /** Music ducking in dB for priority 0-1 sounds (B5); 0 means no ducking. */
  ducksMusicDb: number;
  /** Seamless loop (ambience beds). Loops render with whole cycles so the seam is continuous. */
  loop: boolean;
  durationMs: number;
  /** Level trim in dB, zero or negative. */
  gainDb: number;
  layers: readonly Layer[];
}

/** Class defaults from 16 section B3. */
interface ClassDefaults {
  priority: Priority;
  cooldownMs: number;
  maxInstances: number;
  stealPolicy: StealPolicy;
  spatial: boolean;
  loop: boolean;
}

export const CLASS_DEFAULTS: Readonly<Record<string, ClassDefaults>> = {
  ui: { priority: 0, cooldownMs: 30, maxInstances: 6, stealPolicy: 'oldest', spatial: false, loop: false },
  stingers: { priority: 0, cooldownMs: 1000, maxInstances: 2, stealPolicy: 'oldest', spatial: false, loop: false },
  calamity: { priority: 1, cooldownMs: 150, maxInstances: 4, stealPolicy: 'quietest', spatial: true, loop: false },
  combat: { priority: 2, cooldownMs: 60, maxInstances: 8, stealPolicy: 'quietest', spatial: true, loop: false },
  voices: { priority: 3, cooldownMs: 120, maxInstances: 6, stealPolicy: 'quietest', spatial: true, loop: false },
  work: { priority: 3, cooldownMs: 250, maxInstances: 6, stealPolicy: 'quietest', spatial: true, loop: false },
  ambience: { priority: 4, cooldownMs: 0, maxInstances: 1, stealPolicy: 'none', spatial: true, loop: true },
};

const tone = (wave: Wave, from: number, to: number, gain: number, attack: number, decay: number, at = 0): ToneLayer => ({
  kind: 'tone',
  wave,
  from,
  to,
  at,
  gain,
  attack,
  decay,
});

const noise = (
  filter: NoiseLayer['filter'],
  freq: number,
  q: number,
  gain: number,
  attack: number,
  decay: number,
  lfoHz = 0,
  lfoDepth = 0,
): NoiseLayer => ({ kind: 'noise', filter, freq, q, gain, attack, decay, lfoHz, lfoDepth });

interface Options {
  ducksMusicDb?: number;
  gainDb?: number;
  priority?: Priority;
  cooldownMs?: number;
  maxInstances?: number;
  spatial?: boolean;
}

/** Builds a one-shot from its category defaults and per-sound overrides. */
function shot(id: string, category: string, durationMs: number, layers: Layer[], opts: Options = {}): SoundDef {
  const base = CLASS_DEFAULTS[category];
  if (!base) throw new Error(`sounds: unknown category ${category} for ${id}`);
  return {
    id,
    category,
    priority: opts.priority ?? base.priority,
    cooldownMs: opts.cooldownMs ?? base.cooldownMs,
    maxInstances: opts.maxInstances ?? base.maxInstances,
    stealPolicy: base.stealPolicy,
    spatial: opts.spatial ?? base.spatial,
    ducksMusicDb: opts.ducksMusicDb ?? 0,
    loop: false,
    durationMs,
    gainDb: opts.gainDb ?? 0,
    layers,
  };
}

/** Builds a seamless bed. Frequencies and LFO rates are rounded to whole cycles at render time. */
function bed(id: string, durationMs: number, layers: Layer[], gainDb = -6): SoundDef {
  const base = CLASS_DEFAULTS['ambience'];
  if (!base) throw new Error('sounds: ambience class missing');
  return { id, category: 'ambience', priority: base.priority, cooldownMs: 0, maxInstances: 1, stealPolicy: 'none', spatial: true, ducksMusicDb: 0, loop: true, durationMs, gainDb, layers };
}

export const SOUNDS: readonly SoundDef[] = [
  // UI (16 section B2 UI, priority 0, 30 ms cooldown, 6 at once)
  shot('ui_click', 'ui', 40, [tone('square', 880, 660, 0.25, 0, 0.012)]),
  shot('ui_toggle_on', 'ui', 110, [tone('triangle', 660, 990, 0.3, 0.005, 0.04)]),
  shot('ui_toggle_off', 'ui', 110, [tone('triangle', 990, 660, 0.3, 0.005, 0.04)]),
  shot('ui_tab', 'ui', 70, [noise('bandpass', 2400, 4, 0.4, 0.002, 0.02)]),
  shot('ui_window_open', 'ui', 220, [noise('bandpass', 900, 0.8, 0.35, 0.05, 0.08), tone('sine', 300, 600, 0.2, 0.04, 0.09)]),
  shot('ui_window_close', 'ui', 180, [noise('bandpass', 1400, 0.8, 0.3, 0.02, 0.07), tone('sine', 600, 300, 0.18, 0.01, 0.08)]),
  shot('ui_error', 'ui', 260, [tone('square', 220, 180, 0.22, 0.005, 0.09)]),
  shot('ui_confirm', 'ui', 150, [tone('sine', 523, 784, 0.3, 0.005, 0.05)]),
  shot('ui_slider_tick', 'ui', 25, [tone('sine', 1200, 1200, 0.2, 0, 0.006)]),
  shot('ui_power_select', 'ui', 120, [tone('triangle', 740, 1110, 0.25, 0.004, 0.035)]),
  shot('ui_unlock_chime', 'ui', 900, [tone('triangle', 660, 1320, 0.3, 0.004, 0.35), tone('sine', 990, 1980, 0.12, 0.01, 0.3, 0.08)], { cooldownMs: 0 }),
  shot('ui_toast', 'ui', 140, [tone('sine', 880, 880, 0.22, 0.01, 0.05)]),
  shot('ui_save', 'ui', 200, [tone('triangle', 440, 660, 0.25, 0.01, 0.07)]),
  shot('ui_load', 'ui', 200, [tone('triangle', 660, 440, 0.25, 0.01, 0.07)]),
  shot('ui_countdown', 'ui', 40, [tone('sine', 1000, 1000, 0.25, 0, 0.012)]),

  // Stingers (priority 0, 1000 ms gap, 2 at once; they duck the music, B5)
  shot('stg_age_change', 'stingers', 2400, [tone('triangle', 392, 523, 0.35, 0.05, 1.2), tone('sine', 262, 330, 0.3, 0.2, 1.8, 0.3)], { ducksMusicDb: 5 }),
  shot('stg_war_declared', 'stingers', 1600, [tone('square', 196, 147, 0.2, 0.02, 0.9), noise('lowpass', 500, 0.7, 0.15, 0.05, 0.6)], { ducksMusicDb: 4 }),
  shot('stg_peace', 'stingers', 1600, [tone('triangle', 523, 784, 0.3, 0.1, 0.9)], { ducksMusicDb: 3 }),
  shot('stg_pact_formed', 'stingers', 1200, [tone('sine', 440, 554, 0.3, 0.04, 0.7), tone('sine', 660, 660, 0.15, 0.2, 0.6, 0.15)], { ducksMusicDb: 3 }),
  shot('stg_ruler_crowned', 'stingers', 1500, [tone('triangle', 659, 988, 0.3, 0.02, 0.9)], { ducksMusicDb: 3 }),
  shot('stg_dominion_fallen', 'stingers', 1800, [tone('sine', 330, 165, 0.3, 0.02, 1.3), noise('lowpass', 300, 0.5, 0.12, 0.1, 1.0)], { ducksMusicDb: 4 }),
  shot('stg_calamity_warning', 'stingers', 1200, [tone('square', 740, 740, 0.14, 0.2, 0.5)], { ducksMusicDb: 4 }),
  shot('stg_achievement', 'stingers', 1400, [tone('triangle', 880, 1760, 0.3, 0.01, 0.5), noise('highpass', 8000, 0.7, 0.05, 0.01, 0.2)], { ducksMusicDb: 2 }),

  // Calamities and explosions (priority 1, 150 ms gap, 4 at once, spatial)
  shot('cal_storm_peak', 'calamity', 1600, [noise('lowpass', 1200, 0.7, 0.5, 0.2, 0.9, 0.5, 0.4)], { ducksMusicDb: 5 }),
  shot('cal_quake', 'calamity', 1800, [noise('lowpass', 180, 0.6, 0.6, 0.3, 0.8), tone('sine', 80, 70, 0.3, 0.2, 1.0)], { ducksMusicDb: 5 }),
  shot('cal_meteor_whistle', 'calamity', 1100, [tone('sine', 1600, 300, 0.25, 0.1, 0.7)]),
  shot('cal_impact', 'calamity', 700, [noise('lowpass', 900, 0.5, 0.8, 0.002, 0.25), tone('sine', 120, 50, 0.4, 0.001, 0.2)], { ducksMusicDb: 5 }),
  shot('cal_skyfall', 'calamity', 900, [tone('triangle', 1200, 400, 0.25, 0.02, 0.5), noise('bandpass', 2000, 2, 0.2, 0.05, 0.4)]),
  shot('cal_whirlwind', 'calamity', 2000, [noise('bandpass', 900, 2, 0.4, 0.2, 1.2, 0.25, 0.5)]),
  shot('cal_tremor', 'calamity', 1200, [noise('lowpass', 250, 0.6, 0.5, 0.1, 0.9, 1, 0.6)]),
  shot('cal_heat_spell', 'calamity', 1000, [tone('triangle', 300, 500, 0.2, 0.2, 0.6), noise('bandpass', 1500, 1, 0.1, 0.3, 0.6)]),
  shot('exp_small', 'calamity', 300, [noise('lowpass', 2000, 0.6, 0.6, 0.001, 0.12)], { priority: 2 }),
  shot('exp_medium', 'calamity', 600, [noise('lowpass', 1200, 0.6, 0.7, 0.002, 0.2), tone('sine', 90, 60, 0.3, 0.002, 0.2)]),
  shot('exp_large', 'calamity', 1200, [noise('lowpass', 700, 0.6, 0.8, 0.003, 0.45), tone('sine', 70, 40, 0.4, 0.003, 0.4)], { ducksMusicDb: 5 }),

  // Combat (priority 2, 60 ms gap per kind, 8 at once)
  shot('cmb_hit_blade', 'combat', 150, [noise('bandpass', 3000, 3, 0.35, 0.001, 0.05), tone('triangle', 800, 400, 0.2, 0.001, 0.04)]),
  shot('cmb_hit_blunt', 'combat', 200, [noise('lowpass', 500, 0.7, 0.5, 0.001, 0.09), tone('sine', 180, 90, 0.3, 0.001, 0.08)]),
  shot('cmb_block', 'combat', 100, [tone('sine', 1500, 1500, 0.25, 0.001, 0.03)]),
  shot('cmb_arrow', 'combat', 80, [noise('highpass', 4000, 0.7, 0.3, 0.001, 0.03)]),

  // Voices (priority 3, 120 ms gap, 6 at once); synthesised stand-ins until recordings exist
  shot('vox_spawn_folk', 'voices', 320, [tone('sine', 440, 880, 0.3, 0.02, 0.2), tone('triangle', 660, 660, 0.12, 0.05, 0.2, 0.05)]),
  shot('vox_spawn_beast', 'voices', 300, [tone('triangle', 220, 330, 0.3, 0.01, 0.15)]),
  shot('vox_hurt', 'voices', 130, [tone('square', 350, 250, 0.12, 0.005, 0.05)]),

  // Work and structures (priority 3, 250 ms gap per source, 6 at once)
  shot('work_chop', 'work', 120, [noise('bandpass', 1800, 5, 0.5, 0.001, 0.03)]),
  shot('work_mine', 'work', 120, [tone('sine', 900, 700, 0.3, 0.001, 0.03), noise('highpass', 2500, 1, 0.2, 0.001, 0.02)]),
  shot('work_hammer', 'work', 140, [tone('triangle', 1200, 1100, 0.3, 0.001, 0.04), noise('bandpass', 2600, 4, 0.2, 0.001, 0.03)]),
  shot('work_place_structure', 'work', 260, [noise('lowpass', 600, 0.6, 0.4, 0.005, 0.12), tone('sine', 300, 400, 0.2, 0.01, 0.12)]),
  shot('work_structure_destroyed', 'work', 700, [noise('lowpass', 500, 0.6, 0.6, 0.002, 0.3)]),

  // Ambience beds (loops; priority 4; 6 beds at most, 5 desktop; see B3 and B4)
  bed('amb_wind_low', 8000, [noise('lowpass', 500, 0.7, 0.6, 0, 0, 1, 0.5)]),
  bed('amb_wind_high', 8000, [noise('bandpass', 1800, 0.8, 0.35, 0, 0, 1, 0.6)]),
  bed('amb_surf', 8000, [noise('lowpass', 900, 0.7, 0.6, 0, 0, 1, 0.8)]),
  bed('amb_rain_light', 8000, [noise('highpass', 3000, 0.7, 0.25, 0, 0, 4, 0.2)]),
  bed('amb_rain_heavy', 8000, [noise('bandpass', 2200, 0.6, 0.5, 0, 0)]),
  bed('amb_insects', 8000, [noise('bandpass', 4500, 8, 0.25, 0, 0, 4, 0.7), tone('sine', 3000, 3000, 0.02, 0, 0)]),
  bed('amb_cave_drone', 8000, [tone('sine', 110, 110, 0.2, 0, 0), tone('sine', 165, 165, 0.12, 0, 0)], -10),
  bed('amb_lava_bubble', 8000, [noise('lowpass', 300, 0.9, 0.5, 0, 0, 1, 0.9)]),
  bed('amb_crickets', 8000, [tone('sine', 4200, 4200, 0.04, 0, 0), noise('bandpass', 4200, 10, 0.12, 0, 0, 6, 0.8)]),
  bed('amb_town_murmur', 8000, [noise('bandpass', 700, 1.2, 0.5, 0, 0, 1, 0.4)]),
];

export const SOUND_BY_ID: ReadonlyMap<string, SoundDef> = new Map(SOUNDS.map((s) => [s.id, s]));

/**
 * Whether a sound may start now (16 section B3): the per-sound cooldown has passed and fewer than
 * `maxInstances` copies are playing. Pure: the engine supplies the timing and the live count.
 */
export function canStart(def: SoundDef, lastStartMs: number | undefined, playing: number, nowMs: number): boolean {
  if (playing >= def.maxInstances) return false;
  if (lastStartMs !== undefined && nowMs - lastStartMs < def.cooldownMs) return false;
  return true;
}

/**
 * Loudness character by Age (16, "Audio loudness by Age"): bright Ages sit at the reference
 * level, gloomy Ages 6 dB below, desolate Ages 12 dB below. Values are TUNE; the bed crossfades
 * over 4 seconds when the Age changes.
 */
export const AGE_BED_LEVEL_DB: Readonly<Record<string, number>> = {
  dawn: 0,
  scorch: 0,
  silver_moon: 0,
  marvels: 0,
  long_night: -6,
  weeping: -6,
  discord: -6,
  gloom: -6,
  veiled: -6,
  frostbound: -12,
  cinder: -12,
};

/** Level of the bed for an Age in dB; unknown Ages use the reference level. */
export function ageBedLevelDb(ageId: string): number {
  return AGE_BED_LEVEL_DB[ageId] ?? 0;
}
