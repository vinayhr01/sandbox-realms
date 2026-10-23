import type { Rng } from '../shared/rng.ts';
import type { EffectStore } from './effects.ts';
import type { BeingStore } from './beings/store.ts';

/** Damage types of 08 section 1 that this milestone uses. */
export type DamageType = 'Weapon' | 'Other' | 'Explosion' | 'Fire' | 'Acid' | 'Poison' | 'Starvation' | 'Age' | 'Eaten' | 'Divine';

/** Types that plating reduces (08 section 1: plating applies only to Weapon and Other). */
const PLATED = new Set<DamageType>(['Weapon', 'Other']);

/** Hit-immunity window for melee hits, in ticks (08 section 1: 6). */
export const HIT_WINDOW = 6;
/** Ticks between basic attacks at tempo 1 (08 section 2.1: round(20 / tempo)). */
export const ATTACK_TICKS = 20;

/** What combat needs from the sim (kept structural so combat does not import Sim). */
export interface CombatContext {
  beings: { store: BeingStore; kill(slot: number, cause: 'eaten' | 'starved' | 'age' | 'combat'): void };
  effects: EffectStore;
  combat: CombatState;
  tick: number;
  rng: Rng;
  /** Species might (base attack) for a slot. */
  might(slot: number): number;
}

/** Per-being combat state: plating, the hit window and the attack timer. */
export class CombatState {
  readonly plating: Uint8Array;
  readonly hitUntil: Uint32Array;
  readonly attackTimer: Uint16Array;

  constructor(capacity: number) {
    this.plating = new Uint8Array(capacity);
    this.hitUntil = new Uint32Array(capacity);
    this.attackTimer = new Uint16Array(capacity);
  }
}

export interface HitResult {
  /** Damage actually removed from vitality. */
  dealt: number;
  /** The hit was inside the melee window or the being is immune. */
  blocked: boolean;
  /** The hit killed the being. */
  killed: boolean;
}

/**
 * Applies a raw hit (08 section 2.3 applyDamage): plating for Weapon and Other, the minimum of 1,
 * status multipliers, the melee hit window, and death when vitality runs out.
 */
export function applyDamage(ctx: CombatContext, victim: number, raw: number, type: DamageType, melee: boolean): HitResult {
  const s = ctx.beings.store;
  if (s.alive[victim] !== 1) return { dealt: 0, blocked: true, killed: false };
  if (melee && ctx.tick < (ctx.combat.hitUntil[victim] ?? 0)) return { dealt: 0, blocked: true, killed: false };
  if (ctx.effects.flag(victim, 'immune')) return { dealt: 0, blocked: true, killed: false };

  let dmg = raw * ctx.effects.multiplier(victim, 'taken');
  if (PLATED.has(type)) {
    const plating = ctx.combat.plating[victim] ?? 0;
    // Integer math: 40 * 90 / 100 must be exactly 36 (floating point gives 35.99).
    dmg = Math.floor((dmg * (100 - plating)) / 100);
    dmg = Math.max(1, dmg);
  } else {
    dmg = Math.trunc(dmg);
  }
  if (dmg <= 0) return { dealt: 0, blocked: false, killed: false };

  s.vit[victim] = (s.vit[victim] ?? 0) - dmg;
  ctx.combat.hitUntil[victim] = ctx.tick + HIT_WINDOW;
  if (ctx.effects.flag(victim, 'endsOnHit')) ctx.effects.clear(victim);

  if ((s.vit[victim] ?? 0) <= 0) {
    ctx.beings.kill(victim, 'combat');
    return { dealt: dmg, blocked: false, killed: true };
  }
  return { dealt: dmg, blocked: false, killed: false };
}

/**
 * Basic melee swing (08 section 2.1 and 2.3, reduced): reach 1, damage uniform in [0.5, 1] of
 * might (times the attacker's damage multiplier), 5% crit for double. Returns the hit or null when
 * the attack is not available yet or out of reach.
 */
export function meleeSwing(ctx: CombatContext, attacker: number, victim: number, dist: number): HitResult | null {
  const timer = ctx.combat.attackTimer[attacker] ?? 0;
  if (timer > 0) return null;
  if (dist > 1) return null;
  ctx.combat.attackTimer[attacker] = ATTACK_TICKS;
  const spread = 0.5 + ctx.rng.next() * 0.5;
  let raw = Math.floor(ctx.might(attacker) * spread * ctx.effects.multiplier(attacker, 'damage'));
  if (ctx.rng.next() < 0.05) raw *= 2;
  return applyDamage(ctx, victim, raw, 'Weapon', true);
}

/** Flying projectile (08 section 3.1, reduced): flies to a tile at a speed and hits what is there. */
export interface Projectile {
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** Tiles per tick. */
  speed: number;
  damage: number;
  type: DamageType;
  /** Explodes on contact (08 section 3: collide Y) instead of landing. */
  collide: boolean;
  alive: boolean;
}

/**
 * Advances projectiles one tick. On arrival each projectile hits the being on its target tile (if
 * any) with `applyDamage` (projectile hits ignore the melee window, 08 section 1). Returns the
 * number of hits that landed.
 */
export function stepProjectiles(ctx: CombatContext, list: Projectile[], beingAt: (x: number, y: number) => number): number {
  let landed = 0;
  for (const p of list) {
    if (!p.alive) continue;
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= p.speed) {
      p.x = p.tx;
      p.y = p.ty;
      p.alive = false;
      const victim = beingAt(Math.round(p.tx), Math.round(p.ty));
      if (victim >= 0) {
        applyDamage(ctx, victim, p.damage, p.type, false);
        landed++;
      }
    } else {
      p.x += (dx / d) * p.speed;
      p.y += (dy / d) * p.speed;
    }
  }
  // Drop spent projectiles in place so the list stays small.
  let w = 0;
  for (let r = 0; r < list.length; r++) {
    const p = list[r];
    if (p && p.alive) list[w++] = p;
  }
  list.length = w;
  return landed;
}
