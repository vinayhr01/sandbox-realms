/**
 * Wear and breakage (08 section 7.4). A melee Weapon hit that lands on a defender with gear wears
 * the defender's items by the attacker's weapon rigidity, and wears the attacker's weapon by the
 * rigidity of the items that were hit. An item at durability 0 stays worn and counts half stats
 * (store.ts). Ranged wear is not built: projectiles carry no shooter (combat.ts), so the shooter's
 * weapon cannot be read at impact.
 */
import { ITEM_KIND_BY_ID } from '../../content/items.ts';
import { refreshStats } from '../beings/system.ts';
import type { Sim } from '../sim.ts';
import { GEAR_SLOTS } from './store.ts';

/** Wear unit of 08 section 7.4 (`* 4`). The spec fixes it. */
export const WEAR_UNIT = 4;

/** Wear one defender item takes from one hit: floor(weapon rigidity / item rigidity) * WEAR_UNIT (integer division first). */
export function wearFor(weaponRigidity: number, itemRigidity: number): number {
  if (itemRigidity <= 0) return 0;
  return Math.floor(weaponRigidity / itemRigidity) * WEAR_UNIT;
}

/** Durability lost by the attacker's weapon: floor(floor(num / 5) / weapon rigidity) * WEAR_UNIT (08 section 7.4). */
export function weaponWearFor(num: number, weaponRigidity: number): number {
  if (weaponRigidity <= 0) return 0;
  return Math.floor(Math.floor(num / 5) / weaponRigidity) * WEAR_UNIT;
}

/**
 * Wear from one melee Weapon hit. `attacker` and `victim` are being slots. Unarmed attackers do not
 * wear (no weapon rigidity is defined for bare attacks, a spec gap). A warded victim takes no wear.
 */
export function wearOnHit(sim: Sim, attacker: number, victim: number): void {
  const store = sim.items;
  const weapon = store.get(store.gearAt(attacker, 0));
  const weaponKind = weapon ? ITEM_KIND_BY_ID.get(weapon.kind) : undefined;
  if (!weapon || !weaponKind) return;
  if (sim.effects.has(victim, 'warded')) return;
  const rng = sim.rng('items');
  let num = 0;
  let victimChanged = false;
  for (let index = 0; index < GEAR_SLOTS; index++) {
    const inst = store.get(store.gearAt(victim, index));
    if (!inst) continue;
    if (rng.int(2) === 0) continue; // 50% of defender items are skipped
    const kind = ITEM_KIND_BY_ID.get(inst.kind);
    if (!kind) continue;
    num += kind.rigidity;
    const wear = wearFor(weaponKind.rigidity, kind.rigidity);
    if (wear > 0 && !inst.mods.includes('everlasting')) {
      inst.durability = Math.max(0, inst.durability - wear);
      victimChanged = true;
    }
  }
  // The attacker's weapon wears on the half of hits that are not skipped (08 section 7.4).
  const weaponLoss = rng.int(2) === 1 ? weaponWearFor(num, weaponKind.rigidity) : 0;
  if (weaponLoss > 0 && !weapon.mods.includes('everlasting')) {
    weapon.durability = Math.max(0, weapon.durability - weaponLoss);
    refreshStats(sim, attacker);
  }
  if (victimChanged) refreshStats(sim, victim);
}
