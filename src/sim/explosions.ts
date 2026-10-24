import { ground } from '../content/grounds.ts';
import { biomeOfCover, coverFireChance } from '../content/biomes.ts';
import type { Realm } from './realm.ts';
import { applyDamage, type CombatContext, type DamageType } from './combat.ts';
import { scarStage } from './terrain/fire.ts';

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
 * Explodes at (cx,cy) (04 section 8 and 08 section 4, reduced). Beings within `radius` take damage
 * falling off linearly with distance; plating does not reduce Explosion damage. Tiles within the
 * radius lose their cover, sink by a falloff amount (craters for radius 2 and up), and flammable
 * tiles near the centre may catch fire. Returns the number of beings hit, or 0 when the guard
 * refuses the blast.
 */
export function explode(
  ctx: ExplosionContext,
  cx: number,
  cy: number,
  radius: number,
  damage: number,
  type: DamageType,
  owner: number,
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
      const kind = ground(realm.ground[i] ?? 0);
      if (kind.layer === 'water') continue;
      const cover = realm.cover[i] ?? 0;
      const flammable = biomeOfCover(cover) >= 0 ? coverFireChance(cover) > 0 : kind.flammable;
      realm.setCover(i, 0);
      realm.setScar(i, scarStage(ctx.rng));
      if (radius >= 2) {
        const sink = Math.floor((damage / 10) * falloff);
        if (sink > 0) realm.setElevation(i, (realm.elevation[i] ?? 0) - sink);
      }
      if (flammable && ctx.rng.next() < falloff * 0.5) ctx.startFire(i, false);
    }
  }
  return hit.length;
}
