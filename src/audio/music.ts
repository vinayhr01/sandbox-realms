/**
 * Adaptive music, pure half (16 section B8): the stem table, the gain rules that map a MusicState to
 * stem targets, the layer cap, the smoothing constants, the bar and step grid and the cosmetic
 * variant choice. Nothing here touches WebAudio or the sim. engine.ts turns these numbers into
 * oscillator and noise patterns.
 *
 * The stems are synthesised, not sampled: each stem is a drone (sustained oscillators) or a step
 * pattern (plucks, bells, pulses, noise hits) on a fixed eighth-note grid at 96 BPM in D Dorian.
 */

export const MUSIC_BPM = 96;
export const BEATS_PER_BAR = 4;
export const BARS_PER_LOOP = 8;
export const STEPS_PER_BAR = 8;
export const STEPS_PER_LOOP = BARS_PER_LOOP * STEPS_PER_BAR;
export const BEAT_SECONDS = 60 / MUSIC_BPM;
export const STEP_SECONDS = BEAT_SECONDS / 2;
export const BAR_SECONDS = BEAT_SECONDS * BEATS_PER_BAR;
export const LOOP_SECONDS = BAR_SECONDS * BARS_PER_LOOP;

/** Layers audible at once (B8 rule 2). */
export const LAYER_CAP_PHONE = 6;
export const LAYER_CAP_DESKTOP = 9;

/** Stems below this gain for this long are stopped and released (B8 rule 3). */
export const STOP_BELOW_GAIN = 0.02;
export const STOP_AFTER_MS = 8_000;

/** One-pole time constants in seconds (B8 rule 3). */
export const ATTACK_S = 2.0;
export const RELEASE_S = 4.0;
export const WAR_ATTACK_S = 1.0;
export const WAR_RELEASE_S = 6.0;

/** Overview view pushes biome and mood layers down by 30 % (B8 rule 5). */
export const OVERVIEW_MOOD_SCALE = 0.7;

/** The ten Ages that have an instrument-colour stem (16 B8). Veiled is a slot, not an Age. */
export const AGE_IDS = [
  'dawn',
  'scorch',
  'long_night',
  'weeping',
  'silver_moon',
  'discord',
  'marvels',
  'frostbound',
  'cinder',
  'gloom',
] as const;
export type AgeStemId = (typeof AGE_IDS)[number];

export const BIOME_FAMILIES = ['temperate', 'arid', 'cold', 'wet', 'volcanic', 'coast', 'magical'] as const;
export type BiomeFamily = (typeof BIOME_FAMILIES)[number];

export const MOOD_KEYS = ['calm', 'tension', 'war', 'grief', 'prosperity', 'wonder'] as const;
export type MoodKey = (typeof MOOD_KEYS)[number];

export const LINEAGE_MOTIF_COUNT = 6;

/** The state the director reads (B8 MusicState). Published about once a second, never more often. */
export interface MusicState {
  ageId: string | null;
  biomeShare: Record<BiomeFamily, number>;
  dominantLineage: string | null;
  mood: Record<MoodKey, number>;
  /** 0 (most zoomed out) .. 1 (most zoomed in). */
  zoom: number;
  isOverview: boolean;
  paused: boolean;
  calamityActive: boolean;
  /** 0..1 */
  night: number;
}

export function silentMusicState(): MusicState {
  return {
    ageId: null,
    biomeShare: { temperate: 0, arid: 0, cold: 0, wet: 0, volcanic: 0, coast: 0, magical: 0 },
    dominantLineage: null,
    mood: { calm: 0, tension: 0, war: 0, grief: 0, prosperity: 0, wonder: 0 },
    zoom: 0,
    isOverview: false,
    paused: false,
    calamityActive: false,
    night: 0,
  };
}

export type StemGroup = 'bed' | 'age' | 'biome' | 'mood' | 'lineage';
export type StemKind = 'drone' | 'pluck' | 'bell' | 'pulse' | 'noise';
export type StemWave = 'sine' | 'triangle' | 'sawtooth' | 'square';

export interface StemDef {
  id: string;
  group: StemGroup;
  kind: StemKind;
  wave: StemWave;
  /** Octaves from D3 (146.83 Hz). */
  octave: number;
  /** Drones: scale degrees held for the whole loop. */
  chord: readonly number[];
  /** Pattern stems: one scale degree per eighth note in a bar (-1 = rest). Empty for drones. */
  steps: readonly number[];
  /** Target gain 0..1 from the state (B8 gain rules). */
  gain: (s: MusicState) => number;
  /** Higher survives the layer cap. */
  priority: number;
  /**
   * Drones only: the B variant the engine alternates with the main voicing at loop boundaries
   * (B8: Bed A/B). Absent for every other stem.
   */
  alt?: { wave: StemWave; octave: number; chord: readonly number[] };
}

/** D Dorian (B8): semitone offsets of degrees 0..6 from the root. */
const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const;
const D3_HZ = 146.83;

/** Frequency of a scale degree (degrees past 6 wrap into higher octaves). */
export function degreeHz(degree: number, octave: number): number {
  const oct = Math.floor(degree / 7);
  const semis = DORIAN[((degree % 7) + 7) % 7] ?? 0;
  return D3_HZ * Math.pow(2, (semis + 12 * (octave + oct)) / 12);
}

/** How one stem sounds: kind, wave, octave, chord and pattern. */
interface Voicing {
  kind: StemKind;
  wave: StemWave;
  octave: number;
  chord: readonly number[];
  steps: readonly number[];
}

/** Per-age colour: each Age is an instrument layer (a mood brief, not a fixed instrument). */
const AGE_VOICING: Readonly<Record<AgeStemId, Voicing>> = {
  dawn: { kind: 'pluck', wave: 'triangle', octave: 0, chord: [0], steps: [0, -1, 2, -1, 4, -1, 2, -1] },
  scorch: { kind: 'drone', wave: 'sawtooth', octave: -1, chord: [0, 4], steps: [] },
  long_night: { kind: 'drone', wave: 'sine', octave: -1, chord: [0, 2], steps: [] },
  weeping: { kind: 'pluck', wave: 'sine', octave: -1, chord: [0], steps: [0, -1, -1, -1, 6, -1, -1, -1] },
  silver_moon: { kind: 'bell', wave: 'sine', octave: 1, chord: [0], steps: [4, -1, -1, 6, -1, 4, -1, -1] },
  discord: { kind: 'pulse', wave: 'square', octave: 0, chord: [0], steps: [0, 1, -1, 5, 0, 1, -1, 3] },
  marvels: { kind: 'bell', wave: 'triangle', octave: 2, chord: [0], steps: [2, -1, 4, -1, 6, -1, 4, -1] },
  frostbound: { kind: 'drone', wave: 'sine', octave: 1, chord: [0, 4], steps: [] },
  cinder: { kind: 'noise', wave: 'sawtooth', octave: 0, chord: [0], steps: [1, -1, -1, -1, 1, -1, -1, -1] },
  gloom: { kind: 'drone', wave: 'triangle', octave: -2, chord: [0], steps: [] },
};

const BIOME_VOICING: Readonly<Record<BiomeFamily, Voicing>> = {
  temperate: { kind: 'drone', wave: 'triangle', octave: -1, chord: [0, 4], steps: [] },
  arid: { kind: 'drone', wave: 'sawtooth', octave: -1, chord: [0, 1], steps: [] },
  cold: { kind: 'drone', wave: 'sine', octave: 1, chord: [0, 4], steps: [] },
  wet: { kind: 'pulse', wave: 'triangle', octave: 0, chord: [0], steps: [0, -1, 2, -1, 0, -1, 4, -1] },
  volcanic: { kind: 'drone', wave: 'sawtooth', octave: -2, chord: [0], steps: [] },
  coast: { kind: 'pluck', wave: 'sine', octave: 0, chord: [0], steps: [4, -1, 2, -1, 0, -1, 2, -1] },
  magical: { kind: 'bell', wave: 'sine', octave: 2, chord: [0], steps: [6, -1, -1, 4, -1, -1, 2, -1] },
};

/** The 2-bar lineage motif shape, rotated per motif index (B8: six motifs). */
const MOTIF_BASE = [0, 2, 4, 2, -1, 4, 5, -1] as const;

function rotated(values: readonly number[], by: number): number[] {
  return values.map((_, i) => values[(i + by) % values.length] ?? -1);
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Biome gain rule (B8 rule 1): the top family needs at least 12 % of the view and a 3-point lead
 * over the next; the second family plays only above 25 %. Other families are silent.
 */
export function biomeGains(shares: Record<BiomeFamily, number>): Record<BiomeFamily, number> {
  const out = Object.fromEntries(BIOME_FAMILIES.map((b) => [b, 0])) as Record<BiomeFamily, number>;
  const ranked = [...BIOME_FAMILIES].sort((a, b) => shares[b] - shares[a] || a.localeCompare(b));
  const top = ranked[0];
  const second = ranked[1];
  if (top !== undefined && second !== undefined) {
    if (shares[top] >= 0.12 && shares[top] - shares[second] >= 0.03) out[top] = 0.7;
    if (shares[second] > 0.25) out[second] = 0.45;
  }
  return out;
}

/** The motif index for a lineage id: the same id always gives the same motif. */
export function motifIndexFor(lineageId: string): number {
  let h = 2166136261;
  for (let i = 0; i < lineageId.length; i++) {
    h ^= lineageId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % LINEAGE_MOTIF_COUNT;
}

function buildStems(): StemDef[] {
  const stems: StemDef[] = [];
  // The bed has A and B voicings; the engine alternates them at loop boundaries (see bedVariantFor).
  const bedA: StemDef = {
    id: 'bed_a',
    group: 'bed',
    kind: 'drone',
    wave: 'sine',
    octave: -2,
    chord: [0, 4],
    steps: [],
    gain: () => 1,
    priority: 100,
    alt: { wave: 'triangle', octave: -1, chord: [0, 4] },
  };
  stems.push(bedA);
  for (const id of AGE_IDS) {
    stems.push({ id: `age_${id}`, group: 'age', ...AGE_VOICING[id], gain: (s) => (s.ageId === id ? 0.9 : 0), priority: 90 });
  }
  for (const b of BIOME_FAMILIES) {
    stems.push({ id: `biome_${b}`, group: 'biome', ...BIOME_VOICING[b], gain: (s) => biomeGains(s.biomeShare)[b], priority: 40 });
  }
  const mood: Array<{ id: string; v: Voicing; gain: (s: MusicState) => number }> = [
    { id: 'calm_melody', v: { kind: 'pluck', wave: 'triangle', octave: 1, chord: [0], steps: [0, -1, 2, -1, 3, -1, 2, -1] }, gain: (s) => s.mood.calm * 0.8 },
    { id: 'calm_rhythm', v: { kind: 'noise', wave: 'sine', octave: 0, chord: [0], steps: [0, -1, -1, -1, 0, -1, -1, -1] }, gain: (s) => s.mood.calm * 0.6 * (s.night < 0.5 ? 1 : 0.5) },
    { id: 'tension_pulse', v: { kind: 'pulse', wave: 'square', octave: -1, chord: [0], steps: [0, -1, 0, -1, 0, -1, 0, -1] }, gain: (s) => s.mood.tension * 0.8 },
    { id: 'war_drums', v: { kind: 'noise', wave: 'sine', octave: -1, chord: [0], steps: [0, -1, -1, -1, 0, -1, 0, -1] }, gain: (s) => s.mood.war * 0.9 },
    { id: 'war_brass', v: { kind: 'drone', wave: 'sawtooth', octave: 0, chord: [0, 4], steps: [] }, gain: (s) => Math.pow(s.mood.war, 1.5) * 0.8 },
    { id: 'grief_strings', v: { kind: 'drone', wave: 'sine', octave: -2, chord: [0, 3], steps: [] }, gain: (s) => s.mood.grief * 0.8 },
    { id: 'prosperity_lift', v: { kind: 'pluck', wave: 'triangle', octave: 1, chord: [0], steps: [0, 2, 4, 2, 0, 2, 4, 6] }, gain: (s) => s.mood.prosperity * 0.6 },
    { id: 'wonder_sparkle', v: { kind: 'bell', wave: 'sine', octave: 2, chord: [0], steps: [6, -1, -1, 4, -1, -1, 2, -1] }, gain: (s) => s.mood.wonder * 0.6 },
  ];
  for (const m of mood) {
    stems.push({ id: `mood_${m.id}`, group: 'mood', ...m.v, gain: (s) => clamp01(m.gain(s)), priority: 60 });
  }
  for (let k = 0; k < LINEAGE_MOTIF_COUNT; k++) {
    stems.push({
      id: `lineage_${k}`,
      group: 'lineage',
      kind: 'pluck',
      wave: 'triangle',
      octave: 1,
      chord: [0],
      steps: rotated(MOTIF_BASE, k),
      gain: (s) => (s.dominantLineage !== null && motifIndexFor(s.dominantLineage) === k ? 0.5 : 0),
      priority: 30,
    });
  }
  return stems;
}

/** Every stem in the piece: 2 bed, 10 age, 7 biome, 8 mood, 6 lineage (16 B8). */
export const STEM_DEFS: readonly StemDef[] = buildStems();
export const STEM_BY_ID: ReadonlyMap<string, StemDef> = new Map(STEM_DEFS.map((d) => [d.id, d]));

/** Target gain for every stem. Overview scales biome and mood layers down (B8 rule 5). */
export function stemTargets(state: MusicState, defs: readonly StemDef[] = STEM_DEFS): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of defs) {
    let g = clamp01(def.gain(state));
    if (state.isOverview && (def.group === 'biome' || def.group === 'mood')) g *= OVERVIEW_MOOD_SCALE;
    out[def.id] = g;
  }
  return out;
}

/**
 * Drops the quietest optional layers until at most `max` are audible (B8 rule 2). The bed and the
 * age layer are never dropped. Ties drop the lower priority first.
 */
export function capLayers(targets: Record<string, number>, defs: readonly StemDef[], max: number): Record<string, number> {
  const out = { ...targets };
  const audible = defs.filter((d) => (out[d.id] ?? 0) > 0);
  if (audible.length <= max) return out;
  const droppable = audible
    .filter((d) => d.group !== 'bed' && d.group !== 'age')
    .sort((a, b) => (out[a.id] ?? 0) - (out[b.id] ?? 0) || a.priority - b.priority || a.id.localeCompare(b.id));
  let count = audible.length;
  for (const d of droppable) {
    if (count <= max) break;
    out[d.id] = 0;
    count--;
  }
  return out;
}

/** Smoothing constant for one stem: war layers attack fast and release slowly (B8 rule 3). */
export function stemTau(def: StemDef, rising: boolean): number {
  const war = def.id === 'mood_war_drums' || def.id === 'mood_war_brass';
  if (rising) return war ? WAR_ATTACK_S : ATTACK_S;
  return war ? WAR_RELEASE_S : RELEASE_S;
}

/** Tracks how long a stem has been below the stop threshold. Returns when the silence began, or null. */
export function silenceSince(since: number | null, gain: number, nowMs: number): number | null {
  if (gain >= STOP_BELOW_GAIN) return null;
  return since ?? nowMs;
}

export function shouldStop(since: number | null, nowMs: number): boolean {
  return since !== null && nowMs - since >= STOP_AFTER_MS;
}

/** Start time, in seconds, of a grid step counted from the music origin. */
export function stepTime(originSec: number, step: number): number {
  return originSec + step * STEP_SECONDS;
}

/** The first grid step at or after `nowSec`. */
export function stepAtOrAfter(originSec: number, nowSec: number): number {
  return Math.max(0, Math.ceil((nowSec - originSec) / STEP_SECONDS - 1e-9));
}

/** The first bar boundary (a multiple of STEPS_PER_BAR) at or after `nowSec`. New stems join here (B8 rule 4). */
export function barStepAtOrAfter(originSec: number, nowSec: number): number {
  return Math.ceil(stepAtOrAfter(originSec, nowSec) / STEPS_PER_BAR) * STEPS_PER_BAR;
}

/** Music bus low-pass cut-offs (B5 and B8 rule 5): open, overview, and paused. */
export const OPEN_CUTOFF_HZ = 20_000;
export const OVERVIEW_CUTOFF_HZ = 6_000;
export const PAUSE_CUTOFF_HZ = 1_200;

/** The music bus cut-off for a state: paused is darkest, then overview, otherwise open. */
export function musicCutoffHz(state: Pick<MusicState, 'paused' | 'isOverview'>): number {
  if (state.paused) return PAUSE_CUTOFF_HZ;
  if (state.isOverview) return OVERVIEW_CUTOFF_HZ;
  return OPEN_CUTOFF_HZ;
}

/** Cosmetic A/B choice (B8): changes at each loop boundary, per stem. Never reads sim state. */
export function variantFor(loopIndex: number, stemId: string): 0 | 1 {
  let h = 2166136261 ^ loopIndex;
  for (let i = 0; i < stemId.length; i++) {
    h ^= stemId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2 === 0 ? 0 : 1;
}

/**
 * The value a pattern stem plays at a grid step: a scale degree, or -1 for a rest. Variant B shifts
 * the pattern by half a bar. Drones have no steps and always return -1.
 */
export function stepValue(def: StemDef, step: number, variant: 0 | 1): number {
  if (def.steps.length === 0) return -1;
  const index = (step + variant * (STEPS_PER_BAR / 2)) % STEPS_PER_BAR;
  return def.steps[index] ?? -1;
}

/** How long one note of a stem rings, in seconds. */
export function noteSeconds(kind: StemKind): number {
  switch (kind) {
    case 'bell':
      return 1.2;
    case 'pluck':
      return 0.6;
    case 'pulse':
      return 0.25;
    case 'noise':
      return 0.2;
    case 'drone':
      return 0;
  }
}
