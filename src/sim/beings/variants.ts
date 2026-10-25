/**
 * Procedural variants of a Being (18a section 3, round 8): the biome morph, the caste, the rare colour, and the colour
 * palette of 05 section 8. The rolls draw from the named stream `variant`, so they never disturb the `beings` stream.
 * Variants are stored per Being (store.morph, caste, palette, shade) and feed the assembly through `variantFxOf`.
 */
import type { SpeciesDef } from '../../content/beasts.ts';
import { BEING_TRAIT_INDEX } from '../../content/traits.ts';
import { CASTES, MORPHS, PALETTE_ALBINO, PALETTE_MELANIC, PALETTES, type VariantFx } from '../../content/variants.ts';
import type { Sim } from '../sim.ts';
import { ROUND8 } from './tuning.ts';

/**
 * Morph indices (0-based) a species may take (18a 3.1 and 3.5). A morph applies when the species' biome list
 * overlaps the morph's biomes. Monsters (group G), undead (F), hands (H), folk, and diet `none` are not eligible.
 */
export function morphsFor(def: SpeciesDef): number[] {
  if (!def.wild || def.folk || def.diet === 'none') return [];
  if (def.group === 'F' || def.group === 'G' || def.group === 'H') return [];
  const out: number[] = [];
  MORPHS.forEach((m, k) => {
    if (m.biomes.some((b) => def.biomes.includes(b))) out.push(k);
  });
  return out;
}

/**
 * Palette list a species' strains may take (05 section 8): natural, plus the palette of each eligible morph. The spec
 * keys this by biome; the sim has one list per species (DECISIONS.md "Beings release").
 */
export function palettesFor(def: SpeciesDef): number[] {
  const list = [0];
  for (const k of morphsFor(def)) {
    const p = PALETTES.indexOf(MORPHS[k]?.palette ?? '');
    if (p > 0 && !list.includes(p)) list.push(p);
  }
  return list;
}

/** Combined multipliers of a morph (index plus one; 0 for none) and a caste (index plus one; 0 for none). */
export function variantFxOf(morph: number, caste: number): VariantFx {
  const m = morph > 0 ? MORPHS[morph - 1] : undefined;
  const c = caste > 0 ? CASTES[caste - 1] : undefined;
  return {
    hp: (m?.hp ?? 1) * (c?.hp ?? 1),
    dmg: (m?.dmg ?? 1) * (c?.dmg ?? 1),
    spd: (m?.spd ?? 1) * (c?.spd ?? 1),
    life: (m?.life ?? 1) * (c?.life ?? 1),
    arm: m?.arm ?? 0,
    litter: c?.litter ?? 1,
  };
}

/**
 * Rolls the variants of a wild adult spawn (18a 3.5 rule 1): the morph (70% when eligible), then the castes in table
 * order (each one roll), then the rare albino and melanic colours (1/500 each, with the `lucky_hide` mark).
 */
export function rollWildVariant(sim: Sim, slot: number, def: SpeciesDef): void {
  const s = sim.beings.store;
  const rng = sim.rng('variant');
  const eligible = morphsFor(def);
  if (eligible.length > 0 && rng.next() < ROUND8.morphChance) {
    s.morph[slot] = (eligible[rng.int(eligible.length)] ?? 0) + 1;
  }
  for (let c = 0; c < CASTES.length; c++) {
    const caste = CASTES[c];
    if (!caste || caste.scope === 'aged') continue;
    if (caste.scope === 'small_insect' && !(def.group === 'E' && (def.size === 'T' || def.size === 'S'))) continue;
    if (rng.next() < caste.chance) {
      s.caste[slot] = c + 1;
      break;
    }
  }
  const r = rng.next();
  const rare = r < ROUND8.albinoChance ? PALETTE_ALBINO : r < ROUND8.albinoChance + ROUND8.melanicChance ? PALETTE_MELANIC : -1;
  if (rare >= 0) {
    s.palette[slot] = rare;
    const k = BEING_TRAIT_INDEX.get('lucky_hide');
    if (k !== undefined) s.setMark(slot, k, true);
  }
}

/**
 * Rolls the caste of an aged adult (18a 3.3: venerable, 3%, once a Year after 70% of the span). Returns true when the
 * Being became venerable.
 */
export function rollVenerable(sim: Sim, slot: number): boolean {
  const s = sim.beings.store;
  const idx = CASTES.findIndex((c) => c.scope === 'aged');
  if (idx < 0 || (s.caste[slot] ?? 0) !== 0) return false;
  if (sim.rng('variant').next() >= ROUND8.venerableChance) return false;
  s.caste[slot] = idx + 1;
  return true;
}

/**
 * Sets a new Being's colour (05 section 8, 06 section 6.6). A morph Being takes its morph's palette (18a 3.2). A rare
 * colour set by rollWildVariant is kept. Otherwise a child takes a parent's palette half the time, else a uniform
 * index from the strain's allowed list. The shade is uniform 0..3 for every Being.
 */
export function assignPalette(sim: Sim, slot: number, bearer: number, allowed: readonly number[]): void {
  const s = sim.beings.store;
  const rng = sim.rng('variant');
  s.shade[slot] = rng.int(4);
  const current = s.palette[slot] ?? 0;
  if (current === PALETTE_ALBINO || current === PALETTE_MELANIC) return;
  const morph = s.morph[slot] ?? 0;
  if (morph > 0) {
    s.palette[slot] = Math.max(0, PALETTES.indexOf(MORPHS[morph - 1]?.palette ?? ''));
    return;
  }
  if (bearer >= 0 && rng.next() < 0.5) {
    s.palette[slot] = s.palette[bearer] ?? 0;
    return;
  }
  s.palette[slot] = allowed[rng.int(allowed.length)] ?? 0;
}
