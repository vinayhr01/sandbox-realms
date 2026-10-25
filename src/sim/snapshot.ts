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
import { BIOMES, biomeOfCover } from '../content/biomes.ts';
import {
  SNAPSHOT_DETAIL_ROWS,
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_VERSION,
  type AchievementRow,
  type BeingRow,
  type ClanBlock,
  type ClanRow,
  type DominionRow,
  type HamletRow,
  MAP_BUILDING_CAP,
  MAP_INTRIGUE_CAP,
  MAP_MARK_CAP,
  MAP_POINT_CAP,
  type MapBuilding,
  type MapIntrigue,
  type MapKind,
  type MapKindGroup,
  type MapMarks,
  type MapPoint,
  type MapSizeClass,
  type NotableRows,
  type PactBlock,
  type PactRow,
  type Snapshot,
  type SnapshotDetail,
  type SpeciesRow,
  type StrainRow,
  type StructureRow,
} from '../shared/protocol.ts';
import { YEAR_TICKS } from '../shared/constants.ts';
import { SS_TICKS } from './clock.ts';
import { MAX_BEINGS } from './beings/store.ts';
import { dominionsOfSim, pactsOfSim, parcelsPerAxis, snapshotDominions } from './dominions/adapter.ts';
import { centroidParcel } from './dominions/armies.ts';
import { hamletsOf } from './settlements/adapter.ts';
import { hamletMood, PARCEL } from './settlements/hamlet.ts';
import { codexProgress } from './progression.ts';
import { clanSpeciesName, yearsSince, type Clan } from './clans/clans.ts';
import { itemsOf } from './items/summary.ts';
import type { Sim } from './sim.ts';

/** Sim ticks between periodic snapshots: two sim-seconds, 40 ticks at 20 Hz (13 section 1). */
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
    // windows-sim-data block (kept apart from other snapshot blocks so merges stay clean).
    pacts: pactsOf(sim),
    // Audio feed (16 B8): the Age in effect and the tiles per biome over the realm. Read-only.
    age: sim.currentAge,
    biomes: biomeCountsOf(sim),
    clans: clansOf(sim),
    // Items block (windows-sim-data, 08 section 6): read-only summary of the item store.
    items: itemsOf(sim),
    // Map feed (src/render/marks.ts): read-only positions of living beings, capped.
    mapPoints: mapPointsOf(sim),
    mapMarks: mapMarksOf(sim),
    mapKinds: mapKindsOf(sim),
    mapBuildings: mapBuildingsOf(sim),
    mapIntrigues: mapIntriguesOf(sim),
  };
  return fitSnapshot(snap);
}

/**
 * Positions for the map marks: armies at their parcel, campaigns at the attacker's army, battles at the
 * midpoint of a war pair whose armies are in contact (Chebyshev distance <= 1, as in step.ts), pact links
 * between consecutive members that have an army, and hamlet names at each hamlet's centroid parcel.
 * Tile = parcel centre (col * PARCEL + PARCEL / 2, row * PARCEL + PARCEL / 2). Reads only; capped.
 */
function mapMarksOf(sim: Sim): MapMarks {
  const perAxis = parcelsPerAxis(sim);
  const tileOf = (p: number): { x: number; y: number } => ({
    x: (p % perAxis) * PARCEL + PARCEL / 2,
    y: Math.floor(p / perAxis) * PARCEL + PARCEL / 2,
  });
  const cap = MAP_MARK_CAP;
  const dom = snapshotDominions(sim);
  const armyAt = new Map<number, number>();
  for (const a of dom?.armies ?? []) if (a.parcel !== undefined) armyAt.set(a.dominionId, a.parcel);

  const armies = [...armyAt].slice(0, cap).map(([dominionId, p]) => ({ dominionId, ...tileOf(p) }));

  const campaigns: MapMarks['campaigns'] = [];
  for (const d of dom?.dominions ?? []) {
    const p = armyAt.get(d.id);
    if (d.target >= 0 && p !== undefined && campaigns.length < cap) campaigns.push({ dominionId: d.id, ...tileOf(p) });
  }

  const battles: MapMarks['battles'] = [];
  for (const [a, b] of dom?.borders ?? []) {
    if (battles.length >= cap) break;
    const pa = armyAt.get(a);
    const pb = armyAt.get(b);
    if (pa === undefined || pb === undefined || relationBetween(dom?.relations ?? [], a, b) !== 'war') continue;
    const ta = tileOf(pa);
    const tb = tileOf(pb);
    if (Math.max(Math.abs(pa % perAxis - pb % perAxis), Math.abs(Math.floor(pa / perAxis) - Math.floor(pb / perAxis))) > 1) continue;
    battles.push({ x: (ta.x + tb.x) / 2, y: (ta.y + tb.y) / 2 });
  }

  const pactLinks: MapMarks['pactLinks'] = [];
  for (const pact of pactsOfSim(sim)) {
    const placed = pact.memberIds.filter((m) => armyAt.has(m)).map((m) => tileOf(armyAt.get(m) ?? 0));
    for (let i = 1; i < placed.length && pactLinks.length < cap; i++) {
      const a = placed[i - 1];
      const b = placed[i];
      if (a && b) pactLinks.push([a.x, a.y, b.x, b.y]);
    }
  }

  const hamlets = hamletsOf(sim)
    .map((h, i) => ({ name: `Hamlet ${i + 1}`, parcel: h.parcels.size > 0 ? centroidParcel(h.parcels, perAxis) : -1 }))
    .filter((h) => h.parcel >= 0)
    .slice(0, cap)
    .map((h) => ({ name: h.name, ...tileOf(h.parcel) }));

  return { armies, campaigns, battles, pactLinks, hamlets };
}

/**
 * Positions of living beings for the map layers: the oldest first (birth tick, then slot), capped at
 * MAP_POINT_CAP. Reads only.
 */
function mapPointsOf(sim: Sim): MapPoint[] {
  const s = sim.beings.store;
  const alive: number[] = [];
  for (let k = 0; k < s.size; k++) alive.push(s.at(k));
  alive.sort((a, b) => (s.born[a] ?? 0) - (s.born[b] ?? 0) || a - b);
  return alive.slice(0, MAP_POINT_CAP).map((slot) => {
    const def = SPECIES[s.species[slot] ?? 0];
    return {
      id: (s.generation[slot] ?? 0) * MAX_BEINGS + slot,
      x: s.x[slot] ?? 0,
      y: s.y[slot] ?? 0,
      folk: def !== undefined && !def.wild,
    };
  });
}

/** Species group letter (18a section 2) to the map sprite group; 'folk' is the Folk row group. */
const MAP_GROUP_OF_LETTER: Record<string, MapKindGroup> = {
  A: 'beast',
  B: 'beast',
  C: 'beast',
  D: 'sea',
  E: 'insect',
  F: 'undead',
  G: 'monster',
  H: 'divine',
  folk: 'folk',
};

/**
 * Sprite kind (group and size class) of each point in mapPoints, same ids and order. Read-only; capped at
 * MAP_POINT_CAP like mapPoints. Dropped first by fitSnapshot.
 */
function mapKindsOf(sim: Sim): MapKind[] {
  const s = sim.beings.store;
  const alive: number[] = [];
  for (let k = 0; k < s.size; k++) alive.push(s.at(k));
  alive.sort((a, b) => (s.born[a] ?? 0) - (s.born[b] ?? 0) || a - b);
  return alive.slice(0, MAP_POINT_CAP).map((slot) => {
    const def = SPECIES[s.species[slot] ?? 0];
    return {
      id: (s.generation[slot] ?? 0) * MAX_BEINGS + slot,
      group: MAP_GROUP_OF_LETTER[def?.group ?? ''] ?? 'beast',
      size: (def?.size ?? 'S') as MapSizeClass,
    };
  });
}

/**
 * Buildings of every hamlet in hamlet order, with their tile positions, capped at MAP_BUILDING_CAP. Reads only.
 * The hamlet rows carry counts only, and the notable rows are capped at 16, so the map gets its own list.
 */
function mapBuildingsOf(sim: Sim): MapBuilding[] {
  const out: MapBuilding[] = [];
  for (const h of hamletsOf(sim)) {
    for (const b of h.buildings) {
      if (out.length >= MAP_BUILDING_CAP) return out;
      out.push({ id: b.y * 1024 + b.x, kind: b.def.id, x: b.x, y: b.y });
    }
  }
  return out;
}

/**
 * Intrigues for the intrigue marks: kind, whether still running, and the tile of the target. The intrigue's group
 * id is resolved as a dominion id first (the dominion's centroid parcel), then as a hamlet index in hamletsOf order
 * (hamlets carry no id in the sim; the snapshot names them by that order). No match gives x = y = -1. Running
 * intrigues come first, then by id; capped at MAP_INTRIGUE_CAP. Reads only. The group-to-target rule is a guess
 * until a caller starts intrigues in play (see DECISIONS.md, Map layers round 7).
 */
function mapIntriguesOf(sim: Sim): MapIntrigue[] {
  const perAxis = parcelsPerAxis(sim);
  const tileOf = (parcels: ReadonlySet<number>): { x: number; y: number } | null => {
    if (parcels.size === 0) return null;
    const p = centroidParcel(parcels, perAxis);
    return { x: (p % perAxis) * PARCEL + PARCEL / 2, y: Math.floor(p / perAxis) * PARCEL + PARCEL / 2 };
  };
  const dominionById = new Map((snapshotDominions(sim)?.dominions ?? []).map((d) => [d.id, new Set(d.parcels)]));
  const hamlets = hamletsOf(sim);
  const rows = sim.culture.intrigues
    .map((it): MapIntrigue => {
      const place = dominionById.has(it.group) ? tileOf(dominionById.get(it.group) ?? new Set()) : tileOf(hamlets[it.group]?.parcels ?? new Set());
      return { id: it.id, kind: it.kind, active: it.outcome === null, x: place?.x ?? -1, y: place?.y ?? -1 };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.id - b.id);
  return rows.slice(0, MAP_INTRIGUE_CAP);
}

/** Tiles per biome id over the whole realm: a read-only scan of the cover layer. */
function biomeCountsOf(sim: Sim): Record<string, number> {
  const counts: Record<string, number> = {};
  const cover = sim.realm.cover;
  for (let i = 0; i < cover.length; i++) {
    const idx = biomeOfCover(cover[i] ?? 0);
    const id = idx >= 0 ? BIOMES[idx]?.id : undefined;
    if (id !== undefined) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/**
 * Clan rows for the kinbands window: living clans first, then by id, capped at SNAPSHOT_DETAIL_ROWS.
 * Reads only (the clan records and the strain registry are not written).
 */
function clansOf(sim: Sim): ClanBlock {
  const list: Clan[] = sim.clans.list.slice();
  list.sort((a, b) => Number(a.extinctTick >= 0) - Number(b.extinctTick >= 0) || a.id - b.id);
  const rows: ClanRow[] = list.slice(0, SNAPSHOT_DETAIL_ROWS).map((c) => ({
    id: c.id,
    name: c.name,
    strain: c.strain,
    strainName: sim.beings.strains.get(c.strain)?.name ?? '',
    species: clanSpeciesName(c),
    foundedTick: c.foundedTick,
    members: c.members,
    limit: c.limit,
    chief: c.chief,
    chiefAgeYears: c.chief >= 0 ? yearsSince(sim.tick, c.chiefBorn) : -1,
    extinct: c.extinctTick >= 0,
  }));
  return { count: list.length, living: list.filter((c) => c.extinctTick < 0).length, rows };
}

/**
 * Keeps the message under SNAPSHOT_MAX_BYTES by halving the longer of the two row lists (dominions,
 * hamlets) until it fits. The totals (dominionCount, hamletCount) stay exact; `truncated` says a cut happened.
 */
export function fitSnapshot(snap: Snapshot): Snapshot {
  let out = snap;
  // Map feeds go first (intrigues, then sprite feeds), then map marks and map points: the map simply draws without them.
  if (snapshotBytes(out) > SNAPSHOT_MAX_BYTES && out.mapIntrigues !== undefined) {
    const { mapIntrigues: _intrigues, ...rest } = out;
    out = { ...rest, truncated: true };
  }
  if (snapshotBytes(out) > SNAPSHOT_MAX_BYTES && out.mapBuildings !== undefined) {
    const { mapBuildings: _buildings, ...rest } = out;
    out = { ...rest, truncated: true };
  }
  if (snapshotBytes(out) > SNAPSHOT_MAX_BYTES && out.mapKinds !== undefined) {
    const { mapKinds: _kinds, ...rest } = out;
    out = { ...rest, truncated: true };
  }
  if (snapshotBytes(out) > SNAPSHOT_MAX_BYTES && out.mapMarks !== undefined) {
    const { mapMarks: _marks, ...rest } = out;
    out = { ...rest, truncated: true };
  }
  if (snapshotBytes(out) > SNAPSHOT_MAX_BYTES && out.mapPoints !== undefined) {
    const { mapPoints: _points, ...rest } = out;
    out = { ...rest, truncated: true };
  }
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

/**
 * Pact records (pacts window): every pact in the sim, in id order, capped in rows. The row names the
 * two founders and carries the members, power, renown and formation tick. Reads only.
 */
function pactsOf(sim: Sim): PactBlock {
  const pacts = pactsOfSim(sim);
  const byId = new Map(dominionsOfSim(sim).map((d) => [d.id, d]));
  const rows: PactRow[] = [];
  for (const p of pacts.slice(0, SNAPSHOT_DETAIL_ROWS)) {
    const a = p.founders[0];
    const b = p.founders[1];
    const da = byId.get(a);
    const db = byId.get(b);
    const members = [...p.memberIds];
    rows.push({
      id: p.id,
      name: p.name,
      a,
      b,
      nameA: `Dominion ${a}`,
      nameB: `Dominion ${b}`,
      strengthA: da?.strength ?? 0,
      strengthB: db?.strength ?? 0,
      parcelsA: da?.parcels.size ?? 0,
      parcelsB: db?.parcels.size ?? 0,
      members,
      power: members.reduce((sum, m) => sum + (byId.get(m)?.strength ?? 0), 0),
      renown: p.renown,
      formedTick: p.formedTick,
    });
  }
  return { count: pacts.length, rows };
}

function hamletsOfSim(sim: Sim): { hamlets: HamletRow[]; hamletCount: number } {
  const list = hamletsOf(sim);
  const rows: HamletRow[] = list.map((h, i) => ({
    name: `Hamlet ${i + 1}`,
    folk: h.folk,
    buildings: h.buildings.length,
    parcels: h.parcels.size,
    mood: hamletMood(h),
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
