/**
 * Timed statuses (08 section 5, roster ids of 18c section 5). This file implements the hooks of 24
 * roster statuses that the sim can run; each has an in-play source or is cut (DECISIONS.md "Combat
 * release"). Durations are in ticks (18c seconds x 20); `UNTIL_CLEARED` marks statuses with no timer.
 */
export const UNTIL_CLEARED = 0xffffffff;
/** Effects a being can carry at once. */
export const MAX_EFFECTS = 4;

export interface StatusDef {
  id: string;
  name: string;
  /** Duration in ticks at creation. */
  ticks: number;
  /** Speed multiplier (pace), 1 = none. */
  speed: number;
  /** Attack multiplier (damage dealt), 1 = none. */
  damage: number;
  /** Multiplier on damage taken, 1 = none. */
  taken: number;
  /** Cannot move at all. */
  immobile: boolean;
  /** Periodic damage: `every` ticks, `fraction` of max vitality (0 = none). */
  every: number;
  fraction: number;
  /** Damage bypass: immune to all damage (sheltered). */
  immune: boolean;
  /** Mind-affecting: wanders at random (bewildered, dread). */
  wander: boolean;
  /** Cannot breed (lull). */
  noBreed: boolean;
  /** Removed when the being is hit (dazed, dozing). */
  endsOnHit: boolean;
  /** Periodic damage is Fire (scorched) rather than Poison. */
  fire: boolean;
  /** Periodic damage is Drowning (gasping) rather than Poison. */
  drown: boolean;
  /** Periodic damage cannot take the being below 1 vitality (venomed, 08 5.3). */
  cannotKill: boolean;
  /** Periodic damage in flat points, used instead of `fraction` when above 0 (gasping: 1, 18c). */
  flat: number;
  /** False when the status is not written to a save (08 section 11: puppeted, tagalong, gasping, the recover markers). */
  persist: boolean;
  /** The being takes no part in a fight while this lasts (08 5.3 tag `ignoreFights`, gasping). */
  ignoreFights: boolean;
}

const base: Omit<StatusDef, 'id' | 'name' | 'ticks'> = {
  speed: 1,
  damage: 1,
  taken: 1,
  immobile: false,
  every: 0,
  fraction: 0,
  immune: false,
  wander: false,
  noBreed: false,
  endsOnHit: false,
  fire: false,
  drown: false,
  cannotKill: false,
  flat: 0,
  persist: true,
  ignoreFights: false,
};

const S = (id: string, name: string, seconds: number, extra: Partial<StatusDef> = {}): StatusDef => ({
  ...base,
  id,
  name,
  ticks: seconds === 0 ? UNTIL_CLEARED : seconds * 20,
  ...extra,
});

export const STATUSES: readonly StatusDef[] = [
  S('scorched', 'Scorched', 30, { every: 40, fraction: 0.1, fire: true }),
  S('venomed', 'Venomed', 90, { every: 20, fraction: 0.01, cannotKill: true }),
  S('bleeding', 'Bleeding', 20, { every: 20, fraction: 0.02 }),
  S('rotting', 'Rotting', 120, { every: 20, fraction: 0.01 }),
  S('ash_sickness', 'Ash Sickness', 500, { every: 200, fraction: 0.01, speed: 0.9, taken: 1.1 }),
  S('coughing', 'Coughing', 200, { speed: 0.9, taken: 1.05 }),
  S('sluggish', 'Sluggish', 30, { speed: 0.1 }),
  S('numbed', 'Numbed', 6, { speed: 0.7, damage: 0.7 }),
  S('itchy', 'Itchy', 20, { speed: 0.9 }),
  S('blinded', 'Blinded', 5, { damage: 0.1 }),
  S('rimebound', 'Rimebound', 15, { immobile: true, taken: 1.2 }),
  S('taking_root', 'Taking Root', 120, { immobile: true, taken: 0.7, speed: 0.7, damage: 0.7 }),
  S('sprouting', 'Sprouting', 120, { immobile: true, taken: 0.7, speed: 0.7 }),
  S('warded', 'Warded', 60, { taken: 0.1 }),
  S('sheltered', 'Sheltered', 5, { immune: true }),
  S('emboldened', 'Emboldened', 60, { speed: 1.3, damage: 1.3 }),
  S('empowered', 'Empowered', 300, { damage: 1.5 }),
  S('hexed', 'Hexed', 300, { speed: 0.8, damage: 0.5, taken: 1.5 }),
  S('frenzy', 'Frenzy', 300, { damage: 2 }),
  S('bewildered', 'Bewildered', 10, { wander: true }),
  S('dazed', 'Dazed', 4, { immobile: true, endsOnHit: true }),
  S('lull', 'Lull', 90, { noBreed: true }),
  S('expecting', 'Expecting', 45, { speed: 0.8 }),
  S('sated', 'Sated', 200, {}),
  // Beings close 4 (08 section 5.3, 07 section 13). Appended, so the codes above keep their numbers in saves.
  // `smitten`: 3600 ticks, given to both lovers when the lover link forms (06 4.4). Its mood +40 is the `bonded` event.
  S('smitten', 'Smitten', 180, {}),
  // `tagalong`: 4000 ticks, given to a Being that the Architect talks to (07 section 13). Its follow is in system.ts.
  S('tagalong', 'Tagalong', 200, { persist: false }),
  // Combat close 5 (18c section 5, 08 section 5.3). `unnerved`: 400 ticks (20 s). Its mood -8 is on apply (creep-effects.ts,
  // moods.ts) and its 100-tick flight roll is in beings/system.ts. `giggling`: 60 ticks (3 s), emote only, so it has no
  // hook here; its source is the gourdgrowth evaluation (creep-effects.ts).
  S('unnerved', 'Unnerved', 20, {}),
  S('giggling', 'Giggling', 3, {}),
  // Beings close 5 (08 section 5.3, 5.4). Appended, so the codes above keep their numbers in saves.
  // `gasping`: 20 ticks (1 s; 08 5.3 gives durations in ticks), 1 point of Drowning every 10 ticks. Added by system.ts
  // `gaspCheck` when a Being stands in liquid with no endurance. Not saved (08 section 11).
  S('gasping', 'Gasping', 1, { every: 10, flat: 1, drown: true, ignoreFights: true, persist: false }),
  // `outburst`: 2400 ticks (08 5.4). Grants the `outburst_action` decision (system.ts). Its source is not built.
  S('outburst', 'Outburst', 120, {}),
];

/**
 * On-hit statuses of item modifiers (08 section 6.3, content/items.ts explicit mods). A weapon with
 * the modifier applies the status to its victim with the chance given; the duration is the STATUSES
 * entry's. `blaze` always burns on hit.
 */
export const ON_HIT_MODIFIERS: Readonly<Record<string, { status: string; chance: number }>> = {
  blaze: { status: 'scorched', chance: 1 },
  rime_touch: { status: 'rimebound', chance: 0.2 },
  concussive: { status: 'dazed', chance: 0.2 },
  sluggish: { status: 'sluggish', chance: 0.2 },
  venomous: { status: 'venomed', chance: 0.3 },
};

/**
 * Statuses a predator's bite applies to its prey, keyed by the predator's species id (18c section 5 `source`
 * column: stingtail for numbed, gnatveil for itchy, inkreaver for blinded, rotstride for rotting). Used by
 * combat.predate only; the Folk strike and brawl paths are not wired to these. Chance 1 is always.
 */
export const BITE_STATUSES: Readonly<Record<string, { status: string; chance: number }>> = {
  stingtail: { status: 'numbed', chance: 1 },
  gnatveil: { status: 'itchy', chance: 1 },
  inkreaver: { status: 'blinded', chance: 1 },
  rotstride: { status: 'rotting', chance: 1 },
};

/** Trait (18b `rot_touched`, ACQ) that makes any bite of its carrier apply rotting (18c source "rotstride bite"). */
export const ROT_TOUCHED_TRAIT = 'rot_touched';

/** Chance that a claw swing which lands leaves its victim bleeding (18c source "slashes"; TUNE, not in 08). */
export const CLAW_BLEED_CHANCE = 0.2;

export const STATUS_BY_ID = new Map(STATUSES.map((s, k) => [s.id, k + 1]));

/** Status code (1-based, 0 = empty) for an id. */
export function statusCode(id: string): number {
  const k = STATUS_BY_ID.get(id);
  if (k === undefined) throw new RangeError(`unknown status ${id}`);
  return k;
}

/** Per-being effect slots: codes and expiry ticks, MAX_EFFECTS per being. */
export class EffectStore {
  readonly code: Uint8Array;
  readonly until: Uint32Array;

  constructor(capacity: number) {
    this.code = new Uint8Array(capacity * MAX_EFFECTS);
    this.until = new Uint32Array(capacity * MAX_EFFECTS);
  }

  /**
   * Applies a status to a being. Re-applying refreshes the timer (the longer of the two wins). `ticks` overrides the
   * table duration for one application (the hatch stun is 100 ticks, 06 life events, where the table gives `dazed` 80).
   * Returns false when all slots are full of other statuses.
   */
  add(slot: number, id: string, tick: number, ticks?: number): boolean {
    const code = statusCode(id);
    const def = STATUSES[code - 1];
    if (!def) return false;
    const span = ticks ?? def.ticks;
    const end = def.ticks === UNTIL_CLEARED && ticks === undefined ? UNTIL_CLEARED : tick + span;
    const base = slot * MAX_EFFECTS;
    let free = -1;
    for (let k = 0; k < MAX_EFFECTS; k++) {
      const idx = base + k;
      if (this.code[idx] === code) {
        if (end > (this.until[idx] ?? 0) || end === UNTIL_CLEARED) this.until[idx] = end;
        return true;
      }
      if (free < 0 && this.code[idx] === 0) free = idx;
    }
    if (free < 0) return false;
    this.code[free] = code;
    this.until[free] = end;
    return true;
  }

  has(slot: number, id: string): boolean {
    const code = STATUS_BY_ID.get(id) ?? -1;
    const base = slot * MAX_EFFECTS;
    for (let k = 0; k < MAX_EFFECTS; k++) if (this.code[base + k] === code) return true;
    return false;
  }

  remove(slot: number, id: string): void {
    const code = STATUS_BY_ID.get(id) ?? -1;
    const base = slot * MAX_EFFECTS;
    for (let k = 0; k < MAX_EFFECTS; k++) {
      if (this.code[base + k] === code) this.code[base + k] = 0;
    }
  }

  clear(slot: number): void {
    const base = slot * MAX_EFFECTS;
    for (let k = 0; k < MAX_EFFECTS; k++) this.code[base + k] = 0;
  }

  /** Combined multiplier of a field over every active status on the being. */
  multiplier(slot: number, field: 'speed' | 'damage' | 'taken'): number {
    let m = 1;
    const base = slot * MAX_EFFECTS;
    for (let k = 0; k < MAX_EFFECTS; k++) {
      const c = this.code[base + k] ?? 0;
      if (c === 0) continue;
      m *= STATUSES[c - 1]?.[field] ?? 1;
    }
    return m;
  }

  flag(slot: number, field: 'immobile' | 'immune' | 'wander' | 'noBreed' | 'endsOnHit' | 'ignoreFights'): boolean {
    const base = slot * MAX_EFFECTS;
    for (let k = 0; k < MAX_EFFECTS; k++) {
      const c = this.code[base + k] ?? 0;
      if (c !== 0 && STATUSES[c - 1]?.[field]) return true;
    }
    return false;
  }

  /** Drops expired timers. Returns the codes that ended this tick for one slot (for hooks). */
  expire(slot: number, tick: number): void {
    const base = slot * MAX_EFFECTS;
    for (let k = 0; k < MAX_EFFECTS; k++) {
      const idx = base + k;
      if (this.code[idx] !== 0 && this.until[idx] !== UNTIL_CLEARED && (this.until[idx] ?? 0) <= tick) {
        this.code[idx] = 0;
      }
    }
  }
}
