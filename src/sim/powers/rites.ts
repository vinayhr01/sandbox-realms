/**
 * Favour and Insight powers that act on beings: Bless (favour_bless) and Lore (insight_lore).
 * Spec 12 does not define either power's effect; the effects here are the defaults recorded in
 * DECISIONS.md ("Powers round 3"). Both read the sim and write only through existing state: Bless
 * through the effect store, Lore through the lifetime codex sets (14 section 5).
 */
import type { Sim } from '../sim.ts';
import { recordStat } from '../stats-hooks.ts';
import { hasTrait, traitIndex } from '../beings/afflictions.ts';

/** Codex set that holds discovered species, as `species:<id>` (14 section 5). */
const DISCOVERIES = 'discoveries';
const SPECIES_PREFIX = 'species:';

/** Living beings whose tile is within Chebyshev `radius` of (x,y), in alive-list order (deterministic). */
function beingsWithin(sim: Sim, x: number, y: number, radius: number): number[] {
  const s = sim.beings.store;
  const out: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (Math.abs((s.x[slot] ?? 0) - x) <= radius && Math.abs((s.y[slot] ?? 0) - y) <= radius) out.push(slot);
  }
  return out;
}

/**
 * Bless: gives the status `status` (default `warded`) to every living being within `radius` of (x,y).
 * Returns how many beings received it (a full effect store refuses the status).
 */
export function blessAt(sim: Sim, x: number, y: number, radius: number, status: string): number {
  let n = 0;
  for (const slot of beingsWithin(sim, x, y, radius)) {
    if (sim.effects.add(slot, status, sim.tick)) n++;
  }
  return n;
}

/**
 * Hex cast (08 section 9.2 `hex_cast`, beings close 5): the curse drop. Every living Being within `radius` (Chebyshev) of
 * (x,y) loses `haloed` (08 9.2) and gains `hexed` (8 5.3, 6000 ticks). A Being that already has `hexed` is skipped. A
 * `hexbreaker` Being is cured on touch and not hexed (traits.ts). A `stalwartheart` Being is immune to mind statuses,
 * `hexed` included (traits.ts), and keeps its `haloed`. Returns how many Beings were hexed.
 */
export function hexAt(sim: Sim, x: number, y: number, radius: number): number {
  let n = 0;
  const s = sim.beings.store;
  for (const slot of beingsWithin(sim, x, y, radius)) {
    if (hasTrait(sim, slot, 'hexbreaker')) {
      sim.effects.remove(slot, 'hexed');
      continue;
    }
    if (sim.effects.has(slot, 'hexed') || hasTrait(sim, slot, 'stalwartheart')) continue;
    const haloed = traitIndex('haloed');
    if (haloed >= 0) s.setMark(slot, haloed, false);
    if (sim.effects.add(slot, 'hexed', sim.tick)) n++;
  }
  return n;
}

/**
 * Species ids recorded by Lore, in the order they were first discovered. Read-only: callers never
 * change the codex through this list.
 */
export function loreKnown(sim: Sim): readonly string[] {
  const list = sim.lifetime.sets[DISCOVERIES] ?? [];
  return list.filter((id) => id.startsWith(SPECIES_PREFIX)).map((id) => id.slice(SPECIES_PREFIX.length));
}

/**
 * Lore: records the species of every living being within `radius` of (x,y) in the codex as a
 * discovery. Species already known are skipped. Returns how many new species were recorded.
 */
export function loreAt(sim: Sim, x: number, y: number, radius: number): number {
  const known = new Set(loreKnown(sim));
  let added = 0;
  for (const slot of beingsWithin(sim, x, y, radius)) {
    const id = sim.beings.species(sim.beings.store.species[slot] ?? 0).id;
    if (known.has(id)) continue;
    known.add(id);
    recordStat(sim, { kind: 'set.add', set: DISCOVERIES, id: `${SPECIES_PREFIX}${id}` });
    added++;
  }
  return added;
}
