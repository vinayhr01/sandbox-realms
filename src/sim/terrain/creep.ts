import { ground, groundId } from '../../content/grounds.ts';
import { CREEP_BURN_TICKS, CREEP_DECAY_PER_RUN, CREEP_DECAY_TICKS, CREEP_HUB_BY_ID, CREEP_PULSE_TICKS, CREEP_REALM_CAP, type CreepHubDef } from '../../content/creeps.ts';
import { FLAG } from '../realm.ts';
import { n4, n8 } from '../grid.ts';
import type { Sim } from '../sim.ts';
import { civilTiles } from '../settlements/hamlet.ts';
import { hamletsOf } from '../settlements/adapter.ts';
import { terrainState, type CreepHub, type TerrainState } from './state.ts';

/** Tiles under civil buildings, which creep never takes (18e 8 edge 3; 09 section 6). */
function civilOf(sim: Sim): Set<number> {
  return civilTiles(hamletsOf(sim), sim.realm.side);
}

/** Live hubs of the realm (18e 1.1 cap). */
function aliveCount(state: TerrainState): number {
  let n = 0;
  for (const h of state.hubs) if (h.alive) n++;
  return n;
}

/**
 * Whether tile j may take creep (18e 1.3 rule 3): walkable land that is not molten, rimeplate or
 * another creep, not burning, not guarded after acid (1.5), and not a hub tile.
 */
function eligible(sim: Sim, j: number, creepGround: number, civil: ReadonlySet<number>): boolean {
  const realm = sim.realm;
  const g = realm.ground[j] ?? 0;
  if (g === creepGround) return false;
  const kind = ground(g);
  if (kind.layer !== 'land' || kind.creep || g === groundId('rimeplate')) return false;
  if (realm.hasFlag(j, FLAG.burning)) return false;
  if (civil.has(j)) return false;
  const state = terrainState(sim);
  if ((state.creepGuard.get(j) ?? 0) > sim.tick) return false;
  return !state.hubs.some((h) => h.tile === j);
}

/**
 * Places a creep hub on tile `tile` (18e 1.7 placement). Refused when the realm cap is reached, when
 * the tile already holds a hub, or when no neighbour can take creep (`hint.no_room`).
 */
export function placeCreepHub(sim: Sim, tile: number, hubId: string): boolean {
  const def = CREEP_HUB_BY_ID.get(hubId);
  const state = terrainState(sim);
  if (!def || aliveCount(state) >= CREEP_REALM_CAP) return false;
  if (state.hubs.some((h) => h.alive && h.tile === tile)) return false;
  const creepGround = groundId(def.ground);
  const realm = sim.realm;
  const civil = civilOf(sim);
  let room = false;
  for (let k = 0; k < 4 && !room; k++) {
    const j = n4(tile, realm.side, k);
    if (j >= 0 && eligible(sim, j, creepGround, civil)) room = true;
  }
  if (!room) return false;
  state.hubs.push({ tile, def: hubId, tiles: new Set(), nextPulse: sim.tick + CREEP_PULSE_TICKS, alive: true });
  return true;
}

/**
 * A hub dies when its tile stops being land (flooded or molten: 18e 1.5 and 8 edge 2) or has burned for
 * CREEP_BURN_TICKS (18e 1.5). Both are checked per tick in creepStep.
 */
function hubLost(sim: Sim, hub: CreepHub): boolean {
  const realm = sim.realm;
  if (ground(realm.ground[hub.tile] ?? 0).layer !== 'land') return true;
  return realm.hasFlag(hub.tile, FLAG.burning) && sim.tick - (realm.fireStart[hub.tile] ?? 0) >= CREEP_BURN_TICKS;
}

/** Kills a hub. Its creep stays until decay clears it, and it never regrows (18e 1.6). */
export function removeCreepHub(sim: Sim, tile: number): boolean {
  const hub = terrainState(sim).hubs.find((h) => h.alive && h.tile === tile);
  if (!hub) return false;
  hub.alive = false;
  hub.nextPulse = Number.POSITIVE_INFINITY;
  return true;
}

/**
 * One pulse of a hub (18e 1.3): adds up to `spreadBatch` tiles drawn without replacement from the
 * frontier, weighted 3 for tiles with two or more connected creep neighbours and 1 otherwise.
 */
function pulse(sim: Sim, hub: CreepHub, def: CreepHubDef): void {
  const realm = sim.realm;
  const creepGround = groundId(def.ground);
  const room = def.maxSize - hub.tiles.size;
  if (room <= 0) return;
  const seen = new Set<number>();
  const cand: number[] = [];
  const weight: number[] = [];
  const sources = [hub.tile, ...hub.tiles];
  const civil = civilOf(sim);
  for (const s of sources) {
    for (let k = 0; k < 4; k++) {
      const j = n4(s, realm.side, k);
      if (j < 0 || seen.has(j)) continue;
      seen.add(j);
      if (!eligible(sim, j, creepGround, civil)) continue;
      let links = 0;
      for (let q = 0; q < 4; q++) {
        const m = n4(j, realm.side, q);
        if (m >= 0 && hub.tiles.has(m)) links++;
      }
      cand.push(j);
      weight.push(links >= 2 ? 3 : 1);
    }
  }
  const rng = sim.rng('creep');
  const draws = Math.min(def.spreadBatch, room);
  for (let d = 0; d < draws && cand.length > 0; d++) {
    let total = 0;
    for (const w of weight) total += w;
    let r = rng.int(total);
    let pick = 0;
    for (let c = 0; c < cand.length; c++) {
      r -= weight[c] ?? 0;
      if (r < 0) {
        pick = c;
        break;
      }
    }
    const j = cand[pick] ?? -1;
    cand.splice(pick, 1);
    weight.splice(pick, 1);
    if (j < 0) continue;
    realm.setCover(j, 0);
    realm.setGround(j, creepGround);
    if (def.clearsFlora && realm.flora[j] !== 0) realm.setFlora(j, 0, 0);
    hub.tiles.add(j);
  }
}

/**
 * Creep decay (18e 1.6): flood-fills n8 from a live hub through its own creep. Creep tiles not
 * reached are lowered to their `down` ground, at most three per run, chosen at random. Orphaned
 * creep of a dead hub has no seeds, so all of it decays.
 */
function decay(sim: Sim, hub: CreepHub, def: CreepHubDef): void {
  const realm = sim.realm;
  const creepGround = groundId(def.ground);
  for (const t of hub.tiles) {
    if ((realm.ground[t] ?? 0) !== creepGround) hub.tiles.delete(t);
  }
  const reached = new Set<number>();
  const queue: number[] = [];
  if (hub.alive) {
    for (let k = 0; k < 8; k++) {
      const j = n8(hub.tile, realm.side, k);
      if (j >= 0 && hub.tiles.has(j) && !reached.has(j)) {
        reached.add(j);
        queue.push(j);
      }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const s = queue[q] ?? -1;
    for (let k = 0; k < 8; k++) {
      const j = n8(s, realm.side, k);
      if (j >= 0 && hub.tiles.has(j) && !reached.has(j)) {
        reached.add(j);
        queue.push(j);
      }
    }
  }
  const unreached: number[] = [];
  for (const t of hub.tiles) if (!reached.has(t)) unreached.push(t);
  if (unreached.length === 0) return;
  const rng = sim.rng('creep');
  const down = ground(creepGround).down;
  for (let k = 0; k < CREEP_DECAY_PER_RUN && unreached.length > 0; k++) {
    const idx = rng.int(unreached.length);
    const t = unreached[idx] ?? -1;
    unreached.splice(idx, 1);
    hub.tiles.delete(t);
    if (down !== null) realm.setGround(t, groundId(down));
  }
}

/**
 * Creep step (18e 1.3 and 1.6), every tick: each live hub pulses when its timer is due; decay runs
 * every CREEP_DECAY_TICKS unless eternal_creep is on. Hubs that are dead and empty are dropped.
 */
export function creepStep(sim: Sim): void {
  const state = terrainState(sim);
  if (state.hubs.length === 0) return;
  for (const hub of state.hubs) {
    if (hub.alive && hubLost(sim, hub)) removeCreepHub(sim, hub.tile);
  }
  for (const hub of state.hubs) {
    const def = CREEP_HUB_BY_ID.get(hub.def);
    if (!def) continue;
    if (hub.alive && sim.tick >= hub.nextPulse) {
      if (!sim.rules.isOn('sanctuary_seal')) pulse(sim, hub, def);
      hub.nextPulse = sim.tick + CREEP_PULSE_TICKS;
    }
  }
  if (sim.due('creepDecay', CREEP_DECAY_TICKS) && !sim.rules.isOn('eternal_creep')) {
    for (const hub of state.hubs) {
      const def = CREEP_HUB_BY_ID.get(hub.def);
      if (def) decay(sim, hub, def);
    }
  }
  state.hubs = state.hubs.filter((h) => h.alive || h.tiles.size > 0);
}

/** Creep tiles grown by live hubs (for tests and the inspect panel). */
export function creepTiles(sim: Sim): number {
  let n = 0;
  for (const h of terrainState(sim).hubs) if (h.alive) n += h.tiles.size;
  return n;
}
