/**
 * Creep hubs (18e section 1): the structures that keep a creep ground alive. Numbers are TUNE
 * except where 18e states them. The hub's creep ground is the ground id of grounds.ts.
 */
export type CreepGroundKey = 'gloomgrowth' | 'bloatmoss' | 'gourdgrowth';

export interface CreepHubDef {
  id: string;
  name: string;
  /** Creep ground this hub grows (18c section 1). */
  ground: CreepGroundKey;
  /** Max creep tiles connected to one hub (18e 1.1). */
  maxSize: number;
  /** Tiles added per pulse (18e 1.1). */
  spreadBatch: number;
  /** Gloom and bloat creep remove flora they spread onto; gourd creep leaves it standing (18e 1.3). */
  clearsFlora: boolean;
}

export const CREEP_HUBS: readonly CreepHubDef[] = [
  { id: 'gloom_heart', name: 'Gloom Heart', ground: 'gloomgrowth', maxSize: 500, spreadBatch: 6, clearsFlora: true },
  { id: 'bloat_heart', name: 'Bloat Heart', ground: 'bloatmoss', maxSize: 400, spreadBatch: 4, clearsFlora: true },
  { id: 'gourd_heart', name: 'Gourd Heart', ground: 'gourdgrowth', maxSize: 300, spreadBatch: 3, clearsFlora: false },
];

export const CREEP_HUB_BY_ID = new Map(CREEP_HUBS.map((h) => [h.id, h]));

/** Realm cap on live hubs (18e 1.1). */
export const CREEP_REALM_CAP = 12;
/** Pulse interval in ticks: 8 s (18e 1.3). */
export const CREEP_PULSE_TICKS = 160;
/** Decay run interval in ticks: about 1.3 s (02 section 7, creepDecay 1 + 0.3 s). */
export const CREEP_DECAY_TICKS = 26;
/** Creep tiles lowered per decay run (18e 1.6). */
export const CREEP_DECAY_PER_RUN = 3;
/** Ticks an acid-touched creep tile may not re-spread (18e 1.5: 20 s). */
export const CREEP_GUARD_TICKS = 400;
/** Ticks a hub tile may burn before the hub dies (18e 1.5: 6 s). */
export const CREEP_BURN_TICKS = 120;

/** Effect a landmark or beacon runs on its pulse (18e 2.1). `none` is passive or dormant (no lore, night or fear system). */
export type LandmarkEffect = 'freeze' | 'ignite' | 'acid' | 'none';

/** A landmark or beacon pillar (18e section 2). Footprints are recorded; placement checks the anchor tile only. */
export interface LandmarkDef {
  id: string;
  name: string;
  /** Footprint width and height in tiles (18e 2.1, 2.3). */
  size: readonly [number, number];
  /** Realm cap on live copies (18e 2.1, 2.3). */
  realmCap: number;
  /** Pulse period in ticks (30 s = 600, 20 s = 400); 0 for passive structures. */
  period: number;
  /** Radius in tiles of the pulse disc (acid_font lands its drop 2..15 tiles out). */
  radius: number;
  effect: LandmarkEffect;
  /** Chance per flammable tile in the disc, for `ignite` (ember_pylon 0.35, 18e 2.1). */
  chance: number;
  /** Beacon pillars: build ids a hamlet within BEACON_RANGE adopts (18e 2.3). Empty for the rest. */
  desires: readonly string[];
}

/** Hamlets with a parcel this near a pillar adopt its desires (18e 2.3, TUNE). */
export const BEACON_RANGE = 40;
/** A hamlet holds the desires of this many nearest pillars (18e 2.3). */
export const BEACON_DESIRES = 2;

export const LANDMARKS: readonly LandmarkDef[] = [
  { id: 'rime_pylon', name: 'Rime Pylon', size: [2, 2], realmCap: 6, period: 600, radius: 8, effect: 'freeze', chance: 1, desires: [] },
  { id: 'ember_pylon', name: 'Ember Pylon', size: [2, 2], realmCap: 6, period: 600, radius: 5, effect: 'ignite', chance: 0.35, desires: [] },
  { id: 'acid_font', name: 'Acid Font', size: [2, 2], realmCap: 8, period: 400, radius: 15, effect: 'acid', chance: 1, desires: [] },
  { id: 'insight_seed', name: 'Insight Seed', size: [1, 1], realmCap: 12, period: 0, radius: 24, effect: 'none', chance: 0, desires: [] },
  { id: 'lantern_spire', name: 'Lantern Spire', size: [2, 2], realmCap: 10, period: 0, radius: 20, effect: 'none', chance: 0, desires: [] },
  { id: 'spore_pillar', name: 'Spore Pillar', size: [1, 2], realmCap: 2, period: 0, radius: 0, effect: 'none', chance: 0, desires: ['farmstead', 'mill_a', 'granary'] },
  { id: 'reason_pillar', name: 'Reason Pillar', size: [1, 2], realmCap: 2, period: 0, radius: 0, effect: 'none', chance: 0, desires: ['archive', 'lecture_stone', 'shrine'] },
  { id: 'gilded_pillar', name: 'Gilded Pillar', size: [1, 2], realmCap: 2, period: 0, radius: 0, effect: 'none', chance: 0, desires: ['bazaar', 'monument', 'harbor'] },
  { id: 'chime_pillar', name: 'Chime Pillar', size: [1, 2], realmCap: 2, period: 0, radius: 0, effect: 'none', chance: 0, desires: ['pyre', 'shrine', 'waystop'] },
];

export const LANDMARK_BY_ID = new Map(LANDMARKS.map((l) => [l.id, l]));
