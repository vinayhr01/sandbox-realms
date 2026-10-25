import type { Sim } from '../sim.ts';
import { dominionOwnerOf, dominionsOfSim, dominionState, ownerOfHamlet, UNOWNED } from '../dominions/adapter.ts';
import { drawToGarrison, returnFromGarrison } from '../dominions/armies.ts';
import { harmonyBonus } from '../culture/culture.ts';
import { SS_TICKS } from '../clock.ts';
import { PARCEL } from '../../shared/constants.ts';
import type { Hamlet } from './hamlet.ts';
import type { LevySex } from './custom-rules.ts';
import {
  LEADER_ARMY_BONUS,
  LEADER_WARFARE,
  RECRUIT_COST_GOLD,
  SOLDIER_GOLD_GATE,
  SOLDIER_OVER_LIMIT_TIMER,
  SOLDIER_WAGE_GOLD,
  WAGE_PERIOD,
  buildingSlotBonus,
  soldierSlots,
  soldierTimer,
  type GarrisonRecord,
  type GarrisonSave,
} from './garrison.ts';

/**
 * Garrison pass (09 section 8, 10 section 8): each hamlet with a built garrison recruits soldiers from its owner's dominion
 * strength, one at a time, on the soldier timer (halved by the garrison). Runs once per sim-second from settlementsStep.
 *
 * The dominion state is read through `dominionsOfSim` (read-only). Soldiers move only through the armies.ts seam
 * (drawToGarrison, returnFromGarrison). No RNG: the pass is a pure function of the hamlet and dominion state.
 */

interface GarrisonState {
  records: Map<number, GarrisonRecord>;
}

/** Per-sim garrison records, keyed by the host object (as the settlements state is). */
const states = new WeakMap<object, GarrisonState>();

/** Garrison records of a host, read only: empty before the first garrison pass. */
export function garrisonsOf(host: object): readonly GarrisonRecord[] {
  return [...(states.get(host)?.records.values() ?? [])];
}

/** True when the hamlet holds a built garrison (08 section 7.4, 09 section 6). */
export function hamletHasGarrison(hamlet: Hamlet): boolean {
  return hamlet.buildings.some((b) => b.def.id === 'garrison');
}

/** Soldiers a dominion has stationed in this host's garrisons (the records whose dominion is it). Read only; 0 before the first pass. */
export function garrisonedSoldiers(host: object, dominionId: number): number {
  let n = 0;
  for (const r of states.get(host)?.records.values() ?? []) if (r.dominion === dominionId) n += r.soldiers;
  return n;
}

/** Ticks per garrison pass: one sim-second. */
const PASS_TICKS = SS_TICKS;

/** One soldier from a dominion's strength (armies.ts seam), or 0 when the dominion is gone or holds none. */
function drawOne(sim: Sim, dominionId: number): number {
  const s = dominionState(sim);
  const d = s.dominions.find((x) => x.id === dominionId);
  if (!d) return 0;
  const army = s.armies.find((a) => a.dominionId === dominionId);
  return drawToGarrison(d, army, 1);
}

/** Living Folk standing in the hamlet's parcels that pass `want` (a slot test). Draws no rng. */
function folkIn(sim: Sim, hamlet: Hamlet, want: (slot: number) => boolean): number {
  const s = sim.beings.store;
  const perAxis = sim.realm.side / PARCEL;
  let n = 0;
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (s.alive[slot] !== 1 || !sim.beings.species(s.species[slot] ?? 0).folk || !want(slot)) continue;
    const p = Math.floor((s.y[slot] ?? 0) / PARCEL) * perAxis + Math.floor((s.x[slot] ?? 0) / PARCEL);
    if (hamlet.parcels.has(p)) n++;
  }
  return n;
}

/** Living adult Folk of the levied sex standing in the hamlet's parcels. Draws no rng. */
function levyRoom(sim: Sim, hamlet: Hamlet, levy: LevySex): number {
  const s = sim.beings.store;
  const female = levy === 'female' ? 1 : 0;
  return folkIn(sim, hamlet, (slot) => (s.baby[slot] ?? 0) === 0 && (s.female[slot] ?? 0) === female);
}

/** Living adult Folk (not children) standing in the hamlet's parcels: the `adults` of 09 section 8. Draws no rng. */
function adultsIn(sim: Sim, hamlet: Hamlet): number {
  const s = sim.beings.store;
  return folkIn(sim, hamlet, (slot) => (s.baby[slot] ?? 0) === 0);
}

/**
 * Leader warfare for the garrison terms (09 section 8: `leader.warfare` in the soldier timer and in `armyFactor`): the valor
 * attribute of the hamlet leader (the oldest adult Folk, set by the census in adapter.ts), plus the harmony warfare bonus of
 * the creeds of the dominion that holds the hamlet (11 section 4.2). LEADER_WARFARE when the hamlet has no living leader.
 * Reads only; draws no rng.
 */
function leaderWarfare(sim: Sim, hamlet: Hamlet): number {
  const slot = hamlet.leader ?? -1;
  const s = sim.beings.store;
  if (slot < 0 || s.alive[slot] !== 1) return LEADER_WARFARE;
  // Attributes are stored four per slot in the order rapport, valor, husbandry, wit (beings/store.ts); valor is index 1.
  const valor = s.attrs[slot * 4 + 1] ?? LEADER_WARFARE;
  const owner = dominionOwnerOf(sim);
  if (!owner || sim.culture.creeds.length === 0) return valor;
  return valor + harmonyBonus(sim.culture, ownerOfHamlet(hamlet.parcels, owner), 'warfare');
}

/**
 * Soldier slots of a hamlet now (09 section 8 quota step 7, 10 section 8): soldierSlots over the folk adults, the leader's
 * warfare and the building bonuses, and 0 without the `standing_armies` rule. The soldier line of the job round (jobs.ts
 * assignJobs, through hamlet.ts) and the garrison pass both read this, so the round and the ledger agree. Reads only; no rng.
 */
export function hamletSoldierLimit(sim: Sim, hamlet: Hamlet): number {
  if (!sim.rules.isOn('standing_armies')) return 0;
  return soldierSlots(adultsIn(sim, hamlet), leaderWarfare(sim, hamlet), LEADER_ARMY_BONUS, buildingSlotBonus(hamlet.buildings.map((b) => b.def.id)));
}

/**
 * Wage day (TUNE, not in the spec): each garrisoned soldier costs SOLDIER_WAGE_GOLD from the hamlet purse. When the purse
 * cannot cover the company, the soldiers it can pay keep their place and the rest desert. Deserters are not returned to
 * the dominion: they were drawn out of its strength already, so they leave the game. Deterministic: no rng.
 */
function payWages(hamlet: Hamlet, rec: GarrisonRecord): void {
  if (rec.soldiers <= 0) return;
  const payable = Math.min(rec.soldiers, Math.floor(hamlet.gold / SOLDIER_WAGE_GOLD));
  hamlet.gold -= payable * SOLDIER_WAGE_GOLD;
  rec.soldiers = payable;
}

/**
 * Returns `n` of a garrison's soldiers (all by default) to the dominion they came from, when that dominion still exists.
 * Soldiers of a dominion that is gone leave the game.
 */
function release(sim: Sim, rec: GarrisonRecord, n: number = rec.soldiers): void {
  const k = Math.max(0, Math.min(n, rec.soldiers));
  if (k > 0 && dominionsOfSim(sim).length > 0) {
    const s = dominionState(sim);
    const d = s.dominions.find((x) => x.id === rec.dominion);
    if (d) returnFromGarrison(d, s.armies.find((a) => a.dominionId === rec.dominion), k);
  }
  rec.soldiers -= k;
}

/**
 * One garrison pass. `ownerOf` gives a hamlet's majority owner (settlements/adapter.ts). For each hamlet with a garrison:
 * - a record is made on first sight, with the halved soldier timer;
 * - a garrison that lost its building (or a hamlet that lost its garrison) returns its soldiers and drops the record;
 * - a change of owner returns the company to the old dominion; recruits then come from the new owner;
 * - the wage day pays or deserts (payWages);
 * - the timer counts down; at or below 0, a company over the hamlet's soldier slots (soldierSlots, adults x 0.35) releases
 *   the surplus and the timer is set to 600; otherwise, with gold above the gate and room under the slots, one soldier is
 *   drawn from the owner's strength and the timer resets. A refused draw leaves the timer at or below 0 so the next pass
 *   tries again.
 */
export function garrisonStep(
  sim: Sim,
  hamlets: readonly Hamlet[],
  ownerOf: (h: Hamlet) => number,
  levyOf?: (h: Hamlet) => LevySex | undefined,
): void {
  let state = states.get(sim);
  const hasDominions = dominionsOfSim(sim).length > 0;
  if (!state) {
    if (!hamlets.some(hamletHasGarrison)) return;
    state = { records: new Map() };
    states.set(sim, state);
  }
  for (const [h, rec] of [...state.records]) {
    const hamlet = hamlets[h];
    if (!hamlet || !hamletHasGarrison(hamlet)) {
      release(sim, rec);
      state.records.delete(h);
    }
  }
  hamlets.forEach((hamlet, h) => {
    if (!hamletHasGarrison(hamlet)) return;
    const owner = hasDominions ? ownerOf(hamlet) : UNOWNED;
    let rec = state.records.get(h);
    if (!rec) {
      rec = { hamlet: h, dominion: owner, soldiers: 0, timer: soldierTimer(leaderWarfare(sim, hamlet), true), wage: WAGE_PERIOD };
      state.records.set(h, rec);
    }
    if (rec.dominion !== owner) {
      release(sim, rec);
      rec.dominion = owner;
    }
    // Wage day: the period counts down and resets on each payment (a wage day with no soldiers pays nothing).
    rec.wage -= PASS_TICKS;
    if (rec.wage <= 0) {
      payWages(hamlet, rec);
      rec.wage = WAGE_PERIOD;
    }
    // Clamped at 0: a full company or a refused draw holds the timer there, so it never falls without bound.
    rec.timer = Math.max(0, rec.timer - PASS_TICKS);
    if (rec.timer > 0) return;
    // Soldier limit (09 section 8 gate): `soldiersNow > soldierSlots` releases the surplus to the dominion, then the timer
    // is set to 600 (not halved). Slots are 0 without the `standing_armies` rule (10 section 8).
    // The leader's warfare (leaderWarfare) and the building slot bonus (watchspire, bastion) both add to the slots.
    const slots = hamletSoldierLimit(sim, hamlet);
    if (rec.soldiers > slots) {
      release(sim, rec, rec.soldiers - slots);
      rec.timer = SOLDIER_OVER_LIMIT_TIMER;
      return;
    }
    if (rec.soldiers >= slots || rec.dominion === UNOWNED) return;
    if (hamlet.gold <= SOLDIER_GOLD_GATE) return;
    // Levy (11 section 9.1, 09 section 8 soldier gate): only folk of the levied sex may serve, so a recruit needs one more
    // such adult in the hamlet than the company holds.
    const levy = levyOf?.(hamlet);
    if (levy !== undefined && levyRoom(sim, hamlet, levy) <= rec.soldiers) return;
    if (drawOne(sim, rec.dominion) > 0) {
      rec.soldiers += 1;
      hamlet.gold -= RECRUIT_COST_GOLD;
      rec.timer = soldierTimer(leaderWarfare(sim, hamlet), true);
    }
  });
}

/**
 * Replaces the garrison records with a snapshot (Chronicle load). Checks the hamlet index against the hamlet count and
 * the soldier count to a whole number first. A count over the hamlet's soldier slots loads as is; the next pass releases it.
 */
export function restoreGarrisons(host: object, list: readonly GarrisonSave[], hamletCount: number): void {
  const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
  const records = new Map<number, GarrisonRecord>();
  for (const r of list) {
    if (!isInt(r.hamlet) || r.hamlet < 0 || r.hamlet >= hamletCount || records.has(r.hamlet)) throw new Error('hamlet state: garrison hamlet is not valid');
    if (!isInt(r.dominion) || r.dominion < 0 || r.dominion > 255) throw new Error('hamlet state: garrison dominion is not valid');
    if (!isInt(r.soldiers) || r.soldiers < 0) throw new Error('hamlet state: garrison soldiers are not valid');
    if (typeof r.timer !== 'number' || !Number.isFinite(r.timer)) throw new Error('hamlet state: garrison timer is not valid');
    const wage = r.wage ?? WAGE_PERIOD;
    if (typeof wage !== 'number' || !Number.isFinite(wage)) throw new Error('hamlet state: garrison wage is not valid');
    records.set(r.hamlet, { hamlet: r.hamlet, dominion: r.dominion, soldiers: r.soldiers, timer: r.timer, wage });
  }
  states.set(host, { records });
}
