/**
 * Projectile kinds, creature blast profiles and launches (08 sections 2.1, 2.4, 3 and 4). The 16 kinds of
 * 08 section 3.3 are data here; flight and landing are in combat.ts (stepProjectiles) and this file
 * supplies the launches (worn ranged weapons and the thrower skills), the landing blast, the impact ignite
 * and the device triggers of 04 section 8.4 (devices.ts, polled from the launch step).
 *
 * Owners: the weapons of items.ts (`scatter_shot`, `arc_sphere`, `wail_skull`, `ember_orb`, `rime_orb`, `sap_orb`, `flint_dart`),
 * the thrower skills (`powder_flask`, `pitch_torch`), the Brazier Tower (`blaze_sphere`, brazierStep), the Watchspire
 * (`flint_dart` bolts, watchspireStep) and a trading boat's
 * cannon (`siege_ball`, boats.ts through Sim.volley). `snow_pellet`, `knuckle_bone`, `hurled_stone`, `frenzy_sphere` and
 * `acid_glob` have no owner in the spec (DECISIONS.md, Combat close 5).
 *
 * Not modelled (the flags of 08 section 3 with no mechanic yet): `blockable` (no block pool),
 * `stayOnGround` fade, `hitFreeze`, `hitShake`, `lookAtTarget`, the 3D arc and the in-flight collision
 * with other Beings (a projectile hits what stands on its target tile when it arrives).
 */
import type { Sim } from './sim.ts';
import { ATTACK_TICKS, type CombatContext, type DamageType, type Projectile } from './combat.ts';
import { explode } from './explosions.ts';
import { startFire } from './terrain/fire.ts';
import { BEING_TRAIT_INDEX } from '../content/traits.ts';
import type { BombProfile } from '../content/powers.ts';
import { detonateBomb } from './powers/handlers.ts';
import { deviceStruck, devicesStep } from './devices.ts';
import { hamletsOf } from './settlements/adapter.ts';
import { PATCH_SHIFT } from '../shared/constants.ts';
import { relation, type Faction } from './beings/hostility.ts';

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

/** Thrower skills (08 section 2.4 `lob_pot`, `lob_brand`): the trait that grants each, and the projectile it throws. */
const LOB_TRAITS: readonly { trait: string; projectile: string }[] = [
  { trait: 'powderhurler', projectile: 'powder_flask' },
  { trait: 'torchhurler', projectile: 'pitch_torch' },
];
/** Lob target range in tiles (08 2.4: 6..50). */
const LOB_MIN = 6;
const LOB_MAX = 50;
/** Ticks between lobs (08 2.4 cooldown 160). */
const LOB_TICKS = 160;
/** Chance a ready thrower lobs this tick (08 2.4 base chance 0.2, before skill). */
const LOB_CHANCE = 0.2;

/** The projectile a Being's thrower trait throws, or null. */
function lobProjectileOf(sim: Sim, slot: number): string | null {
  const s = sim.beings.store;
  for (const t of LOB_TRAITS) {
    const k = BEING_TRAIT_INDEX.get(t.trait);
    if (k !== undefined && s.hasMark(slot, k)) return t.projectile;
  }
  return null;
}

/**
 * Thrower action of a Being with no ranged weapon: at the nearest prey 6 to 50 tiles away it throws its
 * flask or torch. A ready thrower that does not lob waits one basic-attack interval, not the lob cooldown.
 */
function lobStep(sim: Sim, ctx: CombatContext, slot: number): void {
  const projectile = lobProjectileOf(sim, slot);
  if (!projectile) return;
  const s = sim.beings.store;
  const prey = sim.beings.nearest(slot, (o) => isPrey(sim, slot, o), LOB_MAX);
  if (prey < 0) return;
  const sx = s.x[slot] ?? 0;
  const sy = s.y[slot] ?? 0;
  const tx = s.x[prey] ?? 0;
  const ty = s.y[prey] ?? 0;
  if (Math.hypot(tx - sx, ty - sy) < LOB_MIN) return;
  if (sim.rng('projectiles').next() >= LOB_CHANCE) {
    sim.combat.attackTimer[slot] = ATTACK_TICKS;
    return;
  }
  sim.combat.attackTimer[slot] = LOB_TICKS;
  const raw = Math.floor(ctx.might(slot) * (0.5 + ctx.rng.next() * 0.5) * ctx.effects.multiplier(slot, 'damage'));
  launchProjectile(sim, projectile, sx, sy, tx, ty, slot, raw, []);
}

/**
 * Brazier Tower (18e 3.1, the owner of `blaze_sphere` with the magmaling gear, which 18c and 08 do not define): fires one
 * blaze sphere at the nearest enemy Being within BRAZIER_RANGE, then reloads for BRAZIER_RELOAD ticks (6 s). An enemy is
 * a Being hostile (`H`) to Folk (07 section 9.4); the spec gives no other rule. The reload is kept per building object,
 * so a loaded realm starts with every tower ready. The blast (blazeburst: 30 Fire, radius 3) runs on landing.
 */
const BRAZIER_RANGE = 14;
const BRAZIER_RELOAD = 120;
const FOLK_FACTION: Faction = { kind: 'folk', id: 0 };
const brazierReload = new WeakMap<object, number>();

/** Nearest living Being hostile to Folk within `range` tiles of (x, y), or -1. */
function nearestEnemyOf(sim: Sim, x: number, y: number, range: number): number {
  const s = sim.beings.store;
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (s.alive[slot] !== 1) continue;
    const d = Math.hypot((s.x[slot] ?? 0) - x, (s.y[slot] ?? 0) - y);
    if (d > range || d >= bestD) continue;
    const rt = sim.beings.runtime[s.species[slot] ?? 0];
    if (!rt || relation(rt.faction, FOLK_FACTION, false) !== 'H') continue;
    best = slot;
    bestD = d;
  }
  return best;
}

/** One step of every Brazier Tower in every hamlet: reload, then fire at the nearest enemy in range. */
function brazierStep(sim: Sim): void {
  for (const h of hamletsOf(sim)) {
    for (const b of h.buildings) {
      if (b.def.id !== 'brazier_tower') continue;
      const left = brazierReload.get(b) ?? 0;
      if (left > 0) {
        brazierReload.set(b, left - 1);
        continue;
      }
      // Centre of the 2x2 footprint, in tile units (the origin tile is the top-left one).
      const cx = b.x + 0.5;
      const cy = b.y + 0.5;
      const target = nearestEnemyOf(sim, cx, cy, BRAZIER_RANGE);
      if (target < 0) continue;
      const s = sim.beings.store;
      if (launchProjectile(sim, 'blaze_sphere', cx, cy, s.x[target] ?? 0, s.y[target] ?? 0, -1, 0, [])) brazierReload.set(b, BRAZIER_RELOAD);
    }
  }
}

/**
 * Watchspire (10 section 9, 18c section 4.1 row): five bolts per volley at the attackers in its 3x3 patches, 45 damage each,
 * reload 3 s. The scan timer is `60 + randomInt(0,60)` ticks (10 section 9), drawn after every scan, so a scan with no target
 * waits the same time as one that fires (the spec gives no rule for an empty scan). The first scan is at 20 ticks.
 * Bolts are `flint_dart` (18c section 6 has no bolt kind, and its 16 kinds are an acceptance test). Targets are living Beings
 * hostile to Folk (07 section 9.4, as the Brazier Tower). Not modelled: buildings as targets (building damage is unsimulated),
 * and the 10 section 9 immunities for flying, inside and protected Beings (the sim has no such state). The candidate rule
 * (more than 50 candidates: 40% chance of a random pick; a candidate at squared distance 4 or less wins at once) is the spec's.
 */
/** Patch side in tiles (16): the watchspire scans its own patch and the eight around it. */
const PATCH = 1 << PATCH_SHIFT;
const WATCH_BOLTS = 5;
const WATCH_DAMAGE = 45;
const WATCH_RELOAD = 60;
const WATCH_SCAN_JITTER = 60;
const WATCH_FIRST_SCAN = 20;
const WATCH_RANDOM_OVER = 50;
const WATCH_RANDOM_CHANCE = 0.4;
const WATCH_NEAR_SQ = 4;
const watchTimer = new WeakMap<object, number>();

/** Living Beings hostile to Folk within the 3x3 patches around patch (px, py), in store order. */
function watchCandidates(sim: Sim, px: number, py: number): number[] {
  const s = sim.beings.store;
  const out: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (s.alive[slot] !== 1) continue;
    const dpx = Math.floor((s.x[slot] ?? 0) / PATCH) - px;
    const dpy = Math.floor((s.y[slot] ?? 0) / PATCH) - py;
    if (Math.abs(dpx) > 1 || Math.abs(dpy) > 1) continue;
    const rt = sim.beings.runtime[s.species[slot] ?? 0];
    if (!rt || relation(rt.faction, FOLK_FACTION, false) !== 'H') continue;
    out.push(slot);
  }
  return out;
}

/** The Being a watchspire at (cx, cy) in patch (px, py) shoots at, or -1 (see the block comment above). */
function watchTarget(sim: Sim, cx: number, cy: number, px: number, py: number): number {
  const cand = watchCandidates(sim, px, py);
  if (cand.length === 0) return -1;
  const rng = sim.rng('projectiles');
  if (cand.length > WATCH_RANDOM_OVER && rng.next() < WATCH_RANDOM_CHANCE) return cand[rng.int(cand.length)] ?? -1;
  const s = sim.beings.store;
  let best = -1;
  let bestD = Infinity;
  for (const slot of cand) {
    const dx = (s.x[slot] ?? 0) - cx;
    const dy = (s.y[slot] ?? 0) - cy;
    const d = dx * dx + dy * dy;
    if (d <= WATCH_NEAR_SQ) return slot;
    if (d < bestD) {
      best = slot;
      bestD = d;
    }
  }
  return best;
}

/** One step of every Watchspire in every hamlet: count the scan timer down, then scan and fire a volley at the target. */
function watchspireStep(sim: Sim): void {
  for (const h of hamletsOf(sim)) {
    for (const b of h.buildings) {
      if (b.def.id !== 'watchspire') continue;
      const left = watchTimer.get(b) ?? WATCH_FIRST_SCAN;
      if (left > 0) {
        watchTimer.set(b, left - 1);
        continue;
      }
      watchTimer.set(b, WATCH_RELOAD + sim.rng('projectiles').int(WATCH_SCAN_JITTER + 1));
      // Centre of the footprint, in tile units (the origin tile is the top-left one).
      const cx = b.x + b.def.footprint / 2;
      const cy = b.y + b.def.footprint / 2;
      const target = watchTarget(sim, cx, cy, Math.floor(cx / PATCH), Math.floor(cy / PATCH));
      if (target < 0) continue;
      const s = sim.beings.store;
      const tx = s.x[target] ?? 0;
      const ty = s.y[target] ?? 0;
      for (let v = 0; v < WATCH_BOLTS; v++) {
        if (!launchProjectile(sim, 'flint_dart', cx, cy, tx, ty, -1, WATCH_DAMAGE, [])) break;
      }
    }
  }
}

/** Runs one bomb profile for a device (devices.ts); the guard may refuse it, which returns false. */
function detonateDevice(sim: Sim, prof: BombProfile, x: number, y: number): boolean {
  return detonateBomb(sim, prof, x, y, false);
}

/**
 * Launch step (08 section 2.1, ranged basic attack): each Being with a ready attack timer and a
 * ranged weapon shoots a volley at the nearest prey within the weapon's reach; a thrower without a
 * weapon lobs instead (lobStep). Runs once per tick before the projectiles move. The device triggers
 * of 04 section 8.4 run first, since this is the per-tick step that always runs.
 */
export function shootStep(sim: Sim): void {
  const s = sim.beings.store;
  const ctx = sim.combatContext();
  devicesStep(sim, detonateDevice);
  brazierStep(sim);
  watchspireStep(sim);
  for (let k = 0; k < s.size; k++) {
    if (sim.projectiles.length >= MAX_PROJECTILES) return;
    const slot = s.at(k);
    if ((sim.combat.attackTimer[slot] ?? 0) > 0) continue;
    const weapon = rangedWeaponOf(sim, slot);
    if (!weapon) {
      lobStep(sim, ctx, slot);
      continue;
    }
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
  // A hidden charge is hit by any projectile that lands on it (18e section 5).
  deviceStruck(sim, y * sim.realm.side + x, detonateDevice);
}
