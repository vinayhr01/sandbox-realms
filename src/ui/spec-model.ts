/**
 * Pure view models for the windows added for the spec table (13 section 7.1): being and structure
 * facts, army lines, annals (counter changes), comparison series, banner palettes and the developer
 * console. No DOM here, so the rules can be tested in node.
 */
import type { BeingRow, DominionRow, Snapshot, StructureRow } from '../shared/protocol.ts';
import { BUILDING_BY_ID } from '../sim/settlements/catalogue.ts';
import { counterLabel } from './snapshot-model.ts';
import type { HistorySample } from './realm-history.ts';

export type Facts = [label: string, value: string][];

/** What the sim does not store yet, per window. Shown as a note so nothing looks finished when it is not. */
export const MISSING = {
  items: 'Only items the realm holds are listed. Wear, durability, repair and crafting are not built.',
  pacts: 'Pacts are not stored in the realm yet. Dominion relations are kept only as peace, tension or war.',
  clans: 'Clans are read from the realm. The member limit is recorded, not enforced, and clans do not split or merge.',
  armies: 'The sim keeps one army strength per dominion. Captains, kills and deaths are not stored yet.',
  structures: 'Hit points, residents and produce are not stored per building yet.',
  annals: 'The realm has no event log yet. The annals list changes to the lifetime counters, as the snapshots show them.',
  banners: 'Banners are not stored by the realm yet. Choices last for this page session only.',
  traitRain: 'The realm does not read trait rain yet. Choices last for this page session only.',
  traitEdits: 'Trait edits are not wired to the sim yet. The traits shown are the ones the realm holds.',
  compare: 'The realm keeps no history. The chart uses the snapshots this page has received in this session.',
} as const;

/** Stage of life from the baby flag. */
export function stageLabel(row: BeingRow): string {
  return row.baby ? 'Child' : 'Adult';
}

export function beingFacts(row: BeingRow): Facts {
  return [
    ['Species', row.species],
    ['Kind', row.folk ? 'Folk' : 'Wild'],
    ['Sex', row.female ? 'Female' : 'Male'],
    ['Stage', stageLabel(row)],
    ['Age', `${row.ageYears} ${row.ageYears === 1 ? 'year' : 'years'}`],
    ['Vitality', `${row.vitality} of ${row.maxVitality}`],
    ['Strain', row.strain || 'None'],
    ['Children', String(row.children)],
  ];
}

/** Display name of a being row in lists: species and its id number. */
export function beingTitle(row: BeingRow): string {
  return `${row.species} ${row.id}`;
}

export function structureFacts(row: StructureRow, snap: Snapshot): Facts {
  const def = BUILDING_BY_ID.get(row.kind);
  const hamlet = snap.hamlets[row.hamlet];
  const footprint = def ? `${def.footprint} x ${def.footprint} tiles` : 'Unknown';
  return [
    ['Building', row.name],
    ['Hamlet', hamlet ? hamlet.name : `Hamlet ${row.hamlet + 1}`],
    ['Position', `${row.x}, ${row.y}`],
    ['Footprint', footprint],
  ];
}

/** The line a dominion's army shows in lists: strength and campaign state. */
export function armyLine(d: DominionRow, targetName: string | null): string {
  const campaign = d.campaignTarget < 0 ? 'No campaign' : `Campaigning against ${targetName ?? `Dominion ${d.campaignTarget}`}`;
  return `Strength ${d.strength} · ${campaign}`;
}

/** Army facts for one dominion row. Captain, kills and deaths are missing (see MISSING.armies). */
export function armyFacts(d: DominionRow, targetName: string | null, snap: Snapshot): Facts {
  return [
    ['Dominion', d.name],
    ['Strength', String(d.strength)],
    ['Parcels', String(d.parcels)],
    ['Campaign', d.campaignTarget < 0 ? 'None' : `Against ${targetName ?? `Dominion ${d.campaignTarget}`}`],
    ['Relations', `${d.peace} peace, ${d.tension} tension, ${d.war} war`],
    ['Dominions in the realm', String(snap.dominionCount)],
  ];
}

export type AnnalGroup = 'Beings' | 'Realm' | 'Land' | 'Other';
export const ANNAL_GROUPS: readonly AnnalGroup[] = ['Beings', 'Realm', 'Land', 'Other'];

/** Group of a lifetime counter key, from its words. */
export function counterGroup(key: string): AnnalGroup {
  if (/being|death|born|adult|child|strain|folk|kill|mate|birth/i.test(key)) return 'Beings';
  if (/campaign|pact|dominion|hamlet|family|creed|custom|dialect|intrigue|calamit|realm|age|power/i.test(key)) return 'Realm';
  if (/tile|land|burn|bolt|rain|flood|quake|fire|ice|lava|water|ground|stone|grow|flora/i.test(key)) return 'Land';
  return 'Other';
}

export interface AnnalRow {
  id: string;
  tick: number;
  key: string;
  label: string;
  delta: number;
  group: AnnalGroup;
}

/**
 * Counter changes between consecutive samples, newest first, capped at `limit` rows. A counter that
 * first appears counts from zero. Only increases are listed; the sim's counters only grow.
 */
export function annalRows(samples: readonly HistorySample[], limit = 500): AnnalRow[] {
  const rows: AnnalRow[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (!prev || !cur) continue;
    for (const [key, value] of Object.entries(cur.counters)) {
      const delta = value - (prev.counters[key] ?? 0);
      if (delta > 0) rows.push({ id: `${cur.tick}:${key}`, tick: cur.tick, key, label: counterLabel(key), delta, group: counterGroup(key) });
    }
  }
  rows.sort((a, b) => b.tick - a.tick || a.key.localeCompare(b.key));
  return rows.slice(0, limit);
}

export interface SeriesPoint {
  tick: number;
  value: number;
}

export interface CompareSeries {
  id: number;
  name: string;
  points: SeriesPoint[];
}

/** Strength of each chosen dominion across the session samples, oldest first. Samples without the dominion are skipped. */
export function compareSeries(samples: readonly HistorySample[], ids: readonly number[]): CompareSeries[] {
  return ids.map((id) => {
    const points: SeriesPoint[] = [];
    let name = `Dominion ${id}`;
    for (const s of samples) {
      const d = s.dominions.get(id);
      if (!d) continue;
      name = d.name;
      points.push({ tick: s.tick, value: d.strength });
    }
    return { id, name, points };
  });
}

/** The highest value across series, at least 1, so an empty chart still has a scale. */
export function seriesMax(series: readonly CompareSeries[]): number {
  let max = 1;
  for (const s of series) for (const p of s.points) if (p.value > max) max = p.value;
  return max;
}

/** Banner palette (name, hex colour). Plain swatches, not brand colours. */
export const BANNER_COLOURS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Ochre', hex: '#b7791f' },
  { name: 'Rust', hex: '#9c4221' },
  { name: 'Crimson', hex: '#9b2c2c' },
  { name: 'Plum', hex: '#6b46c1' },
  { name: 'Indigo', hex: '#3c366b' },
  { name: 'Slate', hex: '#4a5568' },
  { name: 'Teal', hex: '#2c7a7b' },
  { name: 'Moss', hex: '#4c7d3a' },
  { name: 'Olive', hex: '#6b6b2b' },
  { name: 'Sand', hex: '#c9b27c' },
  { name: 'Ash', hex: '#a0aec0' },
  { name: 'Ink', hex: '#1a202c' },
];

/** Icon names for banners (text labels; the icon art is not in the build). */
export const BANNER_ICONS: readonly string[] = ['Sun', 'Moon', 'Wave', 'Stone', 'Tree', 'Star', 'Flame', 'Eye', 'Hand', 'Crown', 'Bird', 'Wheat'];

export const DEFAULT_BANNER = { colour: BANNER_COLOURS[0]?.hex ?? '#b7791f', icon: BANNER_ICONS[0] ?? 'Sun' };

export interface ConsoleContext {
  tick: number;
  version: string;
  snap: Snapshot | null;
}

/** Commands that would change the realm. This console does not run them yet. */
const WRITE_COMMANDS: ReadonlySet<string> = new Set([
  'spawn',
  'kill',
  'heal',
  'grant',
  'revoke',
  'set',
  'setrule',
  'age',
  'warp',
  'step',
  'speed',
  'pause',
  'weather',
  'paint',
  'power',
  'save',
  'load',
  'export',
  'import',
]);

export const CONSOLE_HELP: readonly string[] = [
  'help: list the commands',
  'version: the build version',
  'tick: the sim tick',
  'counts: totals of beings, dominions, hamlets, structures',
  'population: beings by species',
  'dominions: dominions with army strength',
  'strains: strains with generation',
  'clear: empty this log',
];

/**
 * One console line as output lines. Read commands only (13, 14 section 8): the write commands of the
 * spec are listed but not built, so they say so. An empty line gives no output.
 */
export function runConsoleCommand(line: string, ctx: ConsoleContext): string[] {
  const parts = line.trim().split(/\s+/).filter((p) => p.length > 0);
  const name = parts[0]?.toLowerCase();
  if (name === undefined) return [];
  if (name === 'help') return [...CONSOLE_HELP];
  if (name === 'version') return [`Sandbox Realms ${ctx.version}`];
  if (name === 'tick') return [`Tick ${ctx.tick}`];
  if (name === 'clear') return [];
  if (WRITE_COMMANDS.has(name)) return [`${name}: write commands are not built in this console yet. Nothing changed.`];
  const snap = ctx.snap;
  if (snap === null) return ['The realm has not sent a snapshot yet.'];
  switch (name) {
    case 'counts':
      return [
        `Beings ${snap.population.total}, folk ${snap.population.folk}, wild ${snap.population.wild}`,
        `Dominions ${snap.dominionCount}, hamlets ${snap.hamletCount}`,
        `Structures ${snap.detail?.notable?.structureCount ?? 0}, strains ${snap.detail?.counts.strains ?? 0}`,
      ];
    case 'population': {
      const rows = snap.population.species.map((s) => `${s.name}: ${s.count}`);
      return rows.length > 0 ? rows : ['No beings alive.'];
    }
    case 'dominions': {
      const rows = snap.dominions.map((d) => `${d.name}: strength ${d.strength}, ${d.parcels} parcels`);
      return rows.length > 0 ? rows : ['No dominions.'];
    }
    case 'strains': {
      const rows = (snap.detail?.strains ?? []).map((s) => `${s.name}: generation ${s.generation}`);
      return rows.length > 0 ? rows : ['No strains.'];
    }
    default:
      return [`Unknown command: ${name}. Type help.`];
  }
}

/** Keeps the log to the last `cap` lines (the spec caps the log at 2,500 lines). */
export function capLog(lines: readonly string[], cap = 2500): string[] {
  return lines.length > cap ? lines.slice(lines.length - cap) : [...lines];
}
