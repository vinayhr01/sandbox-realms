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

/** Ticks between raze checks (10 section 7 and 15: raze check every 40 ticks). Spec value. */
export const RAZE_CHECK_TICKS = 40;

/** A hamlet as the raze step sees it: its parcels and its citizens (the settlements census of the hamlet's folk, hamlet.ts). */
export interface RazeHamlet {
  parcels: ReadonlySet<number>;
  folk: number;
}

/** What one raze check reads and writes. The owner bytes and the dominions' parcel sets change when a hamlet is razed. */
export interface RazeContext {
  perAxis: number;
  hamlets: readonly RazeHamlet[];
  owner: Uint8Array;
  dominions: readonly Dominion[];
  /** Majority owner of a hamlet's parcels (adapter.ts), or 0 when none is owned. */
  ownerOf(parcels: ReadonlySet<number>): number;
  /** Living beings standing on these parcels, in slot order. Draws no randomness. */
  beingsOn(parcels: ReadonlySet<number>): number[];
  /** Moves beings to the parcel `anchor` (the lowest parcel of the nearest hamlet). */
  evict(slots: readonly number[], anchor: number): void;
  /** Raze moods for the Folk among the evicted (effects.ts razedMood). Called before the owner bytes change. */
  feelRazed(slots: readonly number[], capital: boolean): void;
  /** True when the hamlet with this lowest parcel is the loser's capital (rulers.ts leadingHamlet). Read before the bytes change. */
  isCapital(loser: number, anchor: number): boolean;
}

/** A hamlet razed in one check: its lowest parcel, the dominion that lost it, the beings evicted, and whether it was the capital. */
export interface RazeFall {
  anchor: number;
  loser: number;
  evicted: number;
  capital: boolean;
}

/** Lowest parcel of a parcel set. */
function lowestParcel(parcels: ReadonlySet<number>): number {
  let anchor = Infinity;
  for (const p of parcels) anchor = Math.min(anchor, p);
  return anchor;
}

/**
 * The parcel of `anchors` nearest to `from` by squared distance between parcel positions (the armies.ts nearestEnemyParcel rule),
 * ties to the lower parcel. undefined when there are none. Draws no randomness.
 */
export function nearestAnchor(from: number, anchors: readonly number[], perAxis: number): number | undefined {
  const fx = from % perAxis;
  const fy = Math.floor(from / perAxis);
  let best: number | undefined;
  let bestD = Infinity;
  for (const a of anchors) {
    const d = (a % perAxis - fx) ** 2 + (Math.floor(a / perAxis) - fy) ** 2;
    if (d < bestD || (d === bestD && best !== undefined && a < best)) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/**
 * Raze check (10 section 7, every RAZE_CHECK_TICKS, and after a capture). Rule set by the owner (DECISIONS.md "Raze close 14"):
 * a dominion's hamlet with no citizen left (its census folk is 0) is razed. The beings still standing on its parcels are
 * evicted to the nearest hamlet of the same dominion, or the nearest hamlet overall when it has none. With beings to evict and
 * no hamlet to take them, nothing is razed. The Folk among the evicted feel the raze moods (feelRazed), the hamlet's parcels
 * leave the dominion (no owner), and the caller counts the razes. Only owned hamlets are checked, so a razed hamlet is not
 * razed again. Checks `indices` in order. Draws no randomness.
 */
export function razeStep(ctx: RazeContext, indices: readonly number[]): RazeFall[] {
  const falls: RazeFall[] = [];
  for (const i of indices) {
    const h = ctx.hamlets[i];
    if (!h || h.parcels.size === 0 || h.folk > 0) continue;
    const loser = ctx.ownerOf(h.parcels);
    if (loser === 0) continue;
    const anchor = lowestParcel(h.parcels);
    const anchorsOf = (sameDominion: boolean): number[] =>
      ctx.hamlets.flatMap((o) => (o === h || o.parcels.size === 0 || (sameDominion && ctx.ownerOf(o.parcels) !== loser) ? [] : [lowestParcel(o.parcels)]));
    const beings = ctx.beingsOn(h.parcels);
    const to = nearestAnchor(anchor, anchorsOf(true), ctx.perAxis) ?? nearestAnchor(anchor, anchorsOf(false), ctx.perAxis);
    if (beings.length > 0 && to === undefined) continue;
    const capital = ctx.isCapital(loser, anchor);
    ctx.feelRazed(beings, capital);
    if (to !== undefined && beings.length > 0) ctx.evict(beings, to);
    const from = ctx.dominions.find((d) => d.id === loser);
    for (const p of h.parcels) {
      if (ctx.owner[p] !== loser) continue;
      ctx.owner[p] = 0;
      from?.parcels.delete(p);
    }
    falls.push({ anchor, loser, evicted: beings.length, capital });
  }
  return falls;
}
