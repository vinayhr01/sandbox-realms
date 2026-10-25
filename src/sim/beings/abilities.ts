/**
 * Architect abilities (07 section 13, beings close 5). The possession command carries six one-shot flags. Each runs once, on
 * the tick the command is applied, against the controlled Being. The order tile and the control itself are set first by
 * possession.ts. 07 names the abilities and gives the numbers only for kick (stun, push 1.5 to 3 tiles) and steal (within
 * 2 tiles); the rest are TUNE choices, recorded in DECISIONS.md "Beings close 5". Draws only from the `beings` stream.
 */
import { ground } from '../../content/grounds.ts';
import type { Sim } from '../sim.ts';
import { unwear, wear } from '../items/system.ts';
import { isAccursed } from '../items/store.ts';
import { addMood } from './social.ts';
import { MAX_BEINGS } from './store.ts';
import { ROUND9 } from './tuning.ts';
import { walkable } from './system.ts';

/** The ability flags of a possession command (absent flags are false). */
export interface PossessAbilities {
  kick?: boolean;
  jump?: boolean;
  talk?: boolean;
  dash?: boolean;
  steal?: boolean;
  swear?: boolean;
}

/** Runs the flagged abilities of one Being. `beingId` is generation * MAX_BEINGS + slot, as in possessCommand. */
export function possessAbilities(sim: Sim, beingId: number, flags: PossessAbilities): void {
  const slot = beingId % MAX_BEINGS;
  if (sim.beings.store.alive[slot] !== 1) return;
  if (flags.kick) kick(sim, slot);
  if (flags.jump) jump(sim, slot);
  if (flags.dash) dash(sim, slot);
  if (flags.talk) talk(sim, slot);
  if (flags.steal) steal(sim, slot);
  if (flags.swear) swear(sim, slot);
}

/** Sign of a difference, with 0 replaced by 1 so a push always has a direction. */
function towards(d: number): number {
  return d < 0 ? -1 : 1;
}

/** Whether a tile can take a pushed Being: walkable land or water, not molten or slime (a push may end in liquid). */
function pushable(sim: Sim, x: number, y: number): boolean {
  const side = sim.realm.side;
  if (x < 0 || y < 0 || x >= side || y >= side) return false;
  const i = y * side + x;
  const kind = ground(sim.realm.ground[i] ?? 0);
  return walkable(sim.realm, i) || (kind.layer === 'water' && kind.damages === 0);
}

/** Kick (07 section 13): the nearest Being beside the controlled one is stunned (`dazed`) and pushed 1.5 to 3 tiles away. */
function kick(sim: Sim, slot: number): void {
  const b = sim.beings;
  const s = b.store;
  const foe = b.nearest(slot, (o) => o !== slot && s.alive[o] === 1, ROUND9.kickRange);
  if (foe < 0) return;
  sim.effects.add(foe, 'dazed', sim.tick);
  const reach = ROUND9.kickPushMin + sim.rng('beings').next() * (ROUND9.kickPushMax - ROUND9.kickPushMin);
  const dist = Math.round(reach);
  const dx = towards((s.x[foe] ?? 0) - (s.x[slot] ?? 0));
  const dy = towards((s.y[foe] ?? 0) - (s.y[slot] ?? 0));
  for (let n = 0; n < dist; n++) {
    const nx = (s.x[foe] ?? 0) + dx;
    const ny = (s.y[foe] ?? 0) + dy;
    if (!pushable(sim, nx, ny)) break;
    s.x[foe] = nx;
    s.y[foe] = ny;
  }
}

/** The direction from the controlled Being toward its order tile, or null when it stands on that tile. */
function orderDirection(sim: Sim, slot: number): [number, number] | null {
  const s = sim.beings.store;
  const x = s.x[slot] ?? 0;
  const y = s.y[slot] ?? 0;
  const tx = s.orderX[slot] ?? 0;
  const ty = s.orderY[slot] ?? 0;
  if (x === tx && y === ty) return null;
  return [Math.sign(tx - x), Math.sign(ty - y)];
}

/**
 * Jump (TUNE): lands on the farthest walkable land tile up to `jumpTiles` along the order direction, passing over what lies
 * between. Stays put when no landing tile is free.
 */
function jump(sim: Sim, slot: number): void {
  const dir = orderDirection(sim, slot);
  if (!dir) return;
  const s = sim.beings.store;
  const x = s.x[slot] ?? 0;
  const y = s.y[slot] ?? 0;
  for (let n = ROUND9.jumpTiles; n >= 1; n--) {
    const nx = x + dir[0] * n;
    const ny = y + dir[1] * n;
    if (nx < 0 || ny < 0 || nx >= sim.realm.side || ny >= sim.realm.side) continue;
    if (!walkable(sim.realm, ny * sim.realm.side + nx)) continue;
    s.x[slot] = nx;
    s.y[slot] = ny;
    return;
  }
}

/** Dash (TUNE): up to `dashTiles` walkable steps toward the order tile, at no movement cost (the order is the command). */
function dash(sim: Sim, slot: number): void {
  const dir = orderDirection(sim, slot);
  if (!dir) return;
  const s = sim.beings.store;
  for (let n = 0; n < ROUND9.dashTiles; n++) {
    const nx = (s.x[slot] ?? 0) + dir[0];
    const ny = (s.y[slot] ?? 0) + dir[1];
    if (nx < 0 || ny < 0 || nx >= sim.realm.side || ny >= sim.realm.side) break;
    if (!walkable(sim.realm, ny * sim.realm.side + nx)) break;
    s.x[slot] = nx;
    s.y[slot] = ny;
  }
}

/**
 * Talk (07 section 13): the nearest Being within two tiles gains `tagalong`, so it follows the controlled Being. 30% of the
 * talks surprise it (mood `talked_badly`); the rest leave it well (mood `talked_well`). The custom, creed and dialect
 * imposition is not built: the culture layer is inert in play.
 */
function talk(sim: Sim, slot: number): void {
  const b = sim.beings;
  const s = b.store;
  const other = b.nearest(slot, (o) => o !== slot && s.alive[o] === 1, ROUND9.talkRange);
  if (other < 0) return;
  const surprised = sim.rng('beings').next() < ROUND9.talkSurprise;
  addMood(sim, other, surprised ? 'talked_badly' : 'talked_well');
  sim.effects.add(other, 'tagalong', sim.tick);
}

/**
 * Steal (07 section 13, within 2 tiles): takes one worn item from the nearest Being in reach and wears it in the same equipment
 * slot of the controlled Being, when that slot is empty. Accursed items cannot be taken (08 section 6.3).
 */
function steal(sim: Sim, slot: number): void {
  const b = sim.beings;
  const s = b.store;
  const items = sim.items;
  const victim = b.nearest(slot, (o) => o !== slot && s.alive[o] === 1 && items.wornBy(o).some((id) => id !== 0), ROUND9.stealRange);
  if (victim < 0) return;
  const index = items.wornBy(victim).findIndex((id) => id !== 0);
  if (index < 0 || items.gearAt(slot, index) !== 0) return;
  const worn = items.get(items.gearAt(victim, index));
  if (!worn || isAccursed(worn)) return;
  const taken = unwear(sim, victim, index);
  if (taken) wear(sim, slot, index, taken);
}

/** Swear (TUNE; 07 section 13 names it only): Beings within three tiles take the `talked_badly` mood. */
function swear(sim: Sim, slot: number): void {
  const b = sim.beings;
  const s = b.store;
  for (const o of b.within(slot, (x) => x !== slot && s.alive[x] === 1, ROUND9.swearRange)) addMood(sim, o, 'talked_badly');
}
