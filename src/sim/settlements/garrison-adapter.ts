import type { Sim } from '../sim.ts';
import { dominionsOfSim, dominionState, UNOWNED } from '../dominions/adapter.ts';
import { drawToGarrison, returnFromGarrison } from '../dominions/armies.ts';
import { SS_TICKS } from '../clock.ts';
import type { Hamlet } from './hamlet.ts';
import { GARRISON_COMPANY, LEADER_WARFARE, SOLDIER_GOLD_GATE, soldierTimer, type GarrisonRecord } from './garrison.ts';

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

/** Returns a garrison's soldiers to the dominion they came from, when that dominion still exists. */
function release(sim: Sim, rec: GarrisonRecord): void {
  if (rec.soldiers <= 0 || dominionsOfSim(sim).length === 0) {
    rec.soldiers = 0;
    return;
  }
  const s = dominionState(sim);
  const d = s.dominions.find((x) => x.id === rec.dominion);
  if (d) returnFromGarrison(d, s.armies.find((a) => a.dominionId === rec.dominion), rec.soldiers);
  rec.soldiers = 0;
}

/**
 * One garrison pass. `ownerOf` gives a hamlet's majority owner (settlements/adapter.ts). For each hamlet with a garrison:
 * - a record is made on first sight, with the halved soldier timer;
 * - a garrison that lost its building (or a hamlet that lost its garrison) returns its soldiers and drops the record;
 * - a change of owner returns the company to the old dominion; recruits then come from the new owner;
 * - the timer counts down; at or below 0, with gold above the gate and room in the company, one soldier is drawn from the
 *   owner's strength and the timer resets. A refused draw leaves the timer at or below 0 so the next pass tries again.
 */
export function garrisonStep(sim: Sim, hamlets: readonly Hamlet[], ownerOf: (h: Hamlet) => number): void {
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
      rec = { hamlet: h, dominion: owner, soldiers: 0, timer: soldierTimer(LEADER_WARFARE, true) };
      state.records.set(h, rec);
    }
    if (rec.dominion !== owner) {
      release(sim, rec);
      rec.dominion = owner;
    }
    // Clamped at 0: a full company or a refused draw holds the timer there, so it never falls without bound.
    rec.timer = Math.max(0, rec.timer - PASS_TICKS);
    if (rec.timer > 0 || rec.soldiers >= GARRISON_COMPANY || rec.dominion === UNOWNED) return;
    if (hamlet.gold <= SOLDIER_GOLD_GATE) return;
    if (drawOne(sim, rec.dominion) > 0) {
      rec.soldiers += 1;
      rec.timer = soldierTimer(LEADER_WARFARE, true);
    }
  });
}

/**
 * Replaces the garrison records with a snapshot (Chronicle load). Checks the hamlet index against the hamlet count and
 * the soldier count against the company size first.
 */
export function restoreGarrisons(host: object, list: readonly GarrisonRecord[], hamletCount: number): void {
  const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
  const records = new Map<number, GarrisonRecord>();
  for (const r of list) {
    if (!isInt(r.hamlet) || r.hamlet < 0 || r.hamlet >= hamletCount || records.has(r.hamlet)) throw new Error('hamlet state: garrison hamlet is not valid');
    if (!isInt(r.dominion) || r.dominion < 0 || r.dominion > 255) throw new Error('hamlet state: garrison dominion is not valid');
    if (!isInt(r.soldiers) || r.soldiers < 0 || r.soldiers > GARRISON_COMPANY) throw new Error('hamlet state: garrison soldiers are not valid');
    if (typeof r.timer !== 'number' || !Number.isFinite(r.timer)) throw new Error('hamlet state: garrison timer is not valid');
    records.set(r.hamlet, { hamlet: r.hamlet, dominion: r.dominion, soldiers: r.soldiers, timer: r.timer });
  }
  states.set(host, { records });
}
