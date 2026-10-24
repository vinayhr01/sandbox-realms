import { AGES } from './ages.ts';

/**
 * Realm Rules (02 section 9). Booleans stored with the Realm. Default values and effects follow
 * the table; consumers read `rules.isOn(id)`. `onChange` hooks run when a rule flips.
 */
export interface RuleDef {
  id: string;
  group: string;
  defaultOn: boolean;
  canDisable: boolean;
  effect: string;
}

const R = (id: string, group: string, defaultOn: boolean, effect: string, canDisable = true): RuleDef => ({
  id,
  group,
  defaultOn,
  canDisable,
  effect,
});

export const RULES: readonly RuleDef[] = [
  R('pop_cap_100', 'Harmony', false, 'Settlements cannot exceed 100 population'),
  R('sanctuary_seal', 'Harmony', false, 'Terrain immune: no tile damage, fire spread, lava or heat effects'),
  R('parley', 'Diplomacy', true, 'off: all campaigns stop, no attacks between realms'),
  R('rituals', 'Diplomacy', true, 'off: no new Intrigue or ritual starts'),
  R('uprisings', 'Diplomacy', true, 'off: rebellions and coups disabled'),
  R('border_creep', 'Diplomacy', true, 'off: settlements cannot take enemy parcels'),
  R('terrain_building', 'Civilizations', true, 'off: biome-spreading structures stop'),
  R('realm_expansion', 'Civilizations', true, 'off: dominions do not found new settlements'),
  R('hostile_commoners', 'Civilizations', false, 'on: ordinary folk attack enemy buildings'),
  R('folk_births', 'Civilizations', true, 'off: folk do not reproduce'),
  R('beast_births', 'Mobs', true, 'off: beasts do not reproduce'),
  R('wandering_settlers', 'Civilizations', true, 'off: settler waves do nothing'),
  R('standing_armies', 'Civilizations', true, 'off: no armies are raised'),
  R('hunger', 'Units', true, 'off: nutrition does not decay'),
  R('aging_toll', 'Units', true, 'off: natural death by age disabled'),
  R('gene_chaos', 'Units', false, 'on: lineage mutation rates maximised'),
  R('mutation_box', 'Units', false, 'on: random mutation forms appear in births'),
  R('gentle_monsters', 'Mobs', false, 'on: monsters do not attack'),
  R('eternal_creep', 'Mobs', false, 'on: creep decay disabled'),
  R('beast_spawning', 'Spawn', true, 'off: no wild beast or vermin spawns, no life seeds'),
  R('seeds_of_thought', 'Spawn', false, 'on: life seeds may spawn civilised lineages'),
  R('sky_clouds', 'Spawn', true, 'off: no non-calamity clouds'),
  R('wild_seeding', 'Nature', true, 'off: no random flora seeding'),
  R('roots_beyond_borders', 'Nature', false, 'on: flora ignores settlement borders'),
  R('mineral_growth', 'Nature', true, 'off: mineral seeding does nothing'),
  R('shore_erosion', 'Nature', true, 'off: shore erosion does nothing'),
  R('dense_flora', 'Nature', false, 'on: per-parcel flora limit x1.5'),
  R('tree_spread', 'Trees', true, 'off: trees do not seed neighbours'),
  R('plant_spread', 'Plants', true, 'off: plants do not spread'),
  R('fungus_spread', 'Fungi', true, 'off: fungi do not spread'),
  R('fast_trees', 'Trees', false, 'on: tree spread interval 10 ss'),
  R('fast_plants', 'Plants', false, 'on: plant spread interval 10 ss'),
  R('fast_fungi', 'Fungi', false, 'on: fungus spread interval 10 ss'),
  R('popping_fungi', 'Fungi', false, 'on: stepping on fungus blasts radius 5'),
  R('tangle_roots', 'Trees', true, 'on: beings on trees move at x0.8'),
  R('vengeful_bark', 'Trees', false, 'on: felled trees may attack'),
  R('whimsical_flora', 'Plants', false, 'on: flowers and roots prank passers'),
  R('ground_greening', 'Biomes', true, 'off: no biome spread'),
  R('biome_takeover', 'Biomes', true, 'off: only bare soil can be converted'),
  R('eternal_magma', 'Weather', false, 'on: magma never cools or flows'),
  R('eternal_cold', 'Weather', false, 'on: thaw sweep disabled'),
  R('natural_calamities', 'Calamities', true, 'off: nature calamities and calamity clouds disabled'),
  R('monstrous_calamities', 'Calamities', true, 'off: beings calamities disabled'),
  R('vermin_plague', 'Calamities', false, 'on: vermin spawn caps x3'),
  R('evolution_events', 'Other', true, 'off: obelisk evolution events disabled'),
  R('forbidden_lore', 'Other', false, 'cannot be disabled once on', false),
  R('uplift_beasts', 'Units', false, 'on: beasts may evolve into folk lineages'),
  R('chaotic_minds', 'Other', false, 'on: new customs roll 3-5 traits'),
  R('open_knowledge', 'Other', false, 'on: all achievement-gated assets available'),
];

export const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

/**
 * The `rituals` rule (02 section 9): off means no new Intrigue or ritual starts. Intrigue starts are
 * gated in src/sim/culture/culture.ts; ritual powers (favour_bless) list it in `requires`, and
 * executePower refuses them while it is off (src/sim/powers/handlers.ts).
 */
export const RITUALS_RULE = 'rituals';

/** Per-age enable flags are stored as `age_enabled_<id>`, default on (02 section 9). */
export function ageRuleId(ageId: string): string {
  return `age_enabled_${ageId}`;
}

export class RuleSet {
  private readonly values = new Map<string, boolean>();
  private readonly listeners: ((id: string, on: boolean) => void)[] = [];

  constructor() {
    for (const r of RULES) this.values.set(r.id, r.defaultOn);
    for (const a of AGES) this.values.set(ageRuleId(a.id), true);
  }

  isOn(id: string): boolean {
    return this.values.get(id) ?? false;
  }

  /** Sets a rule; forbidden_lore cannot be switched off once on. Returns false when refused. */
  set(id: string, on: boolean): boolean {
    const def = RULE_BY_ID.get(id);
    if (def && !def.canDisable && this.isOn(id) && !on) return false;
    if (this.values.get(id) === on) return true;
    this.values.set(id, on);
    for (const l of this.listeners) l(id, on);
    return true;
  }

  onChange(listener: (id: string, on: boolean) => void): void {
    this.listeners.push(listener);
  }

  snapshot(): Record<string, boolean> {
    return Object.fromEntries(this.values);
  }
}
