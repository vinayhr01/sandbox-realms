/**
 * Terrain effects behind the Grow, Sky and landmark powers (12 section 8.3 and 8.4; 04 section 1.5
 * tool table). Each function applies one power at tile i (or at a point) through the terrain
 * modules and returns whether it changed or ran anything. Callers check the tile is in bounds.
 */
import { G, ground } from '../../content/grounds.ts';
import { BIOMES, biomeCoverId, biomeOfCover } from '../../content/biomes.ts';
import { FLORA, FLORA_BY_ID, floraCode } from '../flora.ts';
import { n4 } from '../grid.ts';
import { FLAG } from '../realm.ts';
import type { Sim } from '../sim.ts';
import { placeCreepHub } from '../terrain/creep.ts';
import { startFire, stopFire } from '../terrain/fire.ts';
import { freeze, thaw } from '../terrain/freeze.ts';
import { addHeat } from '../terrain/heat.ts';
import { startGeyser, startVolcano } from '../terrain/eruption.ts';
import { magmaQuench } from '../terrain/magma.ts';
import { rainDrop } from '../terrain/water.ts';

/** Tile i and its four orthogonal neighbours that lie on the realm (04 section 1.5: drops hit tile + n4). */
function footprint(sim: Sim, i: number): number[] {
  const out = [i];
  for (let k = 0; k < 4; k++) {
    const j = n4(i, sim.realm.side, k);
    if (j >= 0) out.push(j);
  }
  return out;
}

/** Biome seed (12 8.3, 04 1.5 Seed): tile and n4 neighbours take the biome cover where the Ground is compatible. */
export function seedBiome(sim: Sim, i: number, biome: string): boolean {
  const realm = sim.realm;
  const idx = BIOMES.findIndex((b) => b.id === biome);
  if (idx < 0) return false;
  let changed = false;
  for (const j of footprint(sim, i)) {
    const g = realm.ground[j] ?? 0;
    if (g !== G.lowloam && g !== G.highloam && g !== G.strand && g !== G.knoll) continue;
    if (realm.hasFlag(j, FLAG.burning) || (realm.scar[j] ?? 0) > 0) continue;
    const high = g === G.highloam || g === G.knoll;
    const cover = biomeCoverId(idx, high);
    if (realm.cover[j] === cover) continue;
    realm.setCover(j, cover);
    changed = true;
  }
  return changed;
}

/**
 * Plants one flora species on tile i (click). Beach flora needs strand; other flora needs a biome
 * cover whose biome lists it. The tile must be bare land with no flora and not burning.
 */
export function plantFlora(sim: Sim, i: number, floraId: string): boolean {
  const realm = sim.realm;
  const k = FLORA_BY_ID.get(floraId);
  const def = k === undefined ? undefined : FLORA[k];
  if (!def || def.kind === 'mineral') return false;
  const kind = ground(realm.ground[i] ?? 0);
  if (kind.layer !== 'land' || kind.damages !== 0) return false;
  if ((realm.flora[i] ?? 0) !== 0 || realm.hasFlag(i, FLAG.burning)) return false;
  if (def.beach) {
    if (realm.ground[i] !== G.strand) return false;
  } else {
    const biome = BIOMES[biomeOfCover(realm.cover[i] ?? 0)];
    if (!biome || !def.biomes.includes(biome.id)) return false;
  }
  realm.setFlora(i, floraCode(floraId), sim.tick);
  return true;
}

/** Rain drop on tile i and its neighbours (04 1.5 Rain, 12 8.4 fall_rain). */
export function rainOn(sim: Sim, i: number): boolean {
  for (const j of footprint(sim, i)) rainDrop(sim, j);
  return true;
}

/** Snow drop on tile i and its neighbours: freezes what can freeze (12 8.4 fall_snow). */
export function snowOn(sim: Sim, i: number): boolean {
  for (const j of footprint(sim, i)) freeze(sim, j);
  return true;
}

/** Ignite tool (04 1.5): forces a fire on tile i even on bare ground. */
export function igniteAt(sim: Sim, i: number): boolean {
  return startFire(sim, i, true);
}

/**
 * Quench tool (04 1.5 and 04 section 3): cools molten ground to knoll, puts out fire and thaws frost
 * on tile i. Magma is left alone under eternal_magma or sanctuary_seal. Returns whether anything changed.
 */
export function quenchAt(sim: Sim, i: number): boolean {
  const realm = sim.realm;
  let did = false;
  if (realm.molten.has(i) && !sim.rules.isOn('eternal_magma') && !sim.rules.isOn('sanctuary_seal')) {
    magmaQuench(sim, i);
    did = true;
  }
  if (realm.hasFlag(i, FLAG.burning)) {
    stopFire(sim, i);
    did = true;
  }
  if (realm.hasFlag(i, FLAG.frozen)) {
    thaw(sim, i, 99);
    did = true;
  }
  return did;
}

/** Heat brush (12 8.4 sky_warm / sky_chill): adds heat to tile i with its effects. */
export function heatAt(sim: Sim, i: number, amount: number): boolean {
  addHeat(sim, i, amount);
  return true;
}

/** Volcano landmark (12 8.3 lm_fire_vent, 04 7.2): `small` places the 3x3 vent. */
export function volcanoAt(sim: Sim, x: number, y: number, small: boolean): boolean {
  return startVolcano(sim, x, y, small);
}

/** Geyser landmark (12 8.3 lm_hotspring water, lm_acidspring acid; 04 7.2). */
export function geyserAt(sim: Sim, x: number, y: number, kind: 'water' | 'acid'): boolean {
  return startGeyser(sim, x, y, kind);
}

/** Creep hub (12 8.3 creep_*, 18e section 1): places the hub structure on tile i. */
export function creepHubAt(sim: Sim, i: number, hubId: string): boolean {
  return placeCreepHub(sim, i, hubId);
}
