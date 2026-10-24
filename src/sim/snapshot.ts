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
import { STRAIN_TRAIT_BY_ID } from '../content/traits.ts';
import {
  SNAPSHOT_DETAIL_ROWS,
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_VERSION,
  type AchievementRow,
  type BeingRow,
  type DominionRow,
  type HamletRow,
  type NotableRows,
  type Snapshot,
  type SnapshotDetail,
  type SpeciesRow,
  type StrainRow,
  type StructureRow,
} from '../shared/protocol.ts';
import { YEAR_TICKS } from '../shared/constants.ts';
import { SS_TICKS } from './clock.ts';
import { MAX_BEINGS } from './beings/store.ts';
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
    detail: detailOf(sim),
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
  // Last resort: the detail rows go before the totals and the population do.
  if (snapshotBytes(out) > SNAPSHOT_MAX_BYTES && out.detail !== undefined) {
    const { detail: _dropped, ...rest } = out;
    out = { ...rest, truncated: true };
  }
  return out;
}

/** Culture and strain rows for the detail windows (read-only; each list capped at SNAPSHOT_DETAIL_ROWS). */
function detailOf(sim: Sim): SnapshotDetail {
  const c = sim.culture;
  const cap = SNAPSHOT_DETAIL_ROWS;
  const strains: StrainRow[] = sim.beings.strains.snapshot().list.map((s) => ({
    id: s.id,
    name: s.name,
    species: SPECIES[s.species]?.name ?? '',
    generation: s.generation,
    parent: s.parent,
    traits: s.traits.map((t) => STRAIN_TRAIT_BY_ID.get(t)?.name ?? t),
    born: s.counters.born,
    newAdults: s.counters.newAdults,
    reproduced: s.counters.reproduced,
  }));
  return {
    counts: {
      customs: c.customs.length,
      creeds: c.creeds.length,
      dialects: c.dialects.length,
      families: c.families.length,
      intrigues: c.intrigues.length,
      strains: strains.length,
    },
    customs: c.customs.slice(0, cap).map((x) => ({ group: x.group, traits: [...x.traits] })),
    creeds: c.creeds.slice(0, cap).map((x) => ({ id: x.id, holders: [...x.holders].sort((a, b) => a - b) })),
    dialects: c.dialects.slice(0, cap).map((x) => ({ group: x.group, word: x.word })),
    families: c.families.slice(0, cap).map((x) => ({ child: x.child, parentA: x.parentA, parentB: x.parentB })),
    intrigues: c.intrigues
      .slice(0, cap)
      .map((x) => ({ id: x.id, kind: x.kind, group: x.group, progress: x.progress, goal: x.goal, outcome: x.outcome })),
    strains: strains.slice(0, cap),
    notable: notableOf(sim, new Map(strains.map((s) => [s.id, s.name]))),
  };
}

/**
 * Sample rows for the being, structure and realm windows: the oldest living beings (by birth tick,
 * then slot) and the buildings of every hamlet in hamlet order. Totals are exact; lists are capped.
 * Reads only: no randomness, no lazy state.
 */
function notableOf(sim: Sim, strainNames: ReadonlyMap<number, string>): NotableRows {
  const cap = SNAPSHOT_DETAIL_ROWS;
  const s = sim.beings.store;
  const alive: number[] = [];
  for (let k = 0; k < s.size; k++) alive.push(s.at(k));
  alive.sort((a, b) => (s.born[a] ?? 0) - (s.born[b] ?? 0) || a - b);
  const beings: BeingRow[] = alive.slice(0, cap).map((slot) => {
    const def = SPECIES[s.species[slot] ?? 0];
    return {
      id: (s.generation[slot] ?? 0) * MAX_BEINGS + slot,
      species: def?.name ?? '',
      folk: def !== undefined && !def.wild,
      female: s.female[slot] === 1,
      baby: s.baby[slot] === 1,
      ageYears: Math.max(0, Math.floor((sim.tick - (s.born[slot] ?? 0)) / YEAR_TICKS)),
      vitality: s.vit[slot] ?? 0,
      maxVitality: s.maxVit[slot] ?? 0,
      strain: strainNames.get(s.strain[slot] ?? 0) ?? '',
      children: s.childCount[slot] ?? 0,
    };
  });
  const structures: StructureRow[] = [];
  let structureCount = 0;
  hamletsOf(sim).forEach((h, index) => {
    for (const b of h.buildings) {
      structureCount++;
      if (structures.length < cap) structures.push({ id: b.y * 1024 + b.x, kind: b.def.id, name: b.def.name, hamlet: index, x: b.x, y: b.y });
    }
  });
  return { beingCount: alive.length, beings, structureCount, structures };
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
