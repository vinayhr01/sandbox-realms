/**
 * Sim-side wiring for the lifetime stats (14). The sim owns `lifetime` and `unlocked`; systems
 * report what happened through recordStat, and the sim observes its own state once per sim-second
 * and checks achievements. Nothing here draws randomness or writes sim state, so counting never
 * alters the outcome (the state hash does not include `lifetime` or `unlocked`).
 *
 * Observation keeps its own bookkeeping (previous values, per-being counters) in a WeakMap keyed
 * by the sim. Heavy scans are spread over the sim-seconds so no single tick pays for all of them.
 */
import { YEAR_TICKS } from '../shared/constants.ts';
import { BIOMES, biomeOfCover } from '../content/biomes.ts';
import { G } from '../content/grounds.ts';
import { SS_TICKS } from './clock.ts';
import { dominionState, pactsOfSim } from './dominions/adapter.ts';
import { hamletsOf } from './settlements/adapter.ts';
import { recordEvent, evaluateAchievements, type StatsEvent } from './stats.ts';
import type { Sim } from './sim.ts';

/** Sim-seconds a summit or campaign window spans for the 10-second scans. */
const SCAN_SECONDS = 10;
/** Summit regions are only traced once this many pinnacle tiles exist (smaller regions cannot qualify). */
const SUMMIT_MIN = 30;
/** Share of land that counts as deep freeze (14 section 4, 44). */
const FREEZE_SHARE = 0.6;

interface Observed {
  polls: number;
  hamlets: number;
  ages: Set<string>;
  campaign: Map<number, { since: number; target: number }>;
  /** Pact ids already counted as made; null until the first observation (pacts loaded from a save are not new). */
  pactIds: Set<number> | null;
  resolvedIntrigues: Set<number>;
  below: Uint8Array;
  drops: Uint16Array;
  generation: Uint32Array;
  skyTicks: number[];
  frozenTicks: number;
  flora: number;
  summit: Uint8Array;
  stack: Int32Array;
}

const states = new WeakMap<Sim, Observed>();

function stateOf(sim: Sim): Observed {
  let s = states.get(sim);
  if (!s) {
    const cap = sim.beings.store.capacity;
    const n = sim.realm.side * sim.realm.side;
    s = {
      polls: 0,
      hamlets: 0,
      ages: new Set(),
      campaign: new Map(),
      pactIds: null,
      resolvedIntrigues: new Set(),
      below: new Uint8Array(cap),
      drops: new Uint16Array(cap),
      generation: new Uint32Array(cap),
      skyTicks: [],
      frozenTicks: 0,
      flora: 0,
      summit: new Uint8Array(n),
      stack: new Int32Array(n),
    };
    states.set(sim, s);
  }
  return s;
}

/** Counts one event into the sim's lifetime record. */
export function recordStat(sim: Sim, event: StatsEvent): void {
  recordEvent(sim.lifetime, event);
  if (event.kind === 'calamity.fired' && event.calamity === 'skyfall' && !event.auto) {
    // Ten skystones within one minute (14 section 4, 41): keep the ticks of the last minute.
    const st = stateOf(sim);
    st.skyTicks.push(sim.tick);
    while (st.skyTicks.length > 0 && (st.skyTicks[0] ?? 0) < sim.tick - 60 * SS_TICKS) st.skyTicks.shift();
    recordEvent(sim.lifetime, { kind: 'gauge.max', name: 'skyfallBurstMax', value: st.skyTicks.length });
  }
}

/**
 * Runs once per sim-second: emits sim years and observed events, refreshes the gauges, then
 * unlocks every achievement whose value now reaches its target. Each id is added to the unlocked
 * set once and never removed. Returns the ids that unlocked on this call, in catalogue order.
 */
export function unlockAchievements(sim: Sim): string[] {
  const years = Math.floor(sim.tick / YEAR_TICKS);
  const counted = sim.lifetime.counters['simYearsElapsed'] ?? 0;
  for (let y = counted; y < years; y++) recordEvent(sim.lifetime, { kind: 'sim.year' });
  observeWorld(sim);
  const fresh = evaluateAchievements(sim.lifetime, sim.unlocked);
  for (const id of fresh) sim.unlocked.add(id);
  return fresh;
}

/** Reads the sim (never writes it) into counters and gauges. Called once per sim-second. */
function observeWorld(sim: Sim): void {
  const st = stateOf(sim);
  const s = sim.lifetime;
  const round = st.polls % SCAN_SECONDS;
  st.polls++;

  // Every sim-second: ages, hamlets, campaigns, pacts, beings, fire and lava.
  recordEvent(s, { kind: 'age.reached', age: sim.ages.current });
  observeHamlets(sim, st);
  observeDominions(sim, st);
  observeIntrigues(sim, st);
  observeBeings(sim, st);
  recordEvent(s, { kind: 'gauge.max', name: 'burningTilesMax', value: sim.realm.burning.size });
  recordEvent(s, { kind: 'gauge.max', name: 'lavaTilesMax', value: sim.realm.molten.size });

  // Spread the full-map scans over the seconds, one per second, so no tick pays for all of them.
  if (round === 0) summitRegions(sim, st);
  if (round === 3) landShares(sim, st);
  if (round === 6) floraGrowth(sim, st);
}

function observeHamlets(sim: Sim, st: Observed): void {
  const hamlets = hamletsOf(sim);
  const s = sim.lifetime;
  if (hamlets.length > st.hamlets) recordEvent(s, { kind: 'counter.add', name: 'hamletsFounded', by: hamlets.length - st.hamlets });
  if (hamlets.length < st.hamlets) recordEvent(s, { kind: 'counter.add', name: 'hamletsDestroyed', by: st.hamlets - hamlets.length });
  st.hamlets = hamlets.length;
  let most = 0;
  for (const h of hamlets) most = Math.max(most, h.folk);
  recordEvent(s, { kind: 'gauge.max', name: 'hamletPopulationMax', value: most });
}

function observeDominions(sim: Sim, st: Observed): void {
  const ds = dominionState(sim);
  const s = sim.lifetime;
  let ongoing = 0;
  let longest = 0;
  for (const d of ds.dominions) {
    const prev = st.campaign.get(d.id);
    const active = d.campaignSince >= 0;
    if (active) {
      ongoing++;
      longest = Math.max(longest, Math.floor((sim.tick - d.campaignSince) / YEAR_TICKS));
    }
    const prevActive = prev !== undefined && prev.since >= 0;
    if (active && (!prevActive || prev.since !== d.campaignSince)) recordEvent(s, { kind: 'campaign.started' });
    if (!active && prevActive) {
      const target = prev.target;
      const byTreaty = target >= 0 && ds.relations.get(d.id, target) === 'peace';
      recordEvent(s, { kind: 'campaign.ended', byTreaty });
    }
    st.campaign.set(d.id, { since: d.campaignSince, target: d.target });
  }
  recordEvent(s, { kind: 'gauge.max', name: 'campaignsOngoingMax', value: ongoing });
  recordEvent(s, { kind: 'gauge.max', name: 'campaignYearsMax', value: longest });

  // Pacts: a pact record seen for the first time is a pact made; the largest pact is the size gauge.
  const pacts = pactsOfSim(sim);
  const seen = st.pactIds ?? new Set<number>();
  const first = st.pactIds === null;
  let members = 0;
  for (const p of pacts) {
    if (!seen.has(p.id) && !first) recordEvent(s, { kind: 'pact.made' });
    seen.add(p.id);
    members = Math.max(members, p.memberIds.length);
  }
  st.pactIds = seen;
  recordEvent(s, { kind: 'gauge.max', name: 'pactMembersMax', value: members });
}

function observeIntrigues(sim: Sim, st: Observed): void {
  for (const it of sim.culture.intrigues) {
    if (it.outcome !== 'success' || st.resolvedIntrigues.has(it.id)) continue;
    st.resolvedIntrigues.add(it.id);
    recordEvent(sim.lifetime, { kind: 'counter.add', name: 'intriguesSucceeded' });
    if (it.kind === 'rebellion') recordEvent(sim.lifetime, { kind: 'counter.add', name: 'hamletsRebelled' });
  }
}

/** Per-being life and health observations, plus per-species population (strain proxy). */
function observeBeings(sim: Sim, st: Observed): void {
  const store = sim.beings.store;
  const s = sim.lifetime;
  const perSpecies = new Map<number, number>();
  let oldest = 0;
  let worstDrops = 0;
  for (let k = 0; k < store.size; k++) {
    const slot = store.at(k);
    if (store.generation[slot] !== st.generation[slot]) {
      st.generation[slot] = store.generation[slot] ?? 0;
      st.below[slot] = 0;
      st.drops[slot] = 0;
    }
    const species = store.species[slot] ?? 0;
    perSpecies.set(species, (perSpecies.get(species) ?? 0) + 1);
    oldest = Math.max(oldest, Math.floor((sim.tick - (store.born[slot] ?? 0)) / YEAR_TICKS));
    const maxVit = store.maxVit[slot] ?? 0;
    const low = maxVit > 0 && (store.vit[slot] ?? 0) < maxVit * 0.1 ? 1 : 0;
    if (low === 1 && st.below[slot] === 0) st.drops[slot] = (st.drops[slot] ?? 0) + 1;
    st.below[slot] = low;
    worstDrops = Math.max(worstDrops, st.drops[slot] ?? 0);
  }
  let most = 0;
  for (const n of perSpecies.values()) most = Math.max(most, n);
  recordEvent(s, { kind: 'gauge.max', name: 'oldestYears', value: oldest });
  recordEvent(s, { kind: 'gauge.max', name: 'strainPopulationMax', value: most });
  recordEvent(s, { kind: 'gauge.max', name: 'lowHealthDropsMax', value: worstDrops });
}

/** Largest 4-connected region of pinnacle tiles (14 section 4, 9). */
function summitRegions(sim: Sim, st: Observed): void {
  const r = sim.realm;
  const side = r.side;
  const n = side * side;
  let count = 0;
  for (let i = 0; i < n; i++) if (r.ground[i] === G.pinnacle) count++;
  if (count < SUMMIT_MIN) return;
  const seen = st.summit;
  const stack = st.stack;
  seen.fill(0);
  let best = 0;
  for (let start = 0; start < n; start++) {
    if (seen[start] !== 0 || r.ground[start] !== G.pinnacle) continue;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top] ?? 0;
      size++;
      const x = i % side;
      if (x > 0 && seen[i - 1] === 0 && r.ground[i - 1] === G.pinnacle) {
        seen[i - 1] = 1;
        stack[top++] = i - 1;
      }
      if (x < side - 1 && seen[i + 1] === 0 && r.ground[i + 1] === G.pinnacle) {
        seen[i + 1] = 1;
        stack[top++] = i + 1;
      }
      if (i >= side && seen[i - side] === 0 && r.ground[i - side] === G.pinnacle) {
        seen[i - side] = 1;
        stack[top++] = i - side;
      }
      if (i < n - side && seen[i + side] === 0 && r.ground[i + side] === G.pinnacle) {
        seen[i + side] = 1;
        stack[top++] = i + side;
      }
    }
    if (size > best) best = size;
  }
  recordEvent(sim.lifetime, { kind: 'gauge.max', name: 'summitRegionMax', value: best });
}

/** Land share checks: ashen cover (36) and deep freeze held for 100 years (44). */
function landShares(sim: Sim, st: Observed): void {
  const r = sim.realm;
  const n = r.side * r.side;
  const ashen = new Set(BIOMES.flatMap((b, idx) => (b.id === 'ashbarren' || b.id === 'cinderfields' ? [idx] : [])));
  let land = 0;
  let waste = 0;
  for (let i = 0; i < n; i++) {
    if ((r.ground[i] ?? 0) < G.strand) continue;
    land++;
    const idx = biomeOfCover(r.cover[i] ?? 0);
    if (idx >= 0 && ashen.has(idx)) waste++;
  }
  if (land === 0) return;
  recordEvent(sim.lifetime, { kind: 'gauge.max', name: 'ashenPercentMax', value: Math.floor((waste * 100) / land) });

  if (r.frozen.size / land >= FREEZE_SHARE) st.frozenTicks += SCAN_SECONDS * SS_TICKS;
  else st.frozenTicks = 0;
  recordEvent(sim.lifetime, { kind: 'gauge.max', name: 'deepFreezeYearsMax', value: Math.floor(st.frozenTicks / YEAR_TICKS) });
}

/** Plants that appeared since the last scan (In Bloom, 46); counts net growth between scans. */
function floraGrowth(sim: Sim, st: Observed): void {
  const flora = sim.realm.flora;
  let now = 0;
  for (let i = 0; i < flora.length; i++) if ((flora[i] ?? 0) !== 0) now++;
  if (now > st.flora) recordEvent(sim.lifetime, { kind: 'counter.add', name: 'floraGrown', by: now - st.flora });
  st.flora = now;
}
