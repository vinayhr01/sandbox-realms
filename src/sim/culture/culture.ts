/**
 * Reduced culture slice (11-intrigue-customs-creeds-dialects.md): customs, creeds, dialects,
 * families and intrigues. Groups are plain ids (a dominion or hamlet). Structural context: the
 * caller supplies rng, tick and a rule lookup, so this module never imports Sim.
 */
import type { Rng } from '../../shared/rng.ts';

/** Trait pool a custom draws from (TUNE; flavour names only). */
export const CUSTOM_TRAITS = ['feasting', 'vigil', 'pilgrimage', 'silence', 'tithe', 'games', 'fasting', 'hymns', 'veiling', 'oaths'] as const;

export interface Custom {
  group: number;
  traits: string[];
}

export interface Creed {
  id: number;
  /** Groups holding this creed. */
  holders: Set<number>;
}

export interface Intrigue {
  id: number;
  kind: 'rebellion' | 'scheme';
  group: number;
  progress: number;
  /** Progress needed to resolve. */
  goal: number;
  /** Set when resolved. */
  outcome: 'success' | 'failure' | null;
}

export interface Dialect {
  group: number;
  /** Lexicon drift counter; groups with equal values speak the same dialect. */
  word: number;
}

export interface CultureState {
  customs: Custom[];
  creeds: Creed[];
  dialects: Dialect[];
  intrigues: Intrigue[];
  families: { child: number; parentA: number; parentB: number }[];
  nextId: number;
}

export function createCultureState(): CultureState {
  return { customs: [], creeds: [], dialects: [], intrigues: [], families: [], nextId: 1 };
}

/** Structural context for culture steps. */
export interface CultureContext {
  rng: Rng;
  tick: number;
  /** Realm Rule lookup (`rules.isOn`). */
  isOn(id: string): boolean;
  /** Groups that share a border, as pairs (contact). */
  contacts: readonly (readonly [number, number])[];
}

/** Adds a custom to a group; trait count 1-2, or 3-5 when `chaotic_minds` is on (11 section 2). */
export function addCustom(ctx: CultureContext, state: CultureState, group: number): Custom {
  const count = ctx.isOn('chaotic_minds') ? 3 + ctx.rng.int(3) : 1 + ctx.rng.int(2);
  const traits: string[] = [];
  for (let k = 0; k < count; k++) {
    const t = CUSTOM_TRAITS[ctx.rng.int(CUSTOM_TRAITS.length)];
    if (t !== undefined && !traits.includes(t)) traits.push(t);
  }
  const custom: Custom = { group, traits };
  state.customs.push(custom);
  return custom;
}

/** Starts an intrigue unless `rituals` is off; rebellions also need `uprisings` on. */
export function startIntrigue(ctx: CultureContext, state: CultureState, group: number, kind: 'rebellion' | 'scheme'): Intrigue | null {
  if (!ctx.isOn('rituals')) return null;
  if (kind === 'rebellion' && !ctx.isOn('uprisings')) return null;
  const intrigue: Intrigue = { id: state.nextId++, kind, group, progress: 0, goal: 20 + ctx.rng.int(20), outcome: null };
  state.intrigues.push(intrigue);
  return intrigue;
}

/** Records a child of two parents (family link). */
export function addFamily(state: CultureState, child: number, parentA: number, parentB: number): void {
  state.families.push({ child, parentA, parentB });
}

/** Creeds spread across contacts at a per-step chance. */
function spreadCreeds(ctx: CultureContext, state: CultureState): void {
  for (const creed of state.creeds) {
    for (const [a, b] of ctx.contacts) {
      const from = creed.holders.has(a) ? a : creed.holders.has(b) ? b : -1;
      if (from < 0) continue;
      const to = from === a ? b : a;
      if (!creed.holders.has(to) && ctx.rng.next() < 0.02) creed.holders.add(to);
    }
  }
}

/** Dialects drift per group; groups in contact pull each other's lexicon together. */
function driftDialects(ctx: CultureContext, state: CultureState): void {
  for (const d of state.dialects) {
    if (ctx.rng.next() < 0.05) d.word = d.word + (ctx.rng.next() < 0.5 ? 1 : -1);
  }
  for (const [a, b] of ctx.contacts) {
    const da = state.dialects.find((d) => d.group === a);
    const db = state.dialects.find((d) => d.group === b);
    if (da && db && da.word !== db.word && ctx.rng.next() < 0.1) {
      const merged = Math.round((da.word + db.word) / 2);
      da.word = merged;
      db.word = merged;
    }
  }
}

/** Advances intrigues; each resolves at its goal with a random success or failure. */
function advanceIntrigues(ctx: CultureContext, state: CultureState): void {
  for (const it of state.intrigues) {
    if (it.outcome !== null) continue;
    it.progress += 1 + ctx.rng.int(2);
    if (it.progress >= it.goal) it.outcome = ctx.rng.next() < 0.5 ? 'success' : 'failure';
  }
}

/** One culture step: creeds spread, dialects drift and merge, intrigues advance. */
export function cultureStep(ctx: CultureContext, state: CultureState): void {
  spreadCreeds(ctx, state);
  driftDialects(ctx, state);
  advanceIntrigues(ctx, state);
}
