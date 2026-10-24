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
  click('grow_seed_biome', 'grow', 'Seed Biome', 'seed_biome', {}),
  click('grow_flora_herb', 'grow', 'Herb', 'plant_flora', { flora: 'herb' }),
  click('grow_flora_fieldflower', 'grow', 'Fieldflower', 'plant_flora', { flora: 'fieldflower' }),
  click('grow_flora_broadleaf_a', 'grow', 'Broadleaf Tree', 'plant_flora', { flora: 'broadleaf_a' }),
  click('grow_flora_toadstool', 'grow', 'Toadstool', 'plant_flora', { flora: 'toadstool' }),
  // Sky tab: weather drops (section 8.4), drop ids from 02 section 6.
  click('sky_rain', 'sky', 'Rain', 'drop_rain', {}),
  click('sky_snow', 'sky', 'Snow', 'drop_freeze', {}),
  click('sky_ignite', 'sky', 'Ignite', 'start_fire', {}),
  click('sky_quench', 'sky', 'Quench', 'quench', {}),
  // Beings tab: one spawner per roster species (section 8.5, scheme spawn_<group>_<id>).
  ...SPECIES.filter((sp) => sp.wild).map((sp): PowerDef => ({
    id: `spawn_beast_${sp.id}`,
    tab: 'beings',
    kind: 'spawn',
    name: `Call ${sp.name}`,
    repeatMs: 180,
    handler: 'spawn_being',
    params: { species: sp.id },
    cooldownMs: 0,
    requires: [],
  })),
  // Havoc tab: bombs and calamity omens (sections 8.6, 10).
  click('havoc_bomb', 'havoc', 'Bomb', 'bomb', { radius: 3, damage: 30 }, 0),
  click('havoc_bolt', 'havoc', 'Bolt', 'bolt', { radius: 2, damage: 47 }, 3000),
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
  // Favour and Insight: placeholders for systems not built yet (hamlets, rites, lore).
  click('favour_bless', 'favour', 'Bless', 'bless', {}, 0, ['rituals']),
  click('insight_lore', 'insight', 'Lore', 'open_window', { window: 'lore' }),
];

export const POWER_BY_ID = new Map(POWERS.map((p) => [p.id, p]));

export function powersInTab(tab: TabId): PowerDef[] {
  return POWERS.filter((p) => p.tab === tab);
}
