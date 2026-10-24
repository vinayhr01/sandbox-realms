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
