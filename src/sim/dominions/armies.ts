import type { Dominion, RelationMatrix, UnitGuard } from './types.ts';
import type { Sim } from '../sim.ts';
import { addAggro } from '../beings/aggro.ts';
import { ground } from '../../content/grounds.ts';
import { PARCEL } from '../../shared/constants.ts';

/** Renown an army gains when its dominion defeats another dominion in a strength exchange, or takes a parcel (TUNE). */
export const ARMY_RENOWN_PER_DEFEAT = 1;
/** Share of the soldier slots an army must hold before it can be sent on an attack order (10 section 8: 70%). */
export const READY_FRACTION = 0.7;
/** Share of the attacker's strength lost when its army takes a parcel (TUNE). */
export const ATTACK_CASUALTY_RATE = 0.05;

/**
 * A dominion's army (10 section 8, cut down): one per dominion, the army id is the dominion id.
 * `soldiers` mirrors the dominion's strength. `captains` is one per hamlet the dominion holds (at least 1);
 * captains are counts, not named people (cut). `parcel` is the army's position: it marches one parcel per
 * sim-second toward its attack order, or else toward the nearest parcel of the dominion it is at war with
 * (marchArmies), and a strength exchange needs the two armies in contact (adjacent parcels; step.ts).
 * `slots` is the soldier slot count (the folk cap of the dominion's hamlets); `order` is the parcel the army is
 * ordered to attack, or -1 (attackOrders).
 */
export interface Army {
  id: number;
  name: string;
  dominionId: number;
  soldiers: number;
  renown: number;
  captains: number;
  /** Parcel id of the army's position. */
  parcel: number;
  /** Soldier slots, set in the yearly pass (0 when unknown). */
  slots: number;
  /** Parcel id of the attack order, or -1. */
  order: number;
}

/** The parcel of a dominion nearest its centroid (ties to the lower id), or the lowest parcel when perAxis is 0. */
export function centroidParcel(parcels: ReadonlySet<number>, perAxis: number): number {
  if (parcels.size === 0) return 0;
  if (perAxis <= 0) return Math.min(...parcels);
  let cx = 0;
  let cy = 0;
  for (const p of parcels) {
    cx += p % perAxis;
    cy += Math.floor(p / perAxis);
  }
  cx /= parcels.size;
  cy /= parcels.size;
  let best = -1;
  let bestD = Infinity;
  for (const p of parcels) {
    const d = (p % perAxis - cx) ** 2 + (Math.floor(p / perAxis) - cy) ** 2;
    if (d < bestD || (d === bestD && p < best)) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/**
 * Yearly raise: a dominion with strength and no army gets one, at its centroid parcel. Keeps the list sorted by id.
 * Draws no randomness. `perAxis` (parcels per side of the realm) places the army; 0 uses the lowest parcel.
 */
export function raiseArmies(armies: Army[], dominions: readonly Dominion[], perAxis = 0): void {
  for (const d of dominions) {
    if (d.strength > 0 && !armies.some((a) => a.id === d.id)) {
      armies.push({
        id: d.id,
        name: `Army of Dominion ${d.id}`,
        dominionId: d.id,
        soldiers: d.strength,
        renown: 0,
        captains: 1,
        parcel: centroidParcel(d.parcels, perAxis),
        slots: 0,
        order: -1,
      });
    }
  }
  armies.sort((x, y) => x.id - y.id);
}

/**
 * Sets each army's captain count: one per hamlet the dominion holds, at least 1. A dominion with no hamlet
 * data (absent from `hamlets`) keeps one captain for its army.
 */
export function setCaptains(armies: readonly Army[], hamlets: ReadonlyMap<number, number>): void {
  for (const a of armies) a.captains = Math.max(1, hamlets.get(a.dominionId) ?? 0);
}

/** Sets each army's soldier slots from a map of dominion id to slot count (0 when absent). */
export function setSlots(armies: readonly Army[], slots: ReadonlyMap<number, number>): void {
  for (const a of armies) a.slots = slots.get(a.dominionId) ?? 0;
}

/** Sets each army's soldiers to its dominion's strength (0 when the dominion is gone). */
export function syncArmies(armies: readonly Army[], dominions: readonly Dominion[]): void {
  const strength = new Map(dominions.map((d) => [d.id, d.strength]));
  for (const a of armies) a.soldiers = strength.get(a.dominionId) ?? 0;
}

/**
 * Readiness (10 section 8): `soldiers / slots >= 70%`. With no slots, an army with soldiers counts as ready.
 * An army with no soldiers is never ready.
 */
export function isReady(army: Army): boolean {
  if (army.soldiers <= 0) return false;
  return army.slots <= 0 || army.soldiers / army.slots >= READY_FRACTION;
}

/** True when two parcels are adjacent (8 neighbours) or equal. */
function inReach(p: number, q: number, perAxis: number): boolean {
  return Math.max(Math.abs((p % perAxis) - (q % perAxis)), Math.abs(Math.floor(p / perAxis) - Math.floor(q / perAxis))) <= 1;
}

/** The parcel held by a dominion at war with `d` that is nearest the army (ties to the lower parcel), or -1. */
function nearestEnemyParcel(army: Army, d: Dominion, relations: RelationMatrix, owner: ReadonlyMap<number, number>, perAxis: number): number {
  const ax = army.parcel % perAxis;
  const ay = Math.floor(army.parcel / perAxis);
  let best = -1;
  let bestD = Infinity;
  for (const [p, o] of owner) {
    if (o === d.id || relations.get(d.id, o) !== 'war') continue;
    const dist = (p % perAxis - ax) ** 2 + (Math.floor(p / perAxis) - ay) ** 2;
    if (dist < bestD || (dist === bestD && p < best)) {
      best = p;
      bestD = dist;
    }
  }
  return best;
}

/**
 * Attack orders (10 section 8, parcel form). Each sim-second, for every army in id order:
 * - An order is cleared when its parcel is no longer held by an enemy at war, or the army has no soldiers.
 * - A ready army (isReady) with no order is ordered against the nearest parcel of a dominion at war with it.
 * - An ordered army in reach (adjacent or on the parcel) attacks it when the parcel is undefended: the parcel changes
 *   hands, the attacker loses ATTACK_CASUALTY_RATE of its strength, and the army gains renown. The order then clears.
 *   A defended parcel (its owner's army is in reach of it) is not taken: the order waits, and the armies in contact
 *   settle by the strength exchange (step.ts). The attacker then stands next to the parcel it took, which defends it,
 *   so the old owner cannot take it straight back: two armies in contact do not swap one parcel back and forth.
 * This step moves parcels, so the adapter runs it only with the `border_creep` flag (09 section 3).
 * `owner` is the owner map of the step (parcel to dominion id; unowned parcels are absent) and is edited in place,
 * as are the dominions' parcel sets. Draws no randomness. Does nothing when perAxis is 0.
 */
export function attackOrders(armies: readonly Army[], dominions: readonly Dominion[], relations: RelationMatrix, owner: Map<number, number>, perAxis: number, unit?: UnitGuard): void {
  if (perAxis <= 0) return;
  // Each army is one unit (17 section 9, `dominion:<id>`): a throw in one leaves the other armies to take their orders.
  const guard: UnitGuard = unit ?? ((_, run) => run());
  const byId = new Map(dominions.map((d) => [d.id, d]));
  // Army positions do not change inside this step, so the positions by dominion are read once.
  const posByDom = new Map<number, number[]>();
  for (const a of armies) posByDom.set(a.dominionId, [...(posByDom.get(a.dominionId) ?? []), a.parcel]);
  const defended = (p: number, holder: number): boolean => (posByDom.get(holder) ?? []).some((q) => inReach(q, p, perAxis));
  for (const army of armies) {
    guard(army.dominionId, () => {
      const d = byId.get(army.dominionId);
      if (!d) {
        army.order = -1;
        return;
      }
      if (army.order >= 0) {
        const holder = owner.get(army.order);
        if (holder === undefined || holder === d.id || relations.get(d.id, holder) !== 'war' || d.strength <= 0) army.order = -1;
      }
      if (army.order < 0 && isReady(army)) army.order = nearestEnemyParcel(army, d, relations, owner, perAxis);
      if (army.order < 0 || d.strength <= 0 || !inReach(army.parcel, army.order, perAxis)) return;
      const target = army.order;
      if (defended(target, owner.get(target) ?? -1)) return;
      const from = byId.get(owner.get(target) ?? -1);
      from?.parcels.delete(target);
      owner.set(target, d.id);
      d.parcels.add(target);
      d.strength -= Math.floor(d.strength * ATTACK_CASUALTY_RATE);
      army.renown += ARMY_RENOWN_PER_DEFEAT;
      army.order = -1;
    });
  }
}

/**
 * One sim-second of army movement: each army steps one parcel (8-neighbour, diagonal allowed) toward its target.
 * The target is its attack order when it has one (attackOrders). Otherwise it is the nearest parcel of the dominion it
 * is at war with: the campaign target when that is at war with it, else the lowest-id dominion at war with it.
 * An army already adjacent to the target stays. Draws no randomness. Does nothing when perAxis is 0.
 */
export function marchArmies(armies: readonly Army[], dominions: readonly Dominion[], relations: RelationMatrix, perAxis: number, unit?: UnitGuard): void {
  if (perAxis <= 0) return;
  // Each army is one unit (17 section 9, `dominion:<id>`): a throw in one leaves the other armies to march.
  const guard: UnitGuard = unit ?? ((_, run) => run());
  const byId = new Map(dominions.map((d) => [d.id, d]));
  for (const army of armies) {
    guard(army.dominionId, () => {
      const d = byId.get(army.dominionId);
      if (!d) return;
      const ax = army.parcel % perAxis;
      const ay = Math.floor(army.parcel / perAxis);
      let tp = army.order;
      if (tp < 0) {
        let enemy: Dominion | undefined;
        if (d.target >= 0 && relations.get(d.id, d.target) === 'war') enemy = byId.get(d.target);
        if (!enemy) {
          const foes = dominions.filter((e) => e.id !== d.id && e.parcels.size > 0 && relations.get(d.id, e.id) === 'war');
          enemy = foes.sort((x, y) => x.id - y.id)[0];
        }
        if (!enemy || enemy.parcels.size === 0) return;
        let tpD = Infinity;
        for (const p of enemy.parcels) {
          const dist = (p % perAxis - ax) ** 2 + (Math.floor(p / perAxis) - ay) ** 2;
          if (dist < tpD || (dist === tpD && p < tp)) {
            tp = p;
            tpD = dist;
          }
        }
      }
      const tx = tp % perAxis;
      const ty = Math.floor(tp / perAxis);
      if (Math.max(Math.abs(tx - ax), Math.abs(ty - ay)) <= 1) return;
      army.parcel = (ay + Math.sign(ty - ay)) * perAxis + (ax + Math.sign(tx - ax));
    });
  }
}

/** Adds renown to the army of a dominion that won a strength exchange (ARMY_RENOWN_PER_DEFEAT). */
export function armyWon(armies: readonly Army[], dominionId: number): void {
  const army = armies.find((a) => a.dominionId === dominionId);
  if (army) army.renown += ARMY_RENOWN_PER_DEFEAT;
}

/**
 * Garrison draw (09 garrison): moves up to `n` soldiers from a dominion's strength into a hamlet garrison. Takes no more than
 * the dominion holds. The army, when there is one, mirrors the strength, so it is set to match. Returns the number drawn.
 * Draws no randomness.
 */
export function drawToGarrison(d: Dominion, army: Army | undefined, n: number): number {
  const k = Math.max(0, Math.min(Math.floor(n), d.strength));
  d.strength -= k;
  if (army) army.soldiers = d.strength;
  return k;
}

/** Returns `n` garrison soldiers to a dominion's strength (and its army, when there is one). Draws no randomness. */
export function returnFromGarrison(d: Dominion, army: Army | undefined, n: number): void {
  d.strength += Math.max(0, Math.floor(n));
  if (army) army.soldiers = d.strength;
}

/** Folk pairs one army contact engages (TUNE). */
export const CONTACT_MAX = 4;

/** The Folk Beings standing on a parcel's tiles, by slot. Beings carry no dominion, so the parcel is their side here. */
function folkOn(sim: Sim, parcel: number, perAxis: number): number[] {
  const s = sim.beings.store;
  const x0 = (parcel % perAxis) * PARCEL;
  const y0 = Math.floor(parcel / perAxis) * PARCEL;
  const out: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (s.alive[slot] !== 1 || !sim.beings.species(s.species[slot] ?? 0).folk) continue;
    const x = s.x[slot] ?? 0;
    const y = s.y[slot] ?? 0;
    if (x >= x0 && x < x0 + PARCEL && y >= y0 && y < y0 + PARCEL) out.push(slot);
  }
  return out.sort((p, q) => p - q);
}

/** A free land tile beside (x, y) (8 neighbours), or null. */
function freeBeside(sim: Sim, x: number, y: number): [number, number] | null {
  const realm = sim.realm;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if ((dx === 0 && dy === 0) || !realm.inBounds(nx, ny)) continue;
      if (ground(realm.ground[ny * realm.side + nx] ?? 0).layer !== 'land') continue;
      if (sim.beingAt(nx, ny) < 0) return [nx, ny];
    }
  }
  return null;
}

/**
 * Army contact (10 section 8, Folk layer): when two armies in contact trade strength, their Folk fight too. The Folk
 * on each army's parcel are its members here. Up to CONTACT_MAX pairs are taken in slot order: each member of `b`
 * steps onto a free land tile beside its partner of `a`, and the two grudge each other (addAggro), so the fight and
 * brawl code of the Beings runs from their next decision. Returns the number of pairs engaged. Draws no randomness;
 * does nothing when perAxis is 0.
 * Not called yet: the strength exchange (dominions/step.ts) is run from the adapter, which is outside this change.
 */
export function engageArmies(sim: Sim, a: Army, b: Army, perAxis: number): number {
  if (perAxis <= 0) return 0;
  const sideA = folkOn(sim, a.parcel, perAxis);
  const sideB = folkOn(sim, b.parcel, perAxis);
  const s = sim.beings.store;
  let engaged = 0;
  for (let k = 0; k < Math.min(CONTACT_MAX, sideA.length, sideB.length); k++) {
    const pa = sideA[k] ?? -1;
    const pb = sideB[k] ?? -1;
    const spot = freeBeside(sim, s.x[pa] ?? 0, s.y[pa] ?? 0);
    if (!spot) continue;
    s.x[pb] = spot[0];
    s.y[pb] = spot[1];
    addAggro(sim, pa, pb);
    addAggro(sim, pb, pa);
    engaged++;
  }
  if (engaged > 0) sim.beings.rebuildBuckets();
  return engaged;
}
