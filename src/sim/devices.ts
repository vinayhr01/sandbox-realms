/**
 * Device grounds (04 section 8.4, 18e section 5). The four device bombs of 12 section 8.6 (havoc_powder,
 * havoc_timed, havoc_hidden, havoc_sparkler) place a device ground that detonates later instead of at once.
 *
 * Triggers, checked each tick from the projectile step (projectiles.ts shootStep):
 * - thunderpowder: fire on its tile or beside it (n4). Blast radius 9 (18c).
 * - timedpowder: 100 ticks (5 s, 04 8.1) after its own tile ignites. Blast radius 7 (18c).
 * - hidden_charge: a Being stands on its tile, or a projectile lands there (deviceStruck). Blast radius 6 (18e).
 * - festive_glimmer: fire on or beside it. Its fireworks have no sim effect, so it is spent with no blast.
 * A blast device also detonates the blast devices it touches (n4, 04 8.4), at most CHAIN_LIMIT per trigger.
 * Each blast is the `blast` profile of 04 8.1 with the device radius, through detonateBomb (handlers.ts).
 * A detonation the guard refuses leaves its device in place. Nothing here draws randomness.
 *
 * The registry is read from the realm's grounds once a second, so a loaded realm keeps its devices. The
 * ground a device replaced is not saved: a device found with no record is restored to `lowloam` when it
 * goes off, and an armed timer is not saved (an ignited timed device is armed again by the next scan that
 * sees it burn).
 */
import type { Sim } from '../sim.ts';
import { BOMB_PROFILE_BY_ID, type BombProfile } from '../content/powers.ts';
import { ground, groundId } from '../content/grounds.ts';

export type DeviceKind = 'thunderpowder' | 'timedpowder' | 'hidden_charge' | 'festive_glimmer';

/** Runs one blast profile at a tile; false when the guard refuses it. Supplied by the caller (handlers.ts detonateBomb). */
export type DeviceDetonator = (sim: Sim, prof: BombProfile, x: number, y: number) => boolean;

const DEVICE_KINDS: readonly DeviceKind[] = ['thunderpowder', 'timedpowder', 'hidden_charge', 'festive_glimmer'];
/** Blast radius per device, in tiles. */
const RADIUS: Readonly<Record<DeviceKind, number>> = { thunderpowder: 9, timedpowder: 7, hidden_charge: 6, festive_glimmer: 0 };
/** Ticks between a timed device's ignition and its blast (04 8.1: 5 ss). */
const TIMED_TICKS = 100;
/** Devices detonated per trigger, cascades included (04 8.4 throttle, per trigger here). */
const CHAIN_LIMIT = 400;
/** The registry is rebuilt from the realm every this many ticks (one sim-second). */
const SCAN_TICKS = 20;
/** Ground a device is restored to when the ground it replaced is not known (after a load). */
const FALLBACK_GROUND = 'lowloam';

interface DeviceRecord {
  kind: DeviceKind;
  /** Ground id under the device, restored when it goes off. */
  under: number;
  /** Tick the tile ignited (timed devices), or -1 while unarmed. */
  armedAt: number;
}

interface DeviceState {
  /** Device records by tile index. */
  devices: Map<number, DeviceRecord>;
  /** Device kind by ground id, for the scan. */
  kindOfGround: Map<number, DeviceKind>;
}

const states = new WeakMap<Sim, DeviceState>();

function stateOf(sim: Sim): DeviceState {
  let st = states.get(sim);
  if (!st) {
    st = { devices: new Map(), kindOfGround: new Map(DEVICE_KINDS.map((k) => [groundId(k), k])) };
    states.set(sim, st);
  }
  return st;
}

/** The blast a device goes off with: the `blast` profile at the device radius, or null when the profile is missing. */
function profileOf(kind: DeviceKind): BombProfile | null {
  const blast = BOMB_PROFILE_BY_ID.get('blast');
  return blast ? { ...blast, radius: RADIUS[kind] } : null;
}

/** The four orthogonal neighbours of tile i that lie on the realm. */
function n4(i: number, side: number): number[] {
  const x = i % side;
  const y = (i - x) / side;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < side - 1) out.push(i + 1);
  if (y > 0) out.push(i - side);
  if (y < side - 1) out.push(i + side);
  return out;
}

/** Keeps the registry in step with the realm's device grounds: drops records whose ground changed, adds new device tiles. */
function sync(sim: Sim, st: DeviceState): void {
  const realm = sim.realm;
  for (const [i, rec] of st.devices) {
    if (st.kindOfGround.get(realm.ground[i] ?? 0) !== rec.kind) st.devices.delete(i);
  }
  const fallback = groundId(FALLBACK_GROUND);
  for (let i = 0; i < realm.tileCount; i++) {
    const kind = st.kindOfGround.get(realm.ground[i] ?? 0);
    if (kind !== undefined && !st.devices.has(i)) st.devices.set(i, { kind, under: fallback, armedAt: -1 });
  }
}

/**
 * Places a device ground on land tile (x, y) (havoc_powder and its siblings). Refused for an unknown kind, an off-realm
 * tile, water, or a tile that already holds a device. Returns true when the device was placed.
 */
export function placeDevice(sim: Sim, kindId: string, x: number, y: number): boolean {
  const kind = DEVICE_KINDS.find((k) => k === kindId);
  if (kind === undefined || !sim.realm.inBounds(x, y)) return false;
  const realm = sim.realm;
  const i = y * realm.side + x;
  const under = realm.ground[i] ?? 0;
  const st = stateOf(sim);
  if (ground(under).layer !== 'land' || st.kindOfGround.has(under) || st.devices.has(i)) return false;
  realm.setGround(i, groundId(kind));
  st.devices.set(i, { kind, under, armedAt: -1 });
  return true;
}

/**
 * Detonates the device at `origin` and, through n4 blast devices, the ones it touches (04 8.4). A festive glimmer is
 * spent with no blast and does not chain. A device whose blast the guard refuses stays put and does not chain.
 */
function goOff(sim: Sim, st: DeviceState, origin: number, detonate: DeviceDetonator): void {
  const side = sim.realm.side;
  const queue: number[] = [origin];
  const seen = new Set<number>([origin]);
  let budget = CHAIN_LIMIT;
  for (let q = 0; q < queue.length && budget > 0; q++) {
    const i = queue[q] ?? -1;
    const rec = st.devices.get(i);
    if (!rec) continue;
    budget--;
    const x = i % side;
    const y = (i - x) / side;
    if (rec.kind === 'festive_glimmer') {
      sim.realm.setGround(i, rec.under);
      st.devices.delete(i);
      continue;
    }
    const prof = profileOf(rec.kind);
    if (!prof || !detonate(sim, prof, x, y)) continue;
    sim.realm.setGround(i, rec.under);
    st.devices.delete(i);
    for (const j of n4(i, side)) {
      const next = st.devices.get(j);
      if (next && next.kind !== 'festive_glimmer' && !seen.has(j)) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
}

/** Per-tick device step (04 8.4): rebuilds the registry each second, then checks every trigger and detonates what fires. */
export function devicesStep(sim: Sim, detonate: DeviceDetonator): void {
  const st = stateOf(sim);
  if (sim.tick % SCAN_TICKS === 0) sync(sim, st);
  if (st.devices.size === 0) return;
  const realm = sim.realm;
  const side = realm.side;
  const fired: number[] = [];
  let hasHidden = false;
  for (const rec of st.devices.values()) if (rec.kind === 'hidden_charge') hasHidden = true;

  // Fire: a timed device arms when its own tile ignites; thunderpowder and festive glimmer go off on fire in or beside them.
  for (let k = 0; k < realm.burning.size; k++) {
    const i = realm.burning.at(k);
    const here = st.devices.get(i);
    if (here?.kind === 'timedpowder' && here.armedAt < 0) here.armedAt = sim.tick;
    if (here && (here.kind === 'thunderpowder' || here.kind === 'festive_glimmer')) fired.push(i);
    for (const j of n4(i, side)) {
      const near = st.devices.get(j);
      if (near && (near.kind === 'thunderpowder' || near.kind === 'festive_glimmer')) fired.push(j);
    }
  }

  // Timer: a timed device goes off TIMED_TICKS after it armed.
  for (const [i, rec] of st.devices) {
    if (rec.kind === 'timedpowder' && rec.armedAt >= 0 && sim.tick - rec.armedAt >= TIMED_TICKS) fired.push(i);
  }

  // Step: a hidden charge goes off when a Being stands on its tile (every Being, no flight rule: none is modelled).
  if (hasHidden) {
    const s = sim.beings.store;
    for (let k = 0; k < s.size; k++) {
      const slot = s.at(k);
      if (s.alive[slot] !== 1) continue;
      const i = (s.y[slot] ?? 0) * side + (s.x[slot] ?? 0);
      if (st.devices.get(i)?.kind === 'hidden_charge') fired.push(i);
    }
  }

  for (const i of fired) goOff(sim, st, i, detonate);
}

/** A projectile landed on tile i: a hidden charge there goes off (18e section 5, `hit by projectile/blast`). */
export function deviceStruck(sim: Sim, i: number, detonate: DeviceDetonator): void {
  const st = states.get(sim);
  if (st?.devices.get(i)?.kind === 'hidden_charge') goOff(sim, st, i, detonate);
}
