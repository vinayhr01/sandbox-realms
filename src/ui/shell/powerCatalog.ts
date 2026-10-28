/**
 * The power sheet's catalogue (UX redesign, spec B and calls 2): which chip each power sits under, the sub-groups
 * inside a chip, the recent row and search. Pure data, no DOM. Every power in POWERS has a chip, or a home outside
 * the sheet (the speed pill or an Atlas tab, see homeOf).
 */
import { POWERS, POWER_BY_ID, type PowerDef } from '../../content/powers.ts';
import { chunkOf, type ArtChunk } from '../../art/load.ts';
import type { UiStore } from './store.ts';

/** Chips in the sheet. 'windows' is temporary: it lists the old window launchers until the Atlas takes them (Task 3). */
export type ChipId = 'land' | 'nature' | 'creatures' | 'weather' | 'disasters' | 'blessings' | 'peoples' | 'inspect' | 'windows';

/** The chips the sheet shows (the temporary 'windows' chip is handled separately). */
export const CHIP_IDS: readonly Exclude<ChipId, 'windows'>[] = ['land', 'nature', 'creatures', 'weather', 'disasters', 'blessings', 'peoples', 'inspect'];

export const CHIP_LABELS: Readonly<Record<ChipId, string>> = {
  land: 'Land',
  nature: 'Nature',
  creatures: 'Creatures',
  weather: 'Weather',
  disasters: 'Disasters',
  blessings: 'Blessings',
  peoples: 'Peoples',
  inspect: 'Inspect',
  windows: 'Windows',
};

export interface PowerGroup {
  id: string;
  label: string;
  powers: PowerDef[];
}

const INSIGHT_PEOPLES = new Set([
  'ins_select_hamlet',
  'ins_ties',
  'ins_accord',
  'ins_list_dominions',
  'ins_list_hamlets',
  'ins_list_pacts',
  'ins_list_armies',
  'ins_list_creeds',
  'ins_list_customs',
  'ins_list_dialects',
  'ins_list_clans',
  'ins_list_families',
  'ins_list_strains',
  'ins_list_campaigns',
  'ins_list_intrigues',
]);

/** The chip of a power, or null when its home is the speed pill or the Atlas (see homeOf). */
export function chipOf(power: PowerDef): ChipId | null {
  if (power.tab === 'realm') return null;
  if (power.id === 'ins_inspect' || power.tab === 'shape') return 'land';
  switch (power.tab) {
    case 'grow':
      return 'nature';
    case 'beings':
      return 'creatures';
    case 'sky':
      return 'weather';
    case 'havoc':
      return 'disasters';
    case 'favour':
      return power.id === 'fav_foundling' ? 'peoples' : 'blessings';
    case 'insight':
      return INSIGHT_PEOPLES.has(power.id) || power.id.startsWith('ins_layer_') ? 'peoples' : 'inspect';
    default:
      return null;
  }
}

const REALM_HOME: Readonly<Record<string, string>> = {
  realm_pause: 'Speed pill',
  realm_speed: 'Speed pill',
  realm_hide_ui: 'Atlas: World (Hide Interface, key H)',
  realm_rules: 'Atlas: World',
  realm_ages: 'Atlas: World',
  realm_chronicle: 'Atlas: History',
};

/** Where a power without a chip lives instead, or null when it has a chip. Rule toggles live in the Atlas World tab. */
export function homeOf(power: PowerDef): string | null {
  if (chipOf(power) !== null) return null;
  return REALM_HOME[power.id] ?? 'Atlas: World';
}

/** The category a power is searched under: its chip label, or World for the Atlas powers. */
function categoryOf(power: PowerDef): string {
  const chip = chipOf(power);
  return chip === null ? 'World' : CHIP_LABELS[chip];
}

/** Sub-groups of a non-creature chip. Each rule takes the powers its test accepts; the last rule takes the rest. */
const GROUP_RULES: Readonly<Record<Exclude<ChipId, 'windows' | 'creatures'>, ReadonlyArray<readonly [string, (p: PowerDef) => boolean]>>> = {
  land: [
    ['Tools', (p) => p.id === 'ins_inspect' || p.id === 'shape_raise' || p.id === 'shape_lower'],
    ['Ground', () => true],
  ],
  nature: [
    ['Flora', (p) => p.id.startsWith('grow_')],
    ['Landmarks', (p) => p.id.startsWith('lm_') || p.id.startsWith('beacon_')],
    ['Creep hubs', () => true],
  ],
  weather: [
    ['Weather', (p) => p.kind === 'click'],
    ['Temperature', () => true],
  ],
  disasters: [
    ['Bombs', (p) => p.handler === 'bomb' || p.handler === 'bolt'],
    ['Omens', (p) => p.id.startsWith('omen_')],
    ['Curses', () => true],
  ],
  blessings: [
    ['Rites', (p) => p.kind === 'click'],
    ['Drops', () => true],
  ],
  peoples: [
    ['Select', (p) => p.handler === 'select_hamlet' || p.handler === 'select_dominion' || p.handler === 'select_accord'],
    ['Lists', (p) => p.id.startsWith('ins_list_')],
    ['Layers', (p) => p.id.startsWith('ins_layer_')],
    ['Foundling', () => true],
  ],
  inspect: [
    ['Follow and possess', (p) => p.id === 'ins_follow' || p.id === 'ins_possess' || p.id === 'insight_lore'],
    ['Records', (p) => p.id === 'ins_knowledge' || p.id === 'ins_compare' || p.id === 'ins_list_fav_beings' || p.id === 'ins_list_fav_items'],
    ['Marks', (p) => p.id.startsWith('ins_mark_')],
    ['Arrows and tips', (p) => p.id.startsWith('ins_arrow_') || p.id.startsWith('ins_tips_')],
    ['Overlays', () => true],
  ],
};

/** Creature groups in sheet order, by art chunk (spec B: Animals, Birds, Sea, Insects, Undead, Monsters, Peoples). */
const CHUNK_GROUPS: ReadonlyArray<readonly [ArtChunk, string]> = [
  ['beast', 'Animals'],
  ['bird', 'Birds'],
  ['sea', 'Sea'],
  ['insect', 'Insects'],
  ['undead', 'Undead'],
  ['monster', 'Monsters'],
  ['folk', 'Peoples'],
  ['divine', 'Divine'],
];

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z]+/g, '-');
}

/** The sub-groups of a chip, in sheet order. Every power of the chip is in exactly one group; empty groups are left out. */
export function groupsOf(chip: ChipId): PowerGroup[] {
  if (chip === 'windows') return [];
  const inChip = POWERS.filter((p) => chipOf(p) === chip);
  if (chip === 'creatures') {
    return CHUNK_GROUPS.map(([id, label]) => ({
      id: slug(label),
      label,
      powers: inChip.filter((p) => chunkOf(String(p.params['species'] ?? '')) === id),
    })).filter((g) => g.powers.length > 0);
  }
  const rules = GROUP_RULES[chip];
  const groups = rules.map(([label]) => ({ id: slug(label), label, powers: [] as PowerDef[] }));
  for (const power of inChip) {
    const index = rules.findIndex(([, test]) => test(power));
    groups[index]?.powers.push(power);
  }
  return groups.filter((g) => g.powers.length > 0);
}

/** The recent row: pinned favourites first, then the most recent powers that are not pinned. No duplicates, at most 9. */
export function recentRow(store: Pick<UiStore, 'favourites' | 'recent'>): string[] {
  const ids: string[] = [];
  for (const id of [...store.favourites.value, ...store.recent.value]) {
    if (POWER_BY_ID.has(id) && !ids.includes(id)) ids.push(id);
    if (ids.length === 9) break;
  }
  return ids;
}

/** Every power whose plain name or category contains the query (case-insensitive). A blank query finds nothing. */
export function searchPowers(query: string): PowerDef[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  return POWERS.filter((p) => p.name.toLowerCase().includes(q) || categoryOf(p).toLowerCase().includes(q));
}
