/**
 * Powers catalogue (12-powers-catalogue.md sections 3 and 8). This table holds the powers that the
 * current sim can express. The spec lists about 300; the rest need systems that are not built yet
 * (hamlets, dominions, creeds) and are listed as such in DECISIONS.md. `handler` names the sim
 * function the input layer calls: terrain brushes map to existing terraform code, spawns map to
 * spawnBeing, omens map to a calamity id (see src/sim/calamity.ts).
 */
import { SPECIES } from './beasts.ts';

export const TABS = ['realm', 'shape', 'grow', 'sky', 'beings', 'havoc', 'favour', 'insight'] as const;
export type TabId = (typeof TABS)[number];
export type PowerKind = 'click' | 'brush' | 'drag' | 'spawn' | 'toggle' | 'stamp' | 'charge' | 'window';

export interface PowerDef {
  id: string;
  tab: TabId;
  kind: PowerKind;
  /** Name shown to the player (i18n keys follow in the UI milestone). */
  name: string;
  /** Milliseconds between repeats while held (brush 60, spawn 180); 0 = single use. */
  repeatMs: number;
  /** Sim function or content handler the input layer invokes. */
  handler: string;
  /** Extra parameters for the handler (species id, ground key, calamity id, radius). */
  params: Readonly<Record<string, string | number>>;
  /** Single-use cooldown in ms (08 section 6); 0 = none. */
  cooldownMs: number;
  /** Rules this power needs to be enabled (soft gate). */
  requires: readonly string[];
}

const brush = (id: string, name: string, handler: string, params: Record<string, string | number> = {}, requires: string[] = []): PowerDef => ({
  id,
  tab: 'shape',
  kind: 'brush',
  name,
  repeatMs: 60,
  handler,
  params,
  cooldownMs: 0,
  requires,
});

const click = (id: string, tab: TabId, name: string, handler: string, params: Record<string, string | number> = {}, cooldownMs = 0, requires: string[] = []): PowerDef => ({
  id,
  tab,
  kind: 'click',
  name,
  repeatMs: 0,
  handler,
  params,
  cooldownMs,
  requires,
});

/** Favour magic drop: brush kind, one drop roll per tapped tile (12 section 8.7). */
const drop = (id: string, name: string, handler: string, params: Record<string, string | number>): PowerDef => ({
  id,
  tab: 'favour',
  kind: 'brush',
  name,
  repeatMs: 60,
  handler,
  params,
  cooldownMs: 0,
  requires: [],
});

const toggle = (id: string, name: string, rule: string): PowerDef => ({
  id,
  tab: 'realm',
  kind: 'toggle',
  name,
  repeatMs: 0,
  handler: 'toggle_rule',
  params: { rule },
  cooldownMs: 0,
  requires: [],
});

const CALAMITY_OMENS = [
  'whirlwind',
  'heat_spell',
  'skyfall',
  'tremor',
  'magmaling_uprising',
  'wailwisp_wake',
  'waddlefin_surge',
  'gourd_harvest',
  'stormwyrm_descent',
  'ember_raiders',
  'skiff_visitors',
  'goo_spread',
  'gloom_bloom',
  'rogue_sorcerer',
  'crypt_stirring',
  'mind_fog',
] as const;

/**
 * Bomb profiles (12 section 8.6). Numbers are those of 04 section 8.1 where the profile is named
 * there (blast, spark, sunburst, worldbreaker, shard) and those of 12 section 8.6 otherwise. A blast
 * deals its damage once to each Being in the radius (no falloff) and dazes them when `force`.
 * `fire`: 'random' leaves the ignition roll to the terrain blast, 'all' sets every tile alight.
 * `wasteland` strips cover; `voidCore` lowers Ground to deepmere inside that radius; `tidal` fills
 * land with shoal; `shrapnel` detonates that many `shrapnel` bombs on random tiles in the radius.
 * Terrain sinks by damage/10 falling off with distance for radius 2 and up (as 04 explodeTile).
 */
export interface BombProfile {
  id: string;
  radius: number;
  damage: number;
  type: 'Explosion' | 'Other' | 'Fire';
  force: boolean;
  fire: 'none' | 'random' | 'all';
  wasteland: boolean;
  voidCore: number;
  tidal: boolean;
  shrapnel: number;
}

const bomb = (id: string, radius: number, damage: number, extra: Partial<BombProfile> = {}): BombProfile => ({
  id,
  radius,
  damage,
  type: 'Explosion',
  force: false,
  fire: 'none',
  wasteland: false,
  voidCore: 0,
  tidal: false,
  shrapnel: 0,
  ...extra,
});

export const BOMB_PROFILES: readonly BombProfile[] = [
  bomb('blast', 10, 100, { force: true, fire: 'random' }),
  bomb('spark', 5, 50, { force: true, fire: 'random' }),
  bomb('pitchfire', 8, 40, { type: 'Fire', fire: 'all' }),
  bomb('sunburst', 30, 10000, { wasteland: true }),
  bomb('voidburst', 30, 500, { voidCore: 6 }),
  bomb('worldbreaker', 70, 10000),
  bomb('urchin', 6, 30, { shrapnel: 12 }),
  bomb('tidal', 12, 0, { type: 'Other', tidal: true }),
  bomb('shrapnel', 3, 30),
  bomb('bolt_medium', 2, 47, { type: 'Other', fire: 'all' }),
];

export const BOMB_PROFILE_BY_ID: ReadonlyMap<string, BombProfile> = new Map(BOMB_PROFILES.map((b) => [b.id, b]));

export const POWERS: readonly PowerDef[] = [
  // Realm tab: windows and toggles from section 8.1.
  click('realm_pause', 'realm', 'Pause', 'set_pause', {}, 0),
  click('realm_speed', 'realm', 'Speed', 'cycle_speed', { speeds: '0.5,1,2,5,10' }),
  click('realm_rules', 'realm', 'Realm Rules', 'open_window', { window: 'rules' }),
  click('realm_ages', 'realm', 'Ages', 'open_window', { window: 'ages' }),
  click('realm_chronicle', 'realm', 'Chronicle', 'open_window', { window: 'chronicle' }),
  click('realm_hide_ui', 'realm', 'Hide Interface', 'toggle_hud', {}),
  toggle('rule_sky_clouds', 'Sky clouds', 'sky_clouds'),
  toggle('rule_natural_calamities', 'Natural calamities', 'natural_calamities'),
  toggle('rule_monstrous_calamities', 'Monstrous calamities', 'monstrous_calamities'),
  toggle('rule_beast_spawning', 'Beast spawning', 'beast_spawning'),
  toggle('rule_wild_seeding', 'Wild seeding', 'wild_seeding'),
  toggle('rule_hunger', 'Hunger', 'hunger'),
  toggle('rule_aging_toll', 'Ageing', 'aging_toll'),
  toggle('rule_sanctuary_seal', 'Sanctuary seal', 'sanctuary_seal'),
  // Shape tab: terrain brushes (section 8.2, ground paint and raise/lower).
  brush('shape_raise', 'Raise', 'terraform_raise'),
  brush('shape_lower', 'Lower', 'terraform_lower'),
  brush('shape_deepmere', 'Deepmere', 'paint_ground', { ground: 'deepmere' }),
  brush('shape_midmere', 'Midmere', 'paint_ground', { ground: 'midmere' }),
  brush('shape_shoal', 'Shoal', 'paint_ground', { ground: 'shoal' }),
  brush('shape_strand', 'Strand', 'paint_ground', { ground: 'strand' }),
  brush('shape_lowloam', 'Lowloam', 'paint_ground', { ground: 'lowloam' }),
  brush('shape_highloam', 'Highloam', 'paint_ground', { ground: 'highloam' }),
  brush('shape_knoll', 'Knoll', 'paint_ground', { ground: 'knoll' }),
  brush('shape_crag', 'Crag', 'paint_ground', { ground: 'crag' }),
  brush('shape_pinnacle', 'Pinnacle', 'paint_ground', { ground: 'pinnacle' }),
  brush('shape_wayworn', 'Wayworn Path', 'paint_ground', { ground: 'wayworn' }),
  brush('shape_tilled', 'Tilled Row', 'paint_ground', { ground: 'tilled' }),
  // Grow tab: flora and biome seeding (section 8.3).
  // Seeds: one biome per power; the UI has no biome picker yet, so this one seeds Verdant Reach.
  click('grow_seed_biome', 'grow', 'Seed Biome', 'seed_biome', { biome: 'verdant_reach' }),
  click('grow_flora_herb', 'grow', 'Herb', 'plant_flora', { flora: 'herb' }),
  click('grow_flora_fieldflower', 'grow', 'Fieldflower', 'plant_flora', { flora: 'fieldflower' }),
  click('grow_flora_broadleaf_a', 'grow', 'Broadleaf Tree', 'plant_flora', { flora: 'broadleaf_a' }),
  click('grow_flora_toadstool', 'grow', 'Toadstool', 'plant_flora', { flora: 'toadstool' }),
  // Landmarks (12 section 8.3): volcano and geyser vents, creep hubs (18e section 1).
  click('lm_fire_vent', 'grow', 'Fire Vent', 'start_volcano', { small: 1 }),
  click('lm_hotspring', 'grow', 'Hot Spring', 'start_geyser', { kind: 'water' }),
  click('lm_acidspring', 'grow', 'Acid Spring', 'start_geyser', { kind: 'acid' }),
  click('creep_gloomgrowth', 'grow', 'Gloomgrowth', 'place_creep_hub', { hub: 'gloom_heart' }),
  click('creep_bloatmoss', 'grow', 'Bloatmoss', 'place_creep_hub', { hub: 'bloat_heart' }),
  click('creep_gourdgrowth', 'grow', 'Gourdgrowth', 'place_creep_hub', { hub: 'gourd_heart' }),
  // Sky tab: weather drops (section 8.4), drop ids from 02 section 6.
  click('sky_rain', 'sky', 'Rain', 'drop_rain', {}),
  click('sky_snow', 'sky', 'Snow', 'drop_freeze', {}),
  click('sky_ignite', 'sky', 'Ignite', 'start_fire', {}),
  click('sky_quench', 'sky', 'Quench', 'quench', {}),
  // Temperature brushes (12 section 8.4): heat +/-15 per application.
  { ...brush('sky_warm', 'Warm', 'add_heat', { amount: 15 }), tab: 'sky' },
  { ...brush('sky_chill', 'Chill', 'add_heat', { amount: -15 }), tab: 'sky' },
  // Beings tab: one spawner per roster species (section 8.5, scheme spawn_<group>_<id>).
  ...SPECIES.map((sp): PowerDef => ({
    id: sp.wild ? `spawn_beast_${sp.id}` : `spawn_folk_${sp.id}`,
    tab: 'beings',
    kind: 'spawn',
    name: sp.wild ? `Call ${sp.name}` : `Found ${sp.name}`,
    repeatMs: 180,
    handler: 'spawn_being',
    params: { species: sp.id },
    cooldownMs: 0,
    requires: [],
  })),
  // Havoc tab: bombs and calamity omens (sections 8.6, 10).
  // Bombs (12 section 8.6). The spec id of the first is havoc_charge; it keeps the id havoc_bomb. Device
  // grounds (powder, timed, hidden, sparkler) are cut, see DECISIONS.md "Combat release".
  click('havoc_bomb', 'havoc', 'Charge', 'bomb', { profile: 'blast' }, 0),
  click('havoc_handcharge', 'havoc', 'Hand charge', 'bomb', { profile: 'spark' }, 0),
  click('havoc_pitchfire', 'havoc', 'Pitch fire', 'bomb', { profile: 'pitchfire' }, 0),
  click('havoc_sunburst', 'havoc', 'Sunburst', 'bomb', { profile: 'sunburst' }, 2000),
  click('havoc_voidburst', 'havoc', 'Voidburst', 'bomb', { profile: 'voidburst' }, 3000),
  click('havoc_worldbreaker', 'havoc', 'Worldbreaker', 'bomb', { profile: 'worldbreaker' }, 4000),
  click('havoc_urchin', 'havoc', 'Urchin', 'bomb', { profile: 'urchin' }, 0),
  click('havoc_tidal', 'havoc', 'Tidal burst', 'bomb', { profile: 'tidal' }, 0),
  click('havoc_bolt', 'havoc', 'Bolt', 'bolt', { profile: 'bolt_medium' }, 3000),
  ...CALAMITY_OMENS.map((id): PowerDef => ({
    id: `omen_${id}`,
    tab: 'havoc',
    kind: 'click',
    name: `Omen: ${id.replace(/_/g, ' ')}`,
    repeatMs: 0,
    handler: 'calamity',
    params: { calamity: id },
    cooldownMs: 1500,
    requires: [],
  })),
  // Favour (12 section 8.7). Magic drops are brush-kind: each tapped tile is one drop roll (fall 0.3) and
  // the beings on that tile take the effect. Substitutions are listed in DECISIONS.md "Powers round 4".
  // Bless (not in spec; effect in DECISIONS.md "Powers round 3").
  click('favour_bless', 'favour', 'Bless', 'bless', { radius: 3, status: 'warded' }, 0, ['rituals']),
  drop('fav_vigor', 'Vigour', 'favour_status', { status: 'emboldened', fall: 0.3 }),
  drop('fav_ward', 'Ward', 'favour_status', { status: 'warded', fall: 0.3 }),
  drop('fav_spark', 'Spark', 'favour_status', { status: 'emboldened', fall: 0.3 }),
  drop('fav_surge', 'Surge', 'favour_surge', { fall: 0.3 }),
  drop('fav_muse', 'Muse', 'favour_mood', { event: 'inspired', extra: -5, fall: 0.3 }),
  drop('fav_kinship', 'Kinship', 'favour_mood', { event: 'made_friend', extra: -10, fall: 0.3 }),
  drop('fav_strife', 'Strife', 'favour_mood', { event: 'talked_badly', extra: -15, fall: 0.3 }),
  drop('fav_grudge', 'Grudge', 'favour_status', { status: 'frenzy', fall: 0.3 }),
  drop('fav_frenzy', 'Frenzy', 'favour_trait', { trait: 'frenzied_mind', fall: 0.3 }),
  drop('fav_grace', 'Grace', 'favour_trait_random', { polarity: 'good', chance: 0.15 }),
  drop('fav_hex', 'Hex', 'favour_trait_random', { polarity: 'bad', chance: 0.15 }),
  drop('fav_slumber', 'Slumber', 'favour_sleep', { fall: 0.3 }),
  drop('fav_unweave', 'Unweave', 'favour_unweave', { fall: 0.3 }),
  drop('fav_cleanse', 'Cleanse', 'favour_cleanse', { fall: 0.3 }),
  drop('fav_purify', 'Purify', 'favour_purify', { fall: 1 }),
  click('fav_foundling', 'favour', 'Foundling', 'favour_foundling'),
  click('fav_wake', 'favour', 'Waking Flora', 'favour_wake'),
  drop('fav_rain_items', 'Item Rain', 'favour_items', { fall: 0.3 }),
  click('fav_rain_items_edit', 'favour', 'Edit Item Rain', 'open_window', { window: 'item_rain_edit' }),
  drop('fav_loot', 'Loot Rain', 'favour_loot', { fall: 0.3 }),
  // Insight (12 section 8.8). Lore (not in spec; effect in DECISIONS.md "Powers round 3").
  click('insight_lore', 'insight', 'Lore', 'lore', { radius: 4 }),
  click('ins_compare', 'insight', 'Compare Chart', 'open_window', { window: 'compare' }),
];

export const POWER_BY_ID = new Map(POWERS.map((p) => [p.id, p]));

export function powersInTab(tab: TabId): PowerDef[] {
  return POWERS.filter((p) => p.tab === tab);
}
