import type { Rng } from '../shared/rng.ts';
import { BITE_STATUSES, CLAW_BLEED_CHANCE, ON_HIT_MODIFIERS, ROT_TOUCHED_TRAIT, type EffectStore } from './effects.ts';
import type { BeingStore } from './beings/store.ts';
import { SPECIES } from '../content/beasts.ts';
import { BEING_TRAIT_INDEX } from '../content/traits.ts';

/** Damage types of 08 section 1 that this milestone uses. */
export type DamageType = 'Weapon' | 'Other' | 'Explosion' | 'Fire' | 'Acid' | 'Poison' | 'Starvation' | 'Age' | 'Eaten' | 'Divine' | 'Drowning';

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
  /** Plating the slot's worn gear adds (08 section 6, items hook). Absent means none. */
  equipPlating?(slot: number): number;
  /** Called after a melee Weapon hit lands (not blocked); the items hook wears gear here (08 section 7.4). */
  onWeaponHit?(attacker: number, victim: number): void;
  /** Modifier ids of the weapon a slot wields (08 section 6.3); absent means none. */
  weaponMods?(slot: number): readonly string[];
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

/** Counts every attack timer down by one tick (08 section 2.1: the timer gates the next basic attack). */
export function tickAttackTimers(combat: CombatState, store: BeingStore): void {
  for (let k = 0; k < store.size; k++) {
    const slot = store.at(k);
    const t = combat.attackTimer[slot] ?? 0;
    if (t > 0) combat.attackTimer[slot] = t - 1;
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
 * status multipliers, the melee hit window, and death when vitality runs out. `cause` is the death
 * cause recorded when the hit kills (a bite that kills is 'eaten').
 */
export function applyDamage(
  ctx: CombatContext,
  victim: number,
  raw: number,
  type: DamageType,
  melee: boolean,
  cause: 'combat' | 'eaten' = 'combat',
): HitResult {
  const s = ctx.beings.store;
  if (s.alive[victim] !== 1) return { dealt: 0, blocked: true, killed: false };
  if (melee && ctx.tick < (ctx.combat.hitUntil[victim] ?? 0)) return { dealt: 0, blocked: true, killed: false };
  if (ctx.effects.flag(victim, 'immune')) return { dealt: 0, blocked: true, killed: false };

  let dmg = raw * ctx.effects.multiplier(victim, 'taken');
  if (PLATED.has(type)) {
    const plating = (ctx.combat.plating[victim] ?? 0) + (ctx.equipPlating?.(victim) ?? 0);
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
    ctx.beings.kill(victim, cause);
    return { dealt: dmg, blocked: false, killed: true };
  }
  return { dealt: dmg, blocked: false, killed: false };
}

/**
 * Applies the on-hit statuses of a weapon's modifiers to a living victim (08 section 6.3; chances and
 * statuses from ON_HIT_MODIFIERS). Each modifier rolls on the `combat` stream, so no roll is drawn
 * when the weapon has no such modifier.
 */
export function applyOnHit(ctx: CombatContext, victim: number, mods: readonly string[]): void {
  if (ctx.beings.store.alive[victim] !== 1) return;
  for (const m of mods) {
    const rule = ON_HIT_MODIFIERS[m];
    if (!rule) continue;
    if (rule.chance >= 1 || ctx.rng.next() < rule.chance) ctx.effects.add(victim, rule.status, ctx.tick);
  }
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
  const hit = applyDamage(ctx, victim, raw, 'Weapon', true);
  if (!hit.blocked) {
    ctx.onWeaponHit?.(attacker, victim);
    applyOnHit(ctx, victim, ctx.weaponMods?.(attacker) ?? []);
    if (!hit.killed) sporePuff(ctx, attacker, victim);
  }
  return hit;
}

/** Species whose spore puff bewilders attackers (18a capstroll: puffs at under 30% hp). */
const SPORE_PUFF_SPECIES = 'capstroll';
/** Vitality share under which a spore puff fires (18a). */
const SPORE_PUFF_BELOW = 0.3;

/**
 * Spore puff (18a capstroll, 18c source "spore puff"): a capstroll hurt below 30% vitality puffs at the
 * Being that struck it, which takes `bewildered`. Draws no randomness.
 */
function sporePuff(ctx: CombatContext, attacker: number, victim: number): void {
  const s = ctx.beings.store;
  const species = SPECIES[s.species[victim] ?? -1];
  if (!species || species.id !== SPORE_PUFF_SPECIES) return;
  if ((s.vit[victim] ?? 0) >= SPORE_PUFF_BELOW * (s.maxVit[victim] ?? 0)) return;
  ctx.effects.add(attacker, 'bewildered', ctx.tick);
}

/**
 * Flesh eater's strike on adjacent prey (08 section 2.1 basic attack, 06 section 2.2 bite). The
 * basic claw swing runs when its timer allows; the bite is `floor(0.15 * prey max vitality) + 1` and
 * goes through applyDamage as type Eaten (no plating, no melee window). A kill makes the predator
 * `sated`. Returns the damage dealt to prey this call, and whether the prey died.
 */
export function predate(ctx: CombatContext, predator: number, prey: number): { dealt: number; killed: boolean } {
  let dealt = 0;
  const swing = meleeSwing(ctx, predator, prey, 1);
  if (swing) {
    dealt += swing.dealt;
    if (swing.killed) {
      ctx.effects.add(predator, 'sated', ctx.tick);
      return { dealt, killed: true };
    }
    // Slashes (18c source of bleeding): a landed claw swing may open a wound.
    if (swing.dealt > 0 && ctx.rng.next() < CLAW_BLEED_CHANCE) ctx.effects.add(prey, 'bleeding', ctx.tick);
  }
  const bite = Math.floor(0.15 * (ctx.beings.store.maxVit[prey] ?? 0)) + 1;
  const hit = applyDamage(ctx, prey, bite, 'Eaten', false, 'eaten');
  dealt += hit.dealt;
  if (hit.killed) {
    ctx.effects.add(predator, 'sated', ctx.tick);
  } else if (hit.dealt > 0) {
    applyBiteStatuses(ctx, predator, prey);
  }
  return { dealt, killed: hit.killed };
}

/**
 * The statuses a landed bite applies (18c section 5 sources): the predator's species rule in BITE_STATUSES, and
 * rotting for any predator carrying the `rot_touched` trait. The species rule rolls nothing (chance 1).
 */
function applyBiteStatuses(ctx: CombatContext, predator: number, prey: number): void {
  const s = ctx.beings.store;
  const species = SPECIES[s.species[predator] ?? -1];
  const rule = species ? BITE_STATUSES[species.id] : undefined;
  if (rule && rule.chance >= 1) ctx.effects.add(prey, rule.status, ctx.tick);
  const rot = BEING_TRAIT_INDEX.get(ROT_TOUCHED_TRAIT);
  if (rot !== undefined && s.hasMark(predator, rot)) ctx.effects.add(prey, 'rotting', ctx.tick);
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
  /** Projectile kind id (08 section 3.3), when launched from a kind. */
  kind?: string;
  /** Slot of the shooter, or -1 / absent. */
  shooter?: number;
  /** Weapon modifiers copied at launch; they apply on a direct hit (08 section 6.3). */
  mods?: readonly string[];
  /** Creature blast profile id (08 section 4) detonated on contact or landing. */
  blast?: string;
  /** Sets the landing tile on fire (08 section 3.2 `ignite`). */
  ignite?: boolean;
}

/**
 * Advances projectiles one tick. On arrival each projectile hits the being on its target tile (if
 * any) with `applyDamage` (projectile hits ignore the melee window, 08 section 1), then its on-hit
 * modifiers apply. `onLand` runs for every projectile that arrives (hit or not) so the caller can
 * run blasts and impact effects. Returns the number of hits that landed.
 */
export function stepProjectiles(
  ctx: CombatContext,
  list: Projectile[],
  beingAt: (x: number, y: number) => number,
  onLand?: (p: Projectile, victim: number) => void,
): number {
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
        const hit = applyDamage(ctx, victim, p.damage, p.type, false);
        if (!hit.blocked) applyOnHit(ctx, victim, p.mods ?? []);
        landed++;
      }
      onLand?.(p, victim);
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
