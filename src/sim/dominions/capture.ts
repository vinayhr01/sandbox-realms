import type { Dominion, RelationMatrix, UnitGuard } from './types.ts';

/**
 * Hamlet capture (10 section 7, 18e section 3.1). One switch controls both the capture and the parcel take it replaces.
 * `true`: the capture runs every CAPTURE_STEP_TICKS, and the strength exchange (step.ts takeParcel) and the attack orders
 * (armies.ts attackOrders) no longer move parcels. 10 section 7 names capture as the only way territory changes hands
 * besides rebellion and chaos, and 09 section 3 allows no automatic border creep.
 * `false`: no capture runs, and the parcel take works as before (border_creep flag).
 * Recorded in DECISIONS.md, "Capture close 8".
 */
export const HAMLET_CAPTURE = true;

/** Ticks between capture steps (10 section 15: capture update every 2 ticks). */
export const CAPTURE_STEP_TICKS = 2;
/** Capture threshold of a hamlet (10 section 7: `ticks >= 100`). TUNE. */
export const CAPTURE_THRESHOLD = 100;
/** Capture threshold of a hamlet with a bastion (18e section 3.1: rises from 100 to 130). Spec value. */
export const BASTION_THRESHOLD = 130;
/** Defence points per watchspire a hamlet holds (10 section 7, DEF_PER_TOWER). TUNE. */
export const DEF_PER_TOWER = 10;
/** Capture points per soldier of an enemy or defending army in reach of the hamlet (10 section 7: soldiers 1 per unit). Spec value. */
export const SOLDIER_POINTS = 1;
/** Steps a defender must hold a hamlet before it stops a rising capture (10 section 7: defenderTicks >= 5). TUNE. */
export const DEFENDER_TICKS = 5;
/** Ticks gained per step while an enemy leads and no long-held defender stands. TUNE. The spec's `1 + elapsedFraction` takes elapsedFraction as 0 (see DECISIONS.md). */
export const CAPTURE_RISE = 1;
/** Ticks lost per step while the hamlet is defended (10 section 7: falls 1). TUNE. */
export const CAPTURE_FALL_DEFENDED = 1;
/** Ticks lost per step with nobody on the hamlet (10 section 7: falls 0.5). TUNE. */
export const CAPTURE_FALL_NOBODY = 0.5;
/** Parcels around a hamlet parcel within which an army counts as standing in the hamlet. TUNE. marchArmies stops one parcel short of its target, so an army at the border must count. */
export const CAPTURE_REACH = 1;

/** Capture progress of one hamlet (10 section 7, `Capture`). Keyed by the hamlet's lowest parcel in the dominion state. */
export interface Capture {
  /** Capture ticks; the hamlet falls when an enemy leads and this reaches the threshold. */
  ticks: number;
  /** Steps in a row the hamlet has been defended (10 section 7: defenderTicks). */
  defenderTicks: number;
}

/** A hamlet as the capture step sees it: its parcels and its buildings (by catalogue id). */
export interface CaptureHamlet {
  parcels: ReadonlySet<number>;
  buildings: readonly { readonly def: { readonly id: string } }[];
}

/** An army as the capture step sees it: its dominion, its position and its soldiers (armies.ts Army). */
export interface CaptureArmy {
  dominionId: number;
  parcel: number;
  soldiers: number;
}

/** What one capture step reads and writes. `owner` and the dominions' parcel sets change when a hamlet falls. */
export interface CaptureContext {
  perAxis: number;
  hamlets: readonly CaptureHamlet[];
  owner: Uint8Array;
  dominions: readonly Dominion[];
  armies: readonly CaptureArmy[];
  relations: RelationMatrix;
  /** Majority owner of a hamlet's parcels (adapter.ts), or 0 when none is owned. */
  ownerOf(parcels: ReadonlySet<number>): number;
  /** Capture progress by the hamlet's lowest parcel. Edited in place. */
  captures: Map<number, Capture>;
  /**
   * The dominion that takes a hamlet its captor took (10 section 7 findDominionAfterCapture; adapter.ts takerOfCapture). Read
   * before the owner bytes change. Returns the captor when no ally hands the hamlet over.
   */
  takerOf(captor: number, loser: number, anchor: number): number;
  /** True when the hamlet with this lowest parcel is the loser's capital (rulers.ts leadingHamlet). Read before the bytes change. */
  isCapital(loser: number, anchor: number): boolean;
  /** Runs one hamlet's capture step (by its index in `hamlets`) under the fault gate (17 section 9, `hamlet:<index>`). Optional: without it a throw propagates. */
  unit?: UnitGuard;
}

/** A hamlet that fell in one capture step: its lowest parcel, the dominion it left, the dominion that takes it, and whether it was the capital. */
export interface CaptureFall {
  anchor: number;
  loser: number;
  winner: number;
  capital: boolean;
}

/** True when parcel `q` is within CAPTURE_REACH parcels of a parcel of `parcels`. Draws no randomness. */
function inReach(q: number, parcels: ReadonlySet<number>, perAxis: number): boolean {
  const qx = q % perAxis;
  const qy = Math.floor(q / perAxis);
  for (let dy = -CAPTURE_REACH; dy <= CAPTURE_REACH; dy++) {
    for (let dx = -CAPTURE_REACH; dx <= CAPTURE_REACH; dx++) {
      const x = qx + dx;
      const y = qy + dy;
      if (x < 0 || y < 0 || x >= perAxis || y >= perAxis) continue;
      if (parcels.has(y * perAxis + x)) return true;
    }
  }
  return false;
}

/**
 * One capture step (10 section 7, `updateCapture(h)` for every hamlet). Per hamlet, with its owner O:
 * - attack points: each enemy dominion (at war with O) adds SOLDIER_POINTS per soldier of its armies in reach; the
 *   dominion with the most is the capturer (ties to the lower id);
 * - defence points: DEF_PER_TOWER per watchspire the hamlet holds, plus SOLDIER_POINTS per soldier of O in reach;
 * - `defended` when O has soldiers in reach or its defence beats the attack points; `defenderTicks` counts the steps in a row;
 * - `ticks` rises by CAPTURE_RISE when the capturer leads and no defender has held DEFENDER_TICKS steps; otherwise it falls
 *   by CAPTURE_FALL_DEFENDED when defended, or by CAPTURE_FALL_NOBODY when nobody is there;
 * - at `ticks >= threshold` (BASTION_THRESHOLD with a bastion, else CAPTURE_THRESHOLD) the hamlet falls (finishCapture).
 * Returns the hamlets that fell in this step, in list order. Draws no randomness. Iterates hamlets in list order and
 * dominions in id order.
 */
export function captureStep(ctx: CaptureContext): CaptureFall[] {
  const falls: CaptureFall[] = [];
  const live = new Set<number>();
  // Each hamlet is one unit (17 section 9, `hamlet:<index>`) when the context has a guard: a throw in one leaves the others
  // their step. A switched-off hamlet is not stepped, so its capture progress is dropped by the sweep below.
  const guard: UnitGuard = ctx.unit ?? ((_, run) => run());
  for (const [i, h] of ctx.hamlets.entries()) {
    guard(i, () => {
      if (h.parcels.size === 0) return;
      let anchor = Infinity;
      for (const p of h.parcels) anchor = Math.min(anchor, p);
      live.add(anchor);
      const owner = ctx.ownerOf(h.parcels);
      if (owner === 0) {
        ctx.captures.delete(anchor);
        return;
      }
      let ownSoldiers = 0;
      const attack = new Map<number, number>();
      for (const a of ctx.armies) {
        if (a.soldiers <= 0 || !inReach(a.parcel, h.parcels, ctx.perAxis)) continue;
        if (a.dominionId === owner) ownSoldiers += a.soldiers;
        else if (ctx.relations.get(a.dominionId, owner) === 'war') attack.set(a.dominionId, (attack.get(a.dominionId) ?? 0) + a.soldiers * SOLDIER_POINTS);
      }
      let capturer = 0;
      let points = 0;
      for (const [id, pts] of [...attack].sort((x, y) => x[0] - y[0])) {
        if (pts > points) {
          capturer = id;
          points = pts;
        }
      }
      const towers = h.buildings.filter((b) => b.def.id === 'watchspire').length;
      const defence = towers * DEF_PER_TOWER + ownSoldiers * SOLDIER_POINTS;
      const defended = ownSoldiers > 0 || defence > points;
      const leads = capturer !== 0 && points > defence;
      const state: Capture = ctx.captures.get(anchor) ?? { ticks: 0, defenderTicks: 0 };
      state.defenderTicks = defended ? state.defenderTicks + 1 : 0;
      const blocked = defended && state.defenderTicks >= DEFENDER_TICKS;
      if (leads && !blocked) state.ticks += CAPTURE_RISE;
      else if (defended) state.ticks -= CAPTURE_FALL_DEFENDED;
      else state.ticks -= CAPTURE_FALL_NOBODY;
      state.ticks = Math.max(0, state.ticks);
      ctx.captures.set(anchor, state);
      const threshold = h.buildings.some((b) => b.def.id === 'bastion') ? BASTION_THRESHOLD : CAPTURE_THRESHOLD;
      if (leads && state.ticks >= threshold) {
        const fall = finishCapture(ctx, h.parcels, owner, capturer, anchor);
        if (fall) falls.push(fall);
      }
    });
  }
  for (const key of [...ctx.captures.keys()]) if (!live.has(key)) ctx.captures.delete(key);
  return falls;
}

/**
 * finishCapture (10 section 7): the taker (ctx.takerOf: the captor, or the main party of an allied campaign) receives the
 * hamlet's parcels that the loser held, in the owner bytes and in the dominions' parcel sets, and the capture record is
 * dropped. The loser's capital is read before the bytes change. Garrisons follow the existing owner-change rule of
 * garrison-adapter.ts (the company goes back to the old dominion). The moods, the ruler and the holdings are set by the
 * adapter after the step (adapter.ts applyFall). Draws no randomness.
 */
function finishCapture(ctx: CaptureContext, parcels: ReadonlySet<number>, loser: number, captor: number, anchor: number): CaptureFall | undefined {
  const winner = ctx.takerOf(captor, loser, anchor);
  const capital = ctx.isCapital(loser, anchor);
  const from = ctx.dominions.find((d) => d.id === loser);
  const to = ctx.dominions.find((d) => d.id === winner);
  if (!to) return undefined;
  for (const p of parcels) {
    if (ctx.owner[p] !== loser) continue;
    ctx.owner[p] = winner;
    from?.parcels.delete(p);
    to.parcels.add(p);
  }
  ctx.captures.delete(anchor);
  return { anchor, loser, winner, capital };
}
