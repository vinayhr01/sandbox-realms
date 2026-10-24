/**
 * Read-only snapshot of the sim for the UI (13 section 1: the UI consumes snapshot messages and
 * never reads sim memory). buildSnapshot only reads: it draws no randomness, writes no sim state
 * and creates no lazy state, so the state hash and the golden replay are unaffected.
 *
 * Names of dominions and hamlets are derived from their ids and placement order: those records
 * have no stored name yet, and adding one would change the sim.
 */
import { ACHIEVEMENTS } from '../content/achievements.ts';
import { SPECIES } from '../content/beasts.ts';
import { SNAPSHOT_MAX_BYTES, SNAPSHOT_VERSION, type AchievementRow, type DominionRow, type HamletRow, type Snapshot, type SpeciesRow } from '../shared/protocol.ts';
import { SS_TICKS } from './clock.ts';
import { snapshotDominions } from './dominions/adapter.ts';
import { hamletsOf } from './settlements/adapter.ts';
import { codexProgress } from './progression.ts';
import type { Sim } from './sim.ts';

/** Sim ticks between periodic snapshots: two sim-seconds (13 section 1, 10 Hz UI budget). */
export const SNAPSHOT_TICKS = 2 * SS_TICKS;

/** True when a periodic snapshot is due. `lastTick` is -1 before the first one. */
export function snapshotDue(lastTick: number, tick: number): boolean {
  return lastTick < 0 || tick - lastTick >= SNAPSHOT_TICKS || tick < lastTick;
}

/** Size of a snapshot's JSON form in bytes (what the worker posts; the budget is SNAPSHOT_MAX_BYTES). */
export function snapshotBytes(snap: Snapshot): number {
  return new TextEncoder().encode(JSON.stringify(snap)).length;
}

/** Builds the snapshot of a sim. Pure reads; the result is plain JSON-safe data. */
export function buildSnapshot(sim: Sim): Snapshot {
  const snap: Snapshot = {
    v: SNAPSHOT_VERSION,
    tick: sim.tick,
    truncated: false,
    population: populationOf(sim),
    counters: { ...sim.lifetime.counters },
    sets: Object.fromEntries(Object.entries(sim.lifetime.sets).map(([k, v]) => [k, v.length])),
    achievements: achievementsOf(sim),
    codex: codexOf(sim),
    ...dominionsOf(sim),
    ...hamletsOfSim(sim),
    culture: cultureOf(sim),
  };
  return fitSnapshot(snap);
}

/**
 * Keeps the message under SNAPSHOT_MAX_BYTES by halving the longer of the two row lists (dominions,
 * hamlets) until it fits. The totals (dominionCount, hamletCount) stay exact; `truncated` says a cut happened.
 */
export function fitSnapshot(snap: Snapshot): Snapshot {
  let out = snap;
  while (snapshotBytes(out) > SNAPSHOT_MAX_BYTES && (out.dominions.length > 0 || out.hamlets.length > 0)) {
    if (out.dominions.length >= out.hamlets.length) {
      out = { ...out, truncated: true, dominions: out.dominions.slice(0, Math.floor(out.dominions.length / 2)) };
    } else {
      out = { ...out, truncated: true, hamlets: out.hamlets.slice(0, Math.floor(out.hamlets.length / 2)) };
    }
  }
  return out;
}

function populationOf(sim: Sim): Snapshot['population'] {
  const s = sim.beings.store;
  const counts = new Int32Array(SPECIES.length);
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    const idx = s.species[slot] ?? 0;
    if (idx < counts.length) counts[idx] = (counts[idx] ?? 0) + 1;
  }
  const species: SpeciesRow[] = [];
  let folk = 0;
  for (let i = 0; i < SPECIES.length; i++) {
    const count = counts[i] ?? 0;
    const def = SPECIES[i];
    if (count === 0 || !def) continue;
    const isFolk = !def.wild;
    if (isFolk) folk += count;
    species.push({ id: def.id, name: def.name, count, folk: isFolk });
  }
  return { total: s.size, folk, wild: s.size - folk, species };
}

function achievementsOf(sim: Sim): AchievementRow[] {
  return ACHIEVEMENTS.map((a) => ({
    id: a.id,
    value: Math.max(0, a.value(sim.lifetime)),
    target: a.target,
    unlocked: sim.unlocked.has(a.id),
  }));
}

function codexOf(sim: Sim): Snapshot['codex'] {
  const c = codexProgress(sim.lifetime);
  return { discoveries: c.discoveries, traits: c.traits, traitTotal: c.traitTotal, species: c.species, rosterTotal: c.rosterTotal };
}

function dominionsOf(sim: Sim): { dominions: DominionRow[]; dominionCount: number } {
  const snap = snapshotDominions(sim);
  if (!snap) return { dominions: [], dominionCount: 0 };
  const rows: DominionRow[] = snap.dominions.map((d) => {
    let peace = 0;
    let tension = 0;
    let war = 0;
    let neighbours = 0;
    for (const other of snap.dominions) {
      if (other.id === d.id) continue;
      const rel = relationBetween(snap.relations, d.id, other.id);
      if (rel === 'war') war++;
      else if (rel === 'tension') tension++;
      else peace++;
    }
    for (const [a, b] of snap.borders) if (a === d.id || b === d.id) neighbours++;
    return {
      id: d.id,
      name: `Dominion ${d.id}`,
      parcels: d.parcels.length,
      strength: d.strength,
      neighbours,
      peace,
      tension,
      war,
      atWar: war > 0,
      campaignTarget: d.target,
    };
  });
  return { dominions: rows, dominionCount: rows.length };
}

/** Relation of a pair from the non-peace list in a dominion snapshot; peace when absent. */
function relationBetween(relations: readonly [number, number, string][], a: number, b: number): string {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  for (const [x, y, rel] of relations) if (x === lo && y === hi) return rel;
  return 'peace';
}

function hamletsOfSim(sim: Sim): { hamlets: HamletRow[]; hamletCount: number } {
  const list = hamletsOf(sim);
  const rows: HamletRow[] = list.map((h, i) => ({
    name: `Hamlet ${i + 1}`,
    folk: h.folk,
    buildings: h.buildings.length,
    parcels: h.parcels.size,
  }));
  return { hamlets: rows, hamletCount: rows.length };
}

function cultureOf(sim: Sim): Snapshot['culture'] {
  const c = sim.culture;
  const words = new Set(c.dialects.map((d) => d.word));
  let holders = 0;
  for (const creed of c.creeds) holders += creed.holders.size;
  let active = 0;
  let resolved = 0;
  for (const i of c.intrigues) {
    if (i.outcome === null) active++;
    else resolved++;
  }
  return {
    customs: c.customs.length,
    creeds: c.creeds.length,
    creedHolders: holders,
    dialects: words.size,
    dialectGroups: c.dialects.length,
    intriguesActive: active,
    intriguesResolved: resolved,
    families: c.families.length,
  };
}
