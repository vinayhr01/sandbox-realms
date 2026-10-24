/**
 * Rests (16 section B8 rules 7, 8 and 10): the breathing rests that keep the music from wearing
 * the ear out, and the full rests of the "Occasional" music frequency. Pure: the planner takes the
 * clock and a cosmetic random source, and returns which layers rest now. The Bed never rests
 * during breathing; only a full rest silences it.
 */
import { LOOP_SECONDS, type StemDef } from './music.ts';
import type { MusicFrequency } from './options.ts';

/** Non-Bed layer groups that take a breathing rest, in rotation order (B8 rule 7). */
export const REST_GROUPS = ['mood', 'biome', 'lineage'] as const;
export type RestGroup = (typeof REST_GROUPS)[number];

/** Continuous music before a group rests, and the rest length: 4 minutes, then 1 to 2 minutes. */
export const BREATH_EVERY_MS = 4 * 60_000;
export const BREATH_REST_MIN_MS = 60_000;
export const BREATH_REST_SPAN_MS = 60_000;
/** Every 10 minutes of music, a 25 % chance the Age layer rests for one loop. */
export const AGE_REST_WINDOW_MS = 10 * 60_000;
export const AGE_REST_CHANCE = 0.25;
export const AGE_REST_MS = LOOP_SECONDS * 1000;

/**
 * Full rests by frequency. Occasional follows B8 rule 10 (90 to 180 s rests after 3 to 5 minute
 * passages). Often is a TUNE value of our own (shorter rests); constant never rests fully.
 */
export const FULL_REST_OCCASIONAL = { passageMinMs: 180_000, passageSpanMs: 120_000, restMinMs: 90_000, restSpanMs: 90_000 };
export const FULL_REST_OFTEN = { passageMinMs: 120_000, passageSpanMs: 60_000, restMinMs: 30_000, restSpanMs: 30_000 };

/** A dt above this is a pause in the clock (background tab), not music time. */
const MAX_STEP_MS = 1000;

export interface Rests {
  /** Everything is silent, the Bed included. */
  readonly full: boolean;
  /** The non-Bed group that is resting now, or null. */
  readonly group: RestGroup | null;
  /** The Age layer rests for this loop. */
  readonly age: boolean;
}

export const NO_RESTS: Rests = { full: false, group: null, age: false };

export function sameRests(a: Rests, b: Rests): boolean {
  return a.full === b.full && a.group === b.group && a.age === b.age;
}

/**
 * Clock-driven rests. Call update() on every scheduler tick with the wall clock in ms. Music time
 * counts only while music runs; a rest does not count toward the next one.
 */
export class RestPlanner {
  private lastMs: number | null = null;
  private musicMs = 0;
  private groupIndex = 0;
  private groupRest: { group: RestGroup; untilMs: number } | null = null;
  private windowMs = 0;
  private ageUntilMs = 0;
  private passageMs = 0;
  private passageTargetMs = 0;
  private fullUntilMs = 0;
  private fullFrequency: MusicFrequency | null = null;

  constructor(private readonly rand: () => number = Math.random) {}

  /** Starts a fresh run of music: every counter and rest clears. */
  reset(): void {
    this.lastMs = null;
    this.musicMs = 0;
    this.groupIndex = 0;
    this.groupRest = null;
    this.windowMs = 0;
    this.ageUntilMs = 0;
    this.passageMs = 0;
    this.passageTargetMs = 0;
    this.fullUntilMs = 0;
    this.fullFrequency = null;
  }

  update(nowMs: number, frequency: MusicFrequency): Rests {
    const dt = this.lastMs === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, nowMs - this.lastMs));
    this.lastMs = nowMs;

    if (frequency !== this.fullFrequency) {
      // A new frequency setting starts a new passage.
      this.fullFrequency = frequency;
      this.passageMs = 0;
      this.passageTargetMs = 0;
      this.fullUntilMs = 0;
    }

    if (frequency !== 'constant') {
      if (nowMs < this.fullUntilMs) return { full: true, group: null, age: false };
      const spec = frequency === 'occasional' ? FULL_REST_OCCASIONAL : FULL_REST_OFTEN;
      if (this.passageTargetMs === 0) this.passageTargetMs = spec.passageMinMs + this.rand() * spec.passageSpanMs;
      this.passageMs += dt;
      if (this.passageMs >= this.passageTargetMs) {
        this.fullUntilMs = nowMs + spec.restMinMs + this.rand() * spec.restSpanMs;
        this.passageMs = 0;
        this.passageTargetMs = 0;
        this.musicMs = 0;
        this.groupRest = null;
        return { full: true, group: null, age: false };
      }
    }

    if (this.groupRest && nowMs >= this.groupRest.untilMs) this.groupRest = null;
    if (!this.groupRest) {
      this.musicMs += dt;
      if (this.musicMs >= BREATH_EVERY_MS) {
        this.musicMs = 0;
        const group = REST_GROUPS[this.groupIndex % REST_GROUPS.length] ?? 'mood';
        this.groupIndex++;
        this.groupRest = { group, untilMs: nowMs + BREATH_REST_MIN_MS + this.rand() * BREATH_REST_SPAN_MS };
      }
    }

    this.windowMs += dt;
    if (this.windowMs >= AGE_REST_WINDOW_MS) {
      this.windowMs = 0;
      if (this.rand() < AGE_REST_CHANCE) this.ageUntilMs = nowMs + AGE_REST_MS;
    }

    return { full: false, group: this.groupRest?.group ?? null, age: nowMs < this.ageUntilMs };
  }
}

/**
 * Applies rests to the capped stem targets: a full rest zeroes everything, a group rest zeroes that
 * group, an Age rest zeroes the Age stems. Returns a new record.
 */
export function applyRests(targets: Readonly<Record<string, number>>, rests: Rests, defs: readonly StemDef[]): Record<string, number> {
  const out = { ...targets };
  if (rests.full) {
    for (const d of defs) out[d.id] = 0;
    return out;
  }
  for (const d of defs) {
    if ((rests.group !== null && d.group === rests.group) || (rests.age && d.group === 'age')) out[d.id] = 0;
  }
  return out;
}
