import { G, ground, groundId } from '../../content/grounds.ts';
import { biomeOfCover, BIOMES } from '../../content/biomes.ts';
import { FLAG } from '../realm.ts';
import { n4, n8 } from '../grid.ts';
import type { Sim } from '../sim.ts';

/** Probability a shoal's neighbour freezes with it (04 section 5). */
const FAST_FREEZE_SPREAD = 0.35;
/** Depth limit for the shoal freeze spread (04 section 5). */
const FAST_FREEZE_DEPTH = 8;
const THAW_SPREAD_SHOAL = 0.2;

/** Biome that makes its cover forever frozen (18c rimewaste). */
function foreverFrozen(sim: Sim, i: number): boolean {
  const idx = biomeOfCover(sim.realm.cover[i] ?? 0);
  return idx >= 0 && (BIOMES[idx]?.foreverFrozen ?? false);
}

/**
 * Freezes tile i (04 section 5). Shoals become rimeplate and spread frost to neighbours; deep
 * water and forever-frozen biomes do not freeze.
 */
export function freeze(sim: Sim, i: number, depth = 0): void {
  const realm = sim.realm;
  const kind = ground(realm.ground[i] ?? 0);
  if (!kind.canFreeze && !kind.fastFreeze) return;
  if (foreverFrozen(sim, i)) return;
  if (realm.hasFlag(i, FLAG.frozen)) return;
  realm.setFlag(i, FLAG.frozen, true);
  realm.hp[i] = 10;
  if (kind.frz) {
    realm.setGround(i, groundId(kind.frz));
  }
  if (kind.fastFreeze && depth < FAST_FREEZE_DEPTH) {
    const rng = sim.rng('freeze');
    for (let k = 0; k < 4; k++) {
      const j = n4(i, realm.side, k);
      if (j >= 0 && rng.next() < FAST_FREEZE_SPREAD) freeze(sim, j, depth + 1);
    }
  }
}

/** Thaws tile i by `dmg` hit points (04 section 5); dmg >= 99 always thaws. */
export function thaw(sim: Sim, i: number, dmg: number): void {
  const realm = sim.realm;
  if (!realm.hasFlag(i, FLAG.frozen)) return;
  if (foreverFrozen(sim, i) && dmg < 99) return;
  realm.hp[i] = (realm.hp[i] ?? 10) - dmg;
  if ((realm.hp[i] ?? 0) > 0 && dmg < 99) return;
  realm.setFlag(i, FLAG.frozen, false);
  realm.hp[i] = 10;
  const wasFast = ground(realm.ground[i] ?? 0).fastFreeze || realm.ground[i] === G.rimeplate;
  if (realm.ground[i] === G.rimeplate) realm.setGround(i, G.shoal);
  if (wasFast) {
    const rng = sim.rng('freeze');
    for (let k = 0; k < 4; k++) {
      const j = n4(i, realm.side, k);
      if (j >= 0 && realm.hasFlag(j, FLAG.frozen) && rng.next() < THAW_SPREAD_SHOAL) thaw(sim, j, 99);
    }
  }
}

/** Freeze sweep (04 section 5): a budgeted run over the Freeze runner in Ages that freeze the world. */
export function freezeSweep(sim: Sim, budget: number): void {
  const realm = sim.realm;
  const runner = sim.runner('freeze');
  for (let k = 0; k < budget; k++) {
    const i = runner.next();
    if (ground(realm.ground[i] ?? 0).canFreeze) freeze(sim, i);
  }
}

/** Thaw sweep (04 section 5): mountains thaw only where the Age allows it. */
export function thawSweep(sim: Sim, budget: number): void {
  const realm = sim.realm;
  const runner = sim.runner('thaw');
  const age = sim.ageDef();
  const rng = sim.rng('thaw');
  for (let k = 0; k < budget; k++) {
    const i = runner.next();
    if (!realm.hasFlag(i, FLAG.frozen) || foreverFrozen(sim, i)) continue;
    const g = realm.ground[i] ?? 0;
    const mountain = g === G.crag || g === G.pinnacle;
    if (mountain && !(age.thawMountains || g !== G.pinnacle)) continue;
    if (mountain) {
      if (rng.next() >= 0.1) continue;
      let open = false;
      for (let n = 0; n < 8; n++) {
        const j = n8(i, realm.side, n);
        if (j >= 0 && !realm.hasFlag(j, FLAG.frozen)) open = true;
      }
      if (!open) continue;
    }
    thaw(sim, i, 5 + age.tempDamageBonus);
  }
}

/** Summit freeze (04 section 5): each pinnacle tile freezes with 20% per run; skipped in Scorch. */
export function summitFreeze(sim: Sim): void {
  const realm = sim.realm;
  const rng = sim.rng('summit');
  if (sim.ageDef().id === 'scorch') return;
  for (let i = 0; i < realm.tileCount; i++) {
    if (realm.ground[i] === G.pinnacle && rng.next() < 0.2) freeze(sim, i);
  }
}
