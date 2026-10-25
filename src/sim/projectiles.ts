/**
 * Projectile kinds, creature blast profiles and launches (08 sections 2.1, 3 and 4). The 16 kinds of
 * 08 section 3.3 are data here; flight and landing are in combat.ts (stepProjectiles) and this file
 * supplies the launch from worn ranged weapons, the landing blast and the impact ignite.
 *
 * Not modelled (the flags of 08 section 3 with no mechanic yet): `blockable` (no block pool),
 * `stayOnGround` fade, `hitFreeze`, `hitShake`, `lookAtTarget`, the 3D arc and the in-flight collision
 * with other Beings (a projectile hits what stands on its target tile when it arrives).
 */
import type { Sim } from './sim.ts';
import { ATTACK_TICKS, type DamageType, type Projectile } from './combat.ts';
import { explode } from './explosions.ts';
import { startFire } from './terrain/fire.ts';

/** Ticks per second (17: 20 ticks/s); spec speeds are tiles per second. */
const TICKS_PER_SECOND = 20;
/** Live projectiles allowed at once; launches beyond this are refused. */
export const MAX_PROJECTILES = 256;
/** Projectiles per volley, however large the weapon's data says (keeps one volley bounded). */
export const MAX_VOLLEY = 12;
/** Reach of a ranged weapon whose data names none, in tiles. */
const RANGED_REACH = 6;

export interface ProjectileKind {
  id: string;
  /** Tiles per second (08 3.1 `speed`). */
  speed: number;
  /** Extra random speed in tiles per second, drawn uniformly (08 3.1 `speedRandom`). */
  speedRandom: number;
  /** Explodes on contact (08 3.1 `explodeOnContact`). */
  collide: boolean;
  /** Creature blast profile detonated where it lands (08 section 4), or null. */
  blast: string | null;
  /** Sets the landing tile alight (08 3.2 `ignite`). */
  ignite: boolean;
  damageType: DamageType;
}

/** The 16 projectile kinds of 08 section 3.3 (speeds TUNE). */
export const PROJECTILE_KINDS: readonly ProjectileKind[] = [
  { id: 'flint_dart', speed: 18, speedRandom: 0, collide: false, blast: null, ignite: false, damageType: 'Weapon' },
  { id: 'snow_pellet', speed: 22, speedRandom: 0, collide: false, blast: null, ignite: false, damageType: 'Weapon' },
  { id: 'powder_flask', speed: 10, speedRandom: 0, collide: true, blast: 'flaskburst', ignite: false, damageType: 'Fire' },
  { id: 'pitch_torch', speed: 13, speedRandom: 0, collide: true, blast: 'torchflare', ignite: false, damageType: 'Fire' },
  { id: 'ember_orb', speed: 22, speedRandom: 4, collide: true, blast: null, ignite: true, damageType: 'Fire' },
  { id: 'rime_orb', speed: 18, speedRandom: 0, collide: true, blast: null, ignite: false, damageType: 'Other' },
  { id: 'sap_orb', speed: 18, speedRandom: 0, collide: true, blast: null, ignite: false, damageType: 'Other' },
  { id: 'knuckle_bone', speed: 14, speedRandom: 0, collide: false, blast: null, ignite: false, damageType: 'Weapon' },
  { id: 'arc_sphere', speed: 36, speedRandom: 0, collide: true, blast: 'arcburst', ignite: false, damageType: 'Other' },
  { id: 'wail_skull', speed: 15, speedRandom: 0, collide: true, blast: null, ignite: false, damageType: 'Other' },
  { id: 'blaze_sphere', speed: 27, speedRandom: 0, collide: true, blast: 'blazeburst', ignite: false, damageType: 'Fire' },
  { id: 'frenzy_sphere', speed: 27, speedRandom: 0, collide: true, blast: 'frenzyburst', ignite: false, damageType: 'Other' },
  { id: 'hurled_stone', speed: 18, speedRandom: 0, collide: false, blast: null, ignite: false, damageType: 'Weapon' },
  { id: 'scatter_shot', speed: 34, speedRandom: 6, collide: false, blast: 'scatterblast', ignite: false, damageType: 'Weapon' },
  { id: 'siege_ball', speed: 22, speedRandom: 0, collide: false, blast: 'siegeburst', ignite: false, damageType: 'Other' },
  { id: 'acid_glob', speed: 22, speedRandom: 0, collide: false, blast: 'acidburst', ignite: false, damageType: 'Acid' },
];

export const PROJECTILE_BY_ID: ReadonlyMap<string, ProjectileKind> = new Map(PROJECTILE_KINDS.map((k) => [k.id, k]));

/**
 * Creature blast profiles (08 section 4). `force` dazes Beings in the radius (04 8.2 step 3, dazed
 * 4 s); `fire` scorches them (the fire status of 04); `frenzy` applies frenzy (frenzyburst).
 */
interface CreatureBlast {
  radius: number;
  damage: number;
  type: DamageType;
  fire: boolean;
  force: boolean;
  frenzy: boolean;
}

const CREATURE_BLASTS: Readonly<Record<string, CreatureBlast>> = {
  flaskburst: { radius: 2, damage: 30, type: 'Fire', fire: true, force: false, frenzy: false },
  torchflare: { radius: 1, damage: 25, type: 'Fire', fire: true, force: false, frenzy: false },
  arcburst: { radius: 2, damage: 30, type: 'Explosion', fire: false, force: false, frenzy: false },
  blazeburst: { radius: 3, damage: 30, type: 'Fire', fire: true, force: false, frenzy: false },
  siegeburst: { radius: 2, damage: 0, type: 'Other', fire: false, force: true, frenzy: false },
  scatterblast: { radius: 0, damage: 0, type: 'Other', fire: false, force: false, frenzy: false },
  frenzyburst: { radius: 3, damage: 0, type: 'Other', fire: false, force: true, frenzy: true },
  acidburst: { radius: 2, damage: 0, type: 'Acid', fire: false, force: false, frenzy: false },
};

/** Slots of the living Beings within `radius` tiles of (x, y). */
function beingsWithin(sim: Sim, x: number, y: number, radius: number): number[] {
  const s = sim.beings.store;
  const out: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (Math.hypot((s.x[slot] ?? 0) - x, (s.y[slot] ?? 0) - y) <= radius) out.push(slot);
  }
  return out;
}

/** Runs one creature blast at (x, y): terrain and damage through explode, then its statuses. */
function creatureBlast(sim: Sim, id: string, x: number, y: number, shooter: number): void {
  const b = CREATURE_BLASTS[id];
  if (!b) return;
  if (b.damage > 0) explode(sim.explosionContext(), x, y, b.radius, b.damage, b.type, shooter);
  if (!b.fire && !b.force && !b.frenzy) return;
  const s = sim.beings.store;
  for (const slot of beingsWithin(sim, x, y, b.radius)) {
    if (s.alive[slot] !== 1) continue;
    if (b.fire) sim.effects.add(slot, 'scorched', sim.tick);
    if (b.force) sim.effects.add(slot, 'dazed', sim.tick);
    if (b.frenzy) sim.effects.add(slot, 'frenzy', sim.tick);
  }
}

/**
 * Queues one projectile of a kind from (sx, sy) toward (tx, ty). `damage` is the direct-hit damage
 * the shooter's stats gave at launch, and `mods` the weapon's modifiers. Returns false when the kind
 * is unknown or the live cap is reached.
 */
export function launchProjectile(
  sim: Sim,
  kindId: string,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  shooter: number,
  damage: number,
  mods: readonly string[],
): boolean {
  const kind = PROJECTILE_BY_ID.get(kindId);
  if (!kind || sim.projectiles.length >= MAX_PROJECTILES) return false;
  const v = kind.speed + (kind.speedRandom > 0 ? sim.rng('projectiles').next() * kind.speedRandom : 0);
  const p: Projectile = {
    x: sx,
    y: sy,
    tx,
    ty,
    speed: v / TICKS_PER_SECOND,
    damage,
    type: kind.damageType,
    collide: kind.collide,
    alive: true,
    kind: kind.id,
    shooter,
    mods: [...mods],
    ...(kind.blast ? { blast: kind.blast } : {}),
    ...(kind.ignite ? { ignite: true } : {}),
  };
  sim.projectiles.push(p);
  return true;
}

interface RangedWeapon {
  projectile: string;
  reach: number;
  volley: number;
  mods: readonly string[];
}

/** The first working ranged weapon a Being wields (08 section 6.2 bow and staff kinds), or null. */
function rangedWeaponOf(sim: Sim, slot: number): RangedWeapon | null {
  for (const id of sim.items.wornBy(slot)) {
    if (id <= 0) continue;
    const kind = sim.items.kindOf(id);
    const inst = sim.items.get(id);
    if (!kind || !inst || kind.slot !== 'weapon' || kind.attack !== 'ranged' || inst.durability <= 0) continue;
    const projectile = kind.extra.projectile;
    if (typeof projectile !== 'string' || !PROJECTILE_BY_ID.has(projectile)) continue;
    const volley = typeof kind.extra.volley === 'number' ? kind.extra.volley : 1;
    return { projectile, reach: kind.reach > 0 ? kind.reach : RANGED_REACH, volley, mods: inst.mods };
  }
  return null;
}

/** Whether `other` is prey of `slot`'s species (the hunt list of 07). */
function isPrey(sim: Sim, slot: number, other: number): boolean {
  if (other === slot) return false;
  const s = sim.beings.store;
  const rt = sim.beings.runtime[s.species[slot] ?? 0];
  return !!rt && rt.prey.includes(s.species[other] ?? -1);
}

/**
 * Launch step (08 section 2.1, ranged basic attack): each Being with a ready attack timer and a
 * ranged weapon shoots a volley at the nearest prey within the weapon's reach. Runs once per tick
 * before the projectiles move.
 */
export function shootStep(sim: Sim): void {
  const s = sim.beings.store;
  const ctx = sim.combatContext();
  for (let k = 0; k < s.size; k++) {
    if (sim.projectiles.length >= MAX_PROJECTILES) return;
    const slot = s.at(k);
    if ((sim.combat.attackTimer[slot] ?? 0) > 0) continue;
    const weapon = rangedWeaponOf(sim, slot);
    if (!weapon) continue;
    const prey = sim.beings.nearest(slot, (o) => isPrey(sim, slot, o), weapon.reach);
    if (prey < 0) continue;
    sim.combat.attackTimer[slot] = ATTACK_TICKS;
    const sx = s.x[slot] ?? 0;
    const sy = s.y[slot] ?? 0;
    const tx = s.x[prey] ?? 0;
    const ty = s.y[prey] ?? 0;
    const volley = Math.min(weapon.volley, MAX_VOLLEY);
    for (let v = 0; v < volley; v++) {
      const raw = Math.floor(ctx.might(slot) * (0.5 + ctx.rng.next() * 0.5) * ctx.effects.multiplier(slot, 'damage'));
      if (!launchProjectile(sim, weapon.projectile, sx, sy, tx, ty, slot, raw, weapon.mods)) break;
    }
  }
}

/**
 * Landing of a projectile (after its direct hit, if any): the impact ignite on the landing tile and
 * the blast profile of the kind, wherever it lands.
 */
export function landProjectile(sim: Sim, p: Projectile): void {
  const x = Math.round(p.tx);
  const y = Math.round(p.ty);
  if (!sim.realm.inBounds(x, y)) return;
  if (p.ignite) startFire(sim, y * sim.realm.side + x, true);
  if (p.blast) creatureBlast(sim, p.blast, x, y, p.shooter ?? -1);
}
