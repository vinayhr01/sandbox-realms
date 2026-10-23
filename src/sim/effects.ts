/**
 * Timed statuses (08 section 5, roster ids of 18c section 5). This file implements the hooks of a
 * subset of 22 of the 56 roster statuses; the rest are listed in DECISIONS.md. Durations are in
 * ticks (18c seconds x 20); `UNTIL_CLEARED` marks statuses with no timer.
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
};

const S = (id: string, name: string, seconds: number, extra: Partial<StatusDef> = {}): StatusDef => ({
  ...base,
  id,
  name,
  ticks: seconds === 0 ? UNTIL_CLEARED : seconds * 20,
  ...extra,
});

export const STATUSES: readonly StatusDef[] = [
  S('scorched', 'Scorched', 30, { every: 40, fraction: 0.1 }),
  S('venomed', 'Venomed', 90, { every: 20, fraction: 0.01 }),
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
];

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
   * Applies a status to a being. Re-applying refreshes the timer (the longer of the two wins).
   * Returns false when all slots are full of other statuses.
   */
  add(slot: number, id: string, tick: number): boolean {
    const code = statusCode(id);
    const def = STATUSES[code - 1];
    if (!def) return false;
    const end = def.ticks === UNTIL_CLEARED ? UNTIL_CLEARED : tick + def.ticks;
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

  flag(slot: number, field: 'immobile' | 'immune' | 'wander' | 'noBreed' | 'endsOnHit'): boolean {
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
