/**
 * Music feed, pure half (16 section B8 "State vector"): turns snapshots from the sim into the Age,
 * the biome shares and the six mood scores that music.ts reads. Nothing here touches WebAudio or
 * writes to the sim. The snapshot is realm-wide, not limited to the view: the worker does not
 * know the camera, so biome share and mood are approximations of "in view" (see the report note in
 * src/audio/README.md).
 */
import { SS_TICKS } from '../sim/clock.ts';
import { BIOME_FAMILIES, MOOD_KEYS, silentMusicState, type BiomeFamily, type MoodKey, type MusicState } from './music.ts';

/**
 * Family of each of the 24 biomes (content/biomes.ts ids). A content guess for the seven audio
 * families of B8; a biome that is missing here plays as temperate.
 */
export const BIOME_FAMILY_BY_ID: Readonly<Record<string, BiomeFamily>> = {
  verdant_reach: 'temperate',
  sugarvale: 'temperate',
  russetwood: 'temperate',
  bloomfield: 'temperate',
  trefoil_lea: 'temperate',
  amberveldt: 'arid',
  dunesea: 'arid',
  scree_flats: 'arid',
  rimewaste: 'cold',
  paleglen: 'cold',
  heathermoor: 'cold',
  sodden_hollow: 'wet',
  sporeglen: 'wet',
  bambooveil: 'wet',
  blightmoor: 'wet',
  cinderfields: 'volcanic',
  ashbarren: 'volcanic',
  voidscar: 'volcanic',
  steamthicket: 'coast',
  citrusdell: 'coast',
  prism_hollow: 'magical',
  gleamwood: 'magical',
  skyhaven: 'magical',
  riftmeadow: 'magical',
};

export function biomeFamilyOf(biomeId: string): BiomeFamily {
  return BIOME_FAMILY_BY_ID[biomeId] ?? 'temperate';
}

/** Fraction of the counted tiles in each family (0..1 each). All zero when there are no tiles. */
export function biomeShares(counts: Readonly<Record<string, number>>): Record<BiomeFamily, number> {
  const out = Object.fromEntries(BIOME_FAMILIES.map((b) => [b, 0])) as Record<BiomeFamily, number>;
  let total = 0;
  for (const n of Object.values(counts)) if (Number.isFinite(n) && n > 0) total += n;
  if (total === 0) return out;
  for (const [id, n] of Object.entries(counts)) {
    if (!Number.isFinite(n) || n <= 0) continue;
    out[biomeFamilyOf(id)] += n / total;
  }
  return out;
}

const clamp01 = (v: number): number => (Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)));

/** Mood rises with a 4 s time constant and falls with a 20 s half-life (B8 mood scoring). */
export const MOOD_RISE_TAU_S = 4;
export const MOOD_FALL_HALF_LIFE_S = 20;
/** Window for death and birth counts (B8: "recent deaths per 100 population, 20 s window"). */
export const MOOD_WINDOW_S = 20;

/**
 * One smoothing step of a mood score toward its raw value. Rising follows a 4 s time constant,
 * falling halves the distance every 20 s. `dtS` is the seconds since the last step.
 */
export function smoothMood(prev: number, raw: number, dtS: number): number {
  const p = clamp01(prev);
  const r = clamp01(raw);
  if (dtS <= 0) return p;
  if (r > p) return p + (r - p) * (1 - Math.exp(-dtS / MOOD_RISE_TAU_S));
  return r + (p - r) * Math.pow(0.5, dtS / MOOD_FALL_HALF_LIFE_S);
}

/** The parts of a snapshot the feed reads. Structural, so tests can pass plain objects. */
export interface FeedSnapshot {
  tick: number;
  age?: string;
  biomes?: Record<string, number>;
  population: { total: number };
  counters: Record<string, number>;
  dominions: readonly { atWar: boolean; tension: number }[];
  culture?: { intriguesActive: number };
}

/** Raw (unsmoothed) mood scores from one snapshot and the window counts. Exported for tests. */
export function rawMood(input: {
  population: number;
  deathsInWindow: number;
  birthsInWindow: number;
  dominionsAtWar: number;
  tensionShare: number;
  activeIntrigues: number;
  magicalShare: number;
}): Record<MoodKey, number> {
  const per100 = 100 / Math.max(1, input.population);
  const grief = clamp01((input.deathsInWindow * per100) / 10);
  const prosperity = clamp01((input.birthsInWindow * per100) / 10);
  // Combatants are not published, so dominions at war stand in for them; a campaign adds half.
  const war = input.dominionsAtWar > 0 ? clamp01(0.5 * clamp01(input.dominionsAtWar / 4) + 0.5) : 0;
  const tension = clamp01(Math.max(input.tensionShare, input.activeIntrigues > 0 ? 0.3 : 0));
  const wonder = clamp01(input.magicalShare * 4);
  const calm = clamp01(1 - Math.max(war, tension, grief));
  return { calm, tension, war, grief, prosperity, wonder };
}

/**
 * Keeps the latest Age, biome shares and smoothed mood, fed by each snapshot. The engine reads
 * `partial()` about once a second when it publishes the music state.
 */
export class MusicFeed {
  private age: string | null = null;
  private biomeShare: Record<BiomeFamily, number> = silentMusicState().biomeShare;
  private mood: Record<MoodKey, number> = silentMusicState().mood;
  private lastTick: number | null = null;
  private history: { tick: number; deaths: number; births: number }[] = [];

  ingest(snap: FeedSnapshot): void {
    this.age = typeof snap.age === 'string' && snap.age.length > 0 ? snap.age : null;
    this.biomeShare = biomeShares(snap.biomes ?? {});

    const deaths = snap.counters['deaths'] ?? 0;
    const births = snap.counters['beingsBorn'] ?? 0;
    const tick = snap.tick;
    // A tick that moved backwards means a new or loaded realm: start the windows again.
    if (this.lastTick !== null && tick < this.lastTick) this.history = [];
    this.history.push({ tick, deaths, births });
    const cutoff = tick - MOOD_WINDOW_S * SS_TICKS;
    while (this.history.length > 1 && (this.history[1]?.tick ?? Infinity) <= cutoff) this.history.shift();
    const oldest = this.history[0];
    const deathsInWindow = oldest ? Math.max(0, deaths - oldest.deaths) : 0;
    const birthsInWindow = oldest ? Math.max(0, births - oldest.births) : 0;

    const dominions = snap.dominions;
    const n = Math.max(1, dominions.length);
    const raw = rawMood({
      population: snap.population.total,
      deathsInWindow,
      birthsInWindow,
      dominionsAtWar: dominions.filter((d) => d.atWar).length,
      tensionShare: dominions.filter((d) => d.tension > 0).length / n,
      activeIntrigues: snap.culture?.intriguesActive ?? 0,
      magicalShare: this.biomeShare.magical,
    });
    const dtS = this.lastTick === null || tick < this.lastTick ? 0 : (tick - this.lastTick) / SS_TICKS;
    const next = { ...this.mood };
    for (const k of MOOD_KEYS) next[k] = smoothMood(this.mood[k], raw[k], dtS);
    this.mood = next;
    this.lastTick = tick;
  }

  /** The fields the feed owns, ready to merge into a MusicState. */
  partial(): Pick<MusicState, 'ageId' | 'biomeShare' | 'mood'> {
    return { ageId: this.age, biomeShare: { ...this.biomeShare }, mood: { ...this.mood } };
  }
}
