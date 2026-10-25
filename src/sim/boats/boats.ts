import type { Realm } from '../realm.ts';
import type { Rng } from '../../shared/rng.ts';
import { MAP_BOAT_CAP, type MapBoat } from '../../shared/protocol.ts';
import { N8X, N8Y } from '../grid.ts';
import { foodCapacity, type Hamlet } from '../settlements/hamlet.ts';
import { accessTiles, dockPool, oceanPoolAt } from './docks.ts';
import { BOAT_TYPE_BY_KIND, SPEED_PER_TILE, type BoatKind } from './types.ts';

/**
 * Boat entities (10 section 13): docks come from hamlet buildings that carry `boatTypes`, boats are built at a
 * dock on a fixed period, sail on ocean tiles of their pool, trade with other docks, fish near home and unload
 * at home, and trading boats fire on enemy boats in reach. Transport boats (passengers) are still not built: no
 * dock lists them yet, and their passengers are not modelled (DECISIONS.md "Boats build 3"). The sim runs
 * `boatsStep` once per sim-second; nothing calls it yet (no hook in sim.ts).
 *
 * State lives beside the Sim (a WeakMap keyed by the host), like the settlements state, and is saved as
 * chronicle tag 21 only when a boat or a dock build timer exists.
 */

/** Ticks between dock build checks (10 section 13 produceBoat: every 200 ticks; TUNE). */
export const BOAT_PERIOD = 200;
/** Ticks one boatsStep call stands for (one sim-second). */
export const STEP_TICKS = 20;
/** Gold a finished trade visit adds to the boat's cargo (10 section 13: +5). */
export const TRADE_GOLD = 5;
/** Ticks a trading boat stays in a foreign port (10 section 13: 40 to 100; drawn per trip). */
export const TRADE_STAY_MIN = 40;
export const TRADE_STAY_MAX = 100;
/** Food a fishing trip lands, and the ticks spent on the grounds (TUNE; the spec's fish count is not in the sim). */
export const FISH_FOOD = 5;
export const FISH_STAY = 60;
/** Fishing grounds lie within this many tiles of the home dock (TUNE). */
export const FISH_RANGE = 8;
/** Ticks a boat with no home dock lasts before it explodes (10 section 13: two months, Month = 100 ticks). */
export const ORPHAN_LIMIT = 200;
/** Hull hp a boat repairs per pass at home (10 section 13: up to 100 per pass; TUNE, no cost). */
export const REPAIR_PER_PASS = 100;
/** A hit boat below this share of its max hp returns to its home dock (10 section 13 boatDanger: 25%). */
export const DANGER_HP_FRACTION = 0.25;
/** Chebyshev tiles a trading boat can fire across (TUNE; the spec gives no range). */
export const ATTACK_RANGE = 8;
/** Hull damage of one cannonball volley, one volley per sim-second (TUNE; the spec gives no damage). */
export const CANNON_DAMAGE = 40;

export type BoatTrip = 'idle' | 'trade' | 'fish' | 'home';

/** One boat. Tiles are indices (y * side + x). `wait` is -1 while sailing, else the ticks left in port. */
export interface Boat {
  id: number;
  kind: BoatKind;
  x: number;
  y: number;
  hp: number;
  /** Origin tile of the home dock (the building), or -1 when none was ever found. */
  home: number;
  /** Tile the boat lies at when berthed at home (an ocean access tile of the home dock). */
  berth: number;
  trip: BoatTrip;
  /** Destination tile, or -1. */
  target: number;
  wait: number;
  /** Fractional tile moves banked from speed. */
  progress: number;
  cargoGold: number;
  cargoFood: number;
  /** Ticks spent without a home dock. */
  orphan: number;
  /** Set when an enemy volley hit the boat; read by the danger decision on the next step. Absent when not hit. */
  hit?: boolean;
  /** Planned route to `target` (tile indices, last entry is the target), from the path search of a blocked boat. */
  path?: number[];
}

/** Saved form of the boat state (chronicle tag 21). `builds` holds [dock tile, tick of the next build check]. */
export interface BoatSave {
  nextId: number;
  boats: Boat[];
  builds: [number, number][];
}

interface BoatState {
  nextId: number;
  boats: Boat[];
  builds: Map<number, number>;
}

/** What the boat step needs from its host (the Sim satisfies it). */
export interface BoatHost {
  readonly realm: Realm;
  readonly tick: number;
  rng(name: string): Rng;
}

const states = new WeakMap<object, BoatState>();

function stateOf(host: BoatHost): BoatState {
  let s = states.get(host);
  if (!s) {
    s = { nextId: 1, boats: [], builds: new Map() };
    states.set(host, s);
  }
  return s;
}

/** A dock building found in the hamlets this step. */
interface Dock {
  tile: number;
  x: number;
  y: number;
  kinds: readonly BoatKind[];
  hamlet: Hamlet;
  pool: number;
}

interface StepCtx {
  realm: Realm;
  rng: Rng;
  docks: readonly Dock[];
  boats: readonly Boat[];
  mayTrade: (a: Hamlet, b: Hamlet) => boolean;
  isEnemy: (a: Hamlet, b: Hamlet) => boolean;
}

function docksOf(realm: Realm, hamlets: readonly Hamlet[]): Dock[] {
  const out: Dock[] = [];
  for (const h of hamlets) {
    for (const b of h.buildings) {
      const kinds = b.def.boatTypes;
      if (!kinds || kinds.length === 0) continue;
      const pool = dockPool(realm, b.x, b.y, b.def.footprint, b.def.height ?? b.def.footprint);
      if (pool < 0) continue;
      out.push({ tile: b.y * realm.side + b.x, x: b.x, y: b.y, kinds, hamlet: h, pool });
    }
  }
  return out.sort((a, b) => a.tile - b.tile);
}

/** A berth of the dock in the given pool, or -1. */
function berthOf(realm: Realm, dock: Dock, pool: number): number {
  return accessTiles(realm, dock.x, dock.y).find((t) => oceanPoolAt(realm, t % realm.side, Math.floor(t / realm.side)) === pool) ?? -1;
}

/**
 * Build check at one dock (10 section 13 produceBoat): a random type from the dock's list, skipped when the dock
 * already has a boat of that type, the hamlet cannot pay (wood, iron and gold), or no berth is free of the dock's
 * pool. The boat spawns on a random berth and the hamlet pays all three costs.
 */
function produce(host: BoatHost, st: BoatState, dock: Dock, rng: Rng): void {
  const kind = dock.kinds[rng.int(dock.kinds.length)];
  if (!kind) return;
  const def = BOAT_TYPE_BY_KIND.get(kind);
  if (!def) return;
  if (st.boats.some((b) => b.home === dock.tile && b.kind === kind)) return;
  const h = dock.hamlet;
  if (h.wood < def.wood || h.gold < def.gold || h.iron < def.iron) return;
  const berths = accessTiles(host.realm, dock.x, dock.y).filter((t) => oceanPoolAt(host.realm, t % host.realm.side, Math.floor(t / host.realm.side)) === dock.pool);
  if (berths.length === 0) return;
  const berth = berths[rng.int(berths.length)] ?? berths[0] ?? -1;
  h.wood -= def.wood;
  h.gold -= def.gold;
  h.iron -= def.iron;
  const side = host.realm.side;
  st.boats.push({
    id: st.nextId++,
    kind,
    x: berth % side,
    y: Math.floor(berth / side),
    hp: def.hp,
    home: dock.tile,
    berth,
    trip: 'idle',
    target: -1,
    wait: -1,
    progress: 0,
    cargoGold: 0,
    cargoFood: 0,
    orphan: 0,
  });
}

/** True when tiles a and b are distinct and touch on the 8-way grid. */
function touches(side: number, a: number, b: number): boolean {
  return a !== b && Math.abs((a % side) - (b % side)) <= 1 && Math.abs(Math.floor(a / side) - Math.floor(b / side)) <= 1;
}

/**
 * Path search for a blocked boat (10 section 13, DECISIONS "Boats build 3"): breadth first over sea tiles of one
 * pool, 8-way, in N8X/N8Y order so the result is the same on every run. Returns the tiles after `from` up to and
 * including `to`, or null when no sea route of that pool joins them. Reads only; draws no randomness.
 */
export function findSeaPath(realm: Realm, from: number, to: number, pool: number): number[] | null {
  if (from === to) return [];
  const side = realm.side;
  const cells = side * side;
  if (from < 0 || to < 0 || from >= cells || to >= cells) return null;
  const prev = new Int32Array(cells).fill(-2);
  const queue = new Int32Array(cells);
  prev[from] = -1;
  queue[0] = from;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const cur = queue[head++] ?? -1;
    if (cur === to) break;
    const cx = cur % side;
    const cy = Math.floor(cur / side);
    for (let k = 0; k < 8; k++) {
      const nx = cx + (N8X[k] ?? 0);
      const ny = cy + (N8Y[k] ?? 0);
      if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
      const idx = ny * side + nx;
      if (prev[idx] !== -2) continue;
      if (oceanPoolAt(realm, nx, ny) !== pool) continue;
      prev[idx] = cur;
      queue[tail++] = idx;
    }
  }
  if (prev[to] === -2) return null;
  const path: number[] = [];
  for (let c = to; c !== from; c = prev[c] ?? -1) path.push(c);
  return path.reverse();
}

/** Next tile of the planned route when it is still valid: it ends at the target, touches the boat and is sea of the pool. */
function routeStep(realm: Realm, b: Boat, pool: number): number {
  const route = b.path;
  if (!route || route.length === 0) return -1;
  const side = realm.side;
  const next = route[0] ?? -1;
  if (route[route.length - 1] !== b.target || !touches(side, b.y * side + b.x, next)) return -1;
  return oceanPoolAt(realm, next % side, Math.floor(next / side)) === pool ? next : -1;
}

/** Greedy step: the sea neighbour strictly closer (Chebyshev) to the target, or -1. */
function greedyStep(realm: Realm, b: Boat, pool: number, tx: number, ty: number): number {
  const side = realm.side;
  const dist = (x: number, y: number): number => Math.max(Math.abs(x - tx), Math.abs(y - ty));
  let best = -1;
  let bestD = dist(b.x, b.y);
  for (let k = 0; k < 8; k++) {
    const nx = b.x + (N8X[k] ?? 0);
    const ny = b.y + (N8Y[k] ?? 0);
    if (oceanPoolAt(realm, nx, ny) !== pool) continue;
    const d = dist(nx, ny);
    if (d < bestD) {
      bestD = d;
      best = ny * side + nx;
    }
  }
  return best;
}

/**
 * Moves the boat toward its target, one tile per whole unit banked from speed. A valid planned route is followed
 * first; otherwise the greedy step; when both are stuck the path search plans a route. Blocked only when no sea
 * route of the pool reaches the target.
 */
function sail(ctx: StepCtx, b: Boat, pool: number, speed: number): 'arrived' | 'moving' | 'blocked' {
  const side = ctx.realm.side;
  const tx = b.target % side;
  const ty = Math.floor(b.target / side);
  b.progress += speed / SPEED_PER_TILE;
  while (b.progress >= 1) {
    if (b.x === tx && b.y === ty) break;
    let next = routeStep(ctx.realm, b, pool);
    if (next >= 0) {
      b.path = b.path?.slice(1);
    } else {
      next = greedyStep(ctx.realm, b, pool, tx, ty);
      if (next >= 0) {
        b.path = undefined;
      } else {
        const route = findSeaPath(ctx.realm, b.y * side + b.x, b.target, pool);
        if (!route || route.length === 0) {
          b.progress = 0;
          b.path = undefined;
          return 'blocked';
        }
        next = route[0] ?? -1;
        b.path = route.slice(1);
      }
    }
    b.x = next % side;
    b.y = Math.floor(next / side);
    b.progress -= 1;
  }
  return b.x === tx && b.y === ty ? 'arrived' : 'moving';
}

/** Sends the boat home (its berth at the home dock), or leaves it idle when the home dock is gone. */
function goHome(ctx: StepCtx, b: Boat, pool: number): void {
  const home = ctx.docks.find((d) => d.tile === b.home);
  const berth = home ? berthOf(ctx.realm, home, pool) : -1;
  if (berth < 0) {
    b.trip = 'idle';
    b.target = -1;
    return;
  }
  b.berth = berth;
  b.trip = 'home';
  b.target = berth;
  b.wait = -1;
}

/** Unloads cargo into the home hamlet's stock (gold, and food up to the store cap) and repairs the hull. */
function unload(b: Boat, hamlet: Hamlet, maxHp: number): void {
  hamlet.gold += b.cargoGold;
  hamlet.food = Math.min(foodCapacity(hamlet), hamlet.food + b.cargoFood);
  b.cargoGold = 0;
  b.cargoFood = 0;
  b.hp = Math.min(maxHp, b.hp + REPAIR_PER_PASS);
}

/** Picks a fishing ground near the home dock: a random tile within FISH_RANGE in the boat's pool. Null when none is found. */
function fishingGround(ctx: StepCtx, home: Dock, pool: number): number | null {
  const side = ctx.realm.side;
  const span = FISH_RANGE * 2 + 1;
  for (let tries = 0; tries < 8; tries++) {
    const x = home.x + ctx.rng.int(span) - FISH_RANGE;
    const y = home.y + ctx.rng.int(span) - FISH_RANGE;
    if (oceanPoolAt(ctx.realm, x, y) === pool) return y * side + x;
  }
  return null;
}

/** Picks a random dock of the same pool, other than home, whose hamlet may trade with the home hamlet. */
function tradePartner(ctx: StepCtx, home: Dock, pool: number): { tile: number; berth: number } | null {
  const options = ctx.docks.filter((d) => d.tile !== home.tile && d.pool === pool && ctx.mayTrade(home.hamlet, d.hamlet));
  if (options.length === 0) return null;
  const pick = options[ctx.rng.int(options.length)];
  if (!pick) return null;
  const berth = berthOf(ctx.realm, pick, pool);
  return berth < 0 ? null : { tile: pick.tile, berth };
}

/** One boat's sim-second. Returns false when the boat is removed (on land, or orphaned past ORPHAN_LIMIT). */
function stepBoat(ctx: StepCtx, b: Boat): boolean {
  const pool = oceanPoolAt(ctx.realm, b.x, b.y);
  if (pool < 0) return false;
  const def = BOAT_TYPE_BY_KIND.get(b.kind);
  if (!def) return false;

  // Home dock: adopt the first usable dock of the pool when the home is gone or full (10 section 13).
  let home = ctx.docks.find((d) => d.tile === b.home && d.kinds.includes(b.kind));
  if (!home) {
    const next = ctx.docks.find((d) => d.pool === pool && d.kinds.includes(b.kind) && !ctx.boats.some((o) => o !== b && o.home === d.tile && o.kind === b.kind));
    if (next) {
      home = next;
      b.home = next.tile;
      b.orphan = 0;
    } else {
      b.orphan += STEP_TICKS;
      if (b.orphan >= ORPHAN_LIMIT) return false;
    }
  }

  // Danger (10 section 13 boatDanger): a boat hit by an enemy volley and below 25% hp goes back to its dock.
  if (b.hit) {
    b.hit = false;
    if (home && b.trip !== 'home' && b.hp < def.hp * DANGER_HP_FRACTION) goHome(ctx, b, pool);
  }

  if (b.trip === 'idle') {
    if (!home) return true;
    if (b.target < 0 && b.x === b.berth % ctx.realm.side && b.y === Math.floor(b.berth / ctx.realm.side)) {
      // Berthed: repair, then choose a trip. Fishing repeats while the store has room for food.
      b.hp = Math.min(def.hp, b.hp + REPAIR_PER_PASS);
      if (b.kind === 'fishing' && home.hamlet.food < foodCapacity(home.hamlet)) {
        const ground = fishingGround(ctx, home, pool);
        if (ground !== null) {
          b.trip = 'fish';
          b.target = ground;
          b.wait = -1;
        }
      } else if (b.kind === 'trading') {
        const partner = tradePartner(ctx, home, pool);
        if (partner) {
          b.trip = 'trade';
          b.target = partner.berth;
          b.wait = -1;
        }
      }
    }
    return true;
  }

  if (b.trip === 'home') {
    const r = sail(ctx, b, pool, def.speed);
    if (r === 'blocked') return true;
    if (r === 'arrived' && home) {
      unload(b, home.hamlet, def.hp);
      b.trip = 'idle';
      b.target = -1;
    }
    return true;
  }

  // Trade and fish: sail out, stay, then bring the cargo home.
  if (b.wait < 0) {
    const r = sail(ctx, b, pool, def.speed);
    if (r === 'blocked') goHome(ctx, b, pool);
    else if (r === 'arrived') {
      if (b.trip === 'trade') b.wait = TRADE_STAY_MIN + ctx.rng.int(TRADE_STAY_MAX - TRADE_STAY_MIN + 1);
      else b.wait = FISH_STAY;
    }
    return true;
  }
  b.wait -= STEP_TICKS;
  if (b.wait <= 0) {
    if (b.trip === 'trade') b.cargoGold += TRADE_GOLD;
    else b.cargoFood += FISH_FOOD;
    goHome(ctx, b, pool);
  }
  return true;
}

/** The hamlet a boat belongs to: its home dock's hamlet, or null when the boat has no home dock. */
function homeHamletOf(ctx: StepCtx, b: Boat): Hamlet | null {
  return ctx.docks.find((d) => d.tile === b.home)?.hamlet ?? null;
}

/**
 * Cannon volleys (10 section 13: trading boats carry a cannonball attack). Each trading boat under way (not idle
 * at a berth, not in a foreign port) fires once at the nearest enemy boat of its pool within ATTACK_RANGE. A hit
 * sets the target's `hit` flag and costs CANNON_DAMAGE hp; the danger decision reads the flag on the next step.
 * Boats are visited in id order and ties on distance go to the earlier id, so the result is deterministic.
 */
function attackPass(ctx: StepCtx, boats: readonly Boat[]): void {
  for (const a of boats) {
    const def = BOAT_TYPE_BY_KIND.get(a.kind);
    if (!def?.attack || a.hp <= 0 || a.trip === 'idle' || a.wait >= 0) continue;
    const mine = homeHamletOf(ctx, a);
    const pool = oceanPoolAt(ctx.realm, a.x, a.y);
    if (!mine || pool < 0) continue;
    let best: Boat | null = null;
    let bestD = Infinity;
    for (const o of boats) {
      if (o === a || o.hp <= 0) continue;
      const d = Math.max(Math.abs(o.x - a.x), Math.abs(o.y - a.y));
      if (d > ATTACK_RANGE || d >= bestD) continue;
      if (oceanPoolAt(ctx.realm, o.x, o.y) !== pool) continue;
      const theirs = homeHamletOf(ctx, o);
      if (!theirs || !ctx.isEnemy(mine, theirs)) continue;
      best = o;
      bestD = d;
    }
    if (best) {
      best.hp -= CANNON_DAMAGE;
      best.hit = true;
    }
  }
}

/**
 * One boat step (once per sim-second). Each dock whose build check is due tries to produce a boat (dock order by
 * tile), then every boat moves in id order, then trading boats fire and boats whose hp reached 0 are removed.
 * `mayTrade` says whether two hamlets may trade (dominion rules, supplied by the caller; relations never weight
 * trade). `isEnemy` says whether two hamlets are at war (caller's dominion rules); the default is no enemies, so
 * no boat fires. Draws only from the 'boats' stream.
 */
export function boatsStep(
  host: BoatHost,
  hamlets: readonly Hamlet[],
  mayTrade: (a: Hamlet, b: Hamlet) => boolean = () => true,
  isEnemy: (a: Hamlet, b: Hamlet) => boolean = () => false,
): void {
  const realm = host.realm;
  const docks = docksOf(realm, hamlets);
  const st = stateOf(host);
  const rng = host.rng('boats');
  for (const tile of [...st.builds.keys()]) if (!docks.some((d) => d.tile === tile)) st.builds.delete(tile);
  for (const d of docks) {
    const due = st.builds.get(d.tile);
    if (due === undefined) {
      st.builds.set(d.tile, host.tick + BOAT_PERIOD);
    } else if (host.tick >= due) {
      st.builds.set(d.tile, host.tick + BOAT_PERIOD);
      produce(host, st, d, rng);
    }
  }
  const ctx: StepCtx = { realm, rng, docks, boats: st.boats, mayTrade, isEnemy };
  st.boats = st.boats.filter((b) => stepBoat(ctx, b));
  attackPass(ctx, st.boats);
  st.boats = st.boats.filter((b) => b.hp > 0);
}

/** Plain copy of the boat state, or null when there is nothing to save (no boats and no dock timers). */
export function snapshotBoats(host: BoatHost): BoatSave | null {
  const st = states.get(host);
  if (!st || (st.boats.length === 0 && st.builds.size === 0)) return null;
  return { nextId: st.nextId, boats: st.boats.map((b) => ({ ...b })), builds: [...st.builds.entries()] };
}

/** Replaces the boat state with a checked save (Chronicle load). */
export function restoreBoats(host: BoatHost, save: BoatSave): void {
  states.set(host, { nextId: save.nextId, boats: save.boats.map((b) => ({ ...b })), builds: new Map(save.builds) });
}

/** Boats for the map feed (src/render/marks.ts): id, kind and tile, capped at MAP_BOAT_CAP. Reads only. */
export function boatMarksOf(host: BoatHost): MapBoat[] {
  const st = states.get(host);
  if (!st) return [];
  return st.boats.slice(0, MAP_BOAT_CAP).map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y }));
}
