import { G, ground, groundId } from '../content/grounds.ts';
import { biomeOfCover, coverFireChance } from '../content/biomes.ts';
import { FLAG, type Realm } from './realm.ts';
import { applyDamage, type CombatContext, type DamageType } from './combat.ts';
import { scarStage } from './terrain/fire.ts';
import { n4 } from './grid.ts';

/** Blast power of a device explosion, the 'blast' profile (04 section 8.1). */
export const DEVICE_POWER = 3;
/** Devices a single charge chain may detonate (04 section 8.4 throttle; carry-over is not modelled). */
export const CHAIN_LIMIT = 400;

const HOLLOW_IDS: ReadonlySet<number> = new Set([G.dug_deepmere, G.dug_midmere, G.dug_shoal]);

/**
 * Blast hardness of a ground (04 section 8.3, 01 section 4): sea, molten and slime grounds and
 * explosive devices are 0, pits are 2, every other ground is 3. A tile lowers one step when its
 * hardness is at most the blast power.
 */
export function groundHardness(id: number): number {
  const k = ground(id);
  if (k.layer === 'water' || k.layer === 'molten' || k.layer === 'slime' || k.blastRadius > 0) return 0;
  if (HOLLOW_IDS.has(id)) return 2;
  return 3;
}

/** Explosions in the guard window before further blasts are refused (04 section 8.5, TUNE). */
export const GUARD_MAX = 20;
/** Guard level lost per tick (04 section 8.5 decay, TUNE). */
export const GUARD_DECAY = 0.05;

/** Anti-spam guard for blasts (04 section 8.5, simplified): each blast adds 1, decays per tick. */
export class ExplosionGuard {
  level = 0;

  /** Decays the guard by one tick. */
  decay(): void {
    this.level = Math.max(0, this.level - GUARD_DECAY);
  }

  /** Returns true and records a blast when the guard allows it. */
  tryAcquire(): boolean {
    if (this.level >= GUARD_MAX) return false;
    this.level += 1;
    return true;
  }
}

/**
 * Structural context for blasts. Fire is lit through `startFire` so the caller decides which sim
 * function runs (startFire needs the full Sim, so this module does not import it).
 */
export interface ExplosionContext extends CombatContext {
  realm: Realm;
  guard: ExplosionGuard;
  startFire(tile: number, force: boolean): boolean;
}

/**
 * Lowers tile i one step along its `down` chain (sea to pit, soil to strand, pinnacle to crag).
 * Edge-of-realm tiles never lower (01 section 6).
 */
function lowerOneStep(realm: Realm, i: number): void {
  if (realm.hasFlag(i, FLAG.edgeOfRealm)) return;
  const down = ground(realm.ground[i] ?? 0).down;
  if (down) realm.setGround(i, groundId(down));
}

/**
 * Explodes at (cx,cy) (04 section 8 and 08 section 4, reduced). Beings within `radius` take damage
 * falling off linearly with distance; plating does not reduce Explosion damage. Tiles within the
 * radius lose their cover, sink by a falloff amount (craters for radius 2 and up), and flammable
 * tiles near the centre may catch fire. Returns the number of beings hit, or 0 when the guard
 * refuses the blast.
 *
 * `power` is the blast power of 04 section 8.1. When given, a tile whose hardness is at most the
 * power lowers one step, but only after its cover is stripped (cover goes first, 04 section 14 test 2).
 * Without `power` the blast does not change ground, as before, so callers that do not pass it keep
 * their behaviour.
 */
export function explode(
  ctx: ExplosionContext,
  cx: number,
  cy: number,
  radius: number,
  damage: number,
  type: DamageType,
  owner: number,
  power?: number,
): number {
  if (!ctx.guard.tryAcquire()) return 0;
  const realm = ctx.realm;
  const reach = radius + 1;
  void owner;

  // Beings: collect first, because a kill swaps slots in the alive list.
  const hit: number[] = [];
  const store = ctx.beings.store;
  for (let k = 0; k < store.size; k++) {
    const slot = store.at(k);
    const dx = (store.x[slot] ?? 0) - cx;
    const dy = (store.y[slot] ?? 0) - cy;
    if (Math.hypot(dx, dy) <= radius) hit.push(slot);
  }
  for (const slot of hit) {
    const d = Math.hypot((store.x[slot] ?? 0) - cx, (store.y[slot] ?? 0) - cy);
    const dmg = Math.round(damage * (1 - d / reach));
    if (dmg > 0) applyDamage(ctx, slot, dmg, type, false);
  }

  // Tiles.
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (!realm.inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const i = y * realm.side + x;
      const falloff = 1 - d / reach;
      const gid = realm.ground[i] ?? 0;
      const kind = ground(gid);
      const hardEnough = power !== undefined && groundHardness(gid) <= power;
      if (kind.layer === 'water') {
        if (hardEnough) lowerOneStep(realm, i);
        continue;
      }
      const cover = realm.cover[i] ?? 0;
      const flammable = biomeOfCover(cover) >= 0 ? coverFireChance(cover) > 0 : kind.flammable;
      // Cover goes first: a covered tile keeps its ground this blast (04 section 14 test 2).
      const lowerTo = hardEnough && cover === 0 && !realm.hasFlag(i, FLAG.edgeOfRealm) ? kind.down : null;
      realm.setCover(i, 0);
      realm.setScar(i, scarStage(ctx.rng));
      if (radius >= 2) {
        const sink = Math.floor((damage / 10) * falloff);
        if (sink > 0) realm.setElevation(i, (realm.elevation[i] ?? 0) - sink);
      }
      // Applied after the sink, from the ground read before it, so one blast is one chain step.
      if (lowerTo) realm.setGround(i, groundId(lowerTo));
      if (flammable && ctx.rng.next() < falloff * 0.5) ctx.startFire(i, false);
    }
  }
  return hit.length;
}

/**
 * Detonates the explosive device at `origin` and every device reached from it through n4
 * neighbours (04 section 8.4). Each device blasts with its own radius at DEVICE_POWER, turns into
 * cinderscar before its blast (so no tile detonates twice), and passes the chain on with one less
 * wave; a chain stops when the wave runs out. Returns the number of devices detonated.
 */
export function detonateChain(ctx: ExplosionContext, origin: number, owner = -1): number {
  const realm = ctx.realm;
  const side = realm.side;
  const first = ground(realm.ground[origin] ?? 0).blastRadius;
  if (first <= 0) return 0;
  const queue: number[] = [origin];
  const wave: number[] = [first];
  const seen = new Set<number>([origin]);
  let detonated = 0;
  for (let head = 0; head < queue.length && detonated < CHAIN_LIMIT; head++) {
    const i = queue[head] ?? -1;
    const range = wave[head] ?? 0;
    const device = ground(realm.ground[i] ?? 0);
    if (device.blastRadius <= 0) continue;
    realm.setGround(i, G.cinderscar);
    explode(ctx, i % side, Math.floor(i / side), device.blastRadius, device.blastRadius * 10, 'Explosion', owner, DEVICE_POWER);
    detonated++;
    if (range - 1 <= 0) continue;
    for (let k = 0; k < 4; k++) {
      const j = n4(i, side, k);
      if (j < 0 || seen.has(j)) continue;
      if (ground(realm.ground[j] ?? 0).blastRadius <= 0) continue;
      seen.add(j);
      queue.push(j);
      wave.push(range - 1);
    }
  }
  return detonated;
}
