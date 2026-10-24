/**
 * Pure view models for the windows that read the sim snapshot (13 sections 6 to 8). No DOM here:
 * each function turns a Snapshot into the rows a window shows, so the rules can be tested in node.
 */
import { ACHIEVEMENTS, TRAIT_TOTAL, ROSTER_SPAWNABLE, type AchievementDef } from '../content/achievements.ts';
import { trophySummary, visibleText } from '../sim/progression.ts';
import type { AchievementRow, DominionRow, HamletRow, Snapshot, SpeciesRow } from '../shared/protocol.ts';

export type LabelledValue = readonly [label: string, value: string];

/** Headline figures (the Figures window): counters the sim already records (14 section 3). */
export function figureRows(snap: Snapshot): LabelledValue[] {
  const c = snap.counters;
  const n = (key: string): string => String(c[key] ?? 0);
  return [
    ['Realms created', n('realmsCreated')],
    ['Beings spawned', n('beingsSpawned')],
    ['Beings born', n('beingsBorn')],
    ['Deaths', n('deaths')],
    ['Powers used', n('powerUsesTotal')],
    ['Calamities caused', n('calamitiesCaused')],
    ['Campaigns started', n('campaignsStarted')],
    ['Pacts formed', n('pactsFormed')],
    ['Tiles burned', n('tilesBurned')],
    ['Land painted', n('tilesPaintedLand')],
    ['Lightning strikes', n('boltsStruck')],
    ['Years elapsed', n('simYearsElapsed')],
    ['Ages reached', String(snap.sets['agesReached'] ?? 0)],
  ];
}

/** Human label for a counter key: `deathsByCause.eaten` reads as "Deaths by cause: eaten". */
export function counterLabel(key: string): string {
  const words = (s: string): string =>
    s
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .toLowerCase();
  const dot = key.indexOf('.');
  if (dot < 0) {
    const text = words(key);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const head = key.slice(0, dot);
  const tail = words(key.slice(dot + 1));
  const headText = head === 'deathsByCause' ? 'Deaths by cause' : head === 'powerUses' ? 'Power uses' : head === 'milestone' ? 'Milestone' : words(head);
  return `${headText.charAt(0).toUpperCase() + headText.slice(1)}: ${tail}`;
}

export interface CounterRow {
  id: string;
  label: string;
  value: number;
}

/** Every lifetime counter as a row, in key order. */
export function lifetimeRows(snap: Snapshot): CounterRow[] {
  return Object.entries(snap.counters).map(([id, value]) => ({ id, label: counterLabel(id), value }));
}

export interface AchievementView {
  id: string;
  name: string;
  desc: string;
  group: AchievementDef['group'];
  unlocked: boolean;
  value: number;
  target: number;
  /** 0..1 for the progress bar. */
  fraction: number;
}

/** The catalogue (63 entries, catalogue order) joined with the unlock state and progress from the snapshot. */
export function achievementViews(snap: Snapshot | null, defs: readonly AchievementDef[] = ACHIEVEMENTS): AchievementView[] {
  const byId = new Map<string, AchievementRow>((snap?.achievements ?? []).map((r) => [r.id, r]));
  return defs.map((def) => {
    const row = byId.get(def.id);
    const unlocked = row?.unlocked ?? false;
    const value = row?.value ?? 0;
    const text = visibleText(def, unlocked);
    return {
      id: def.id,
      name: text.name,
      desc: text.desc,
      group: def.group,
      unlocked,
      value,
      target: def.target,
      fraction: def.target <= 0 ? 1 : Math.min(1, value / def.target),
    };
  });
}

/** Headline for the achievements window, e.g. "12 of 63 unlocked, 4 secrets left". */
export function achievementHeadline(snap: Snapshot | null, defs: readonly AchievementDef[] = ACHIEVEMENTS): string {
  const unlocked = new Set((snap?.achievements ?? []).filter((r) => r.unlocked).map((r) => r.id));
  const s = trophySummary(unlocked, defs);
  const secrets = s.secretsLeft === 1 ? '1 secret left' : `${s.secretsLeft} secrets left`;
  return `${s.unlocked} of ${s.total} unlocked, ${secrets}`;
}

export function codexLines(snap: Snapshot): LabelledValue[] {
  const c = snap.codex;
  return [
    ['Discoveries', String(c.discoveries)],
    ['Traits known', `${c.traits} of ${c.traitTotal || TRAIT_TOTAL}`],
    ['Species known', `${c.species} of ${c.rosterTotal || ROSTER_SPAWNABLE}`],
  ];
}

/** Fraction 0..1 of a count against a total, for meter bars. */
export function fraction(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, count / total));
}

export function populationLines(snap: Snapshot): LabelledValue[] {
  const p = snap.population;
  return [
    ['Alive now', String(p.total)],
    ['Folk', String(p.folk)],
    ['Wild', String(p.wild)],
    ['Species present', String(p.species.length)],
    ['Born so far', String(snap.counters['beingsBorn'] ?? 0)],
    ['Deaths so far', String(snap.counters['deaths'] ?? 0)],
  ];
}

/** Species with the largest counts first; the population bars show the first `limit`. */
export function topSpecies(snap: Snapshot, limit = 12): SpeciesRow[] {
  return [...snap.population.species].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, limit);
}

export function cultureLines(snap: Snapshot): LabelledValue[] {
  const c = snap.culture;
  return [
    ['Customs', String(c.customs)],
    ['Creeds', `${c.creeds} (${c.creedHolders} holder groups)`],
    ['Dialects', `${c.dialects} (across ${c.dialectGroups} groups)`],
    ['Intrigues active', String(c.intriguesActive)],
    ['Intrigues resolved', String(c.intriguesResolved)],
    ['Families', String(c.families)],
  ];
}

export function dominionLine(d: DominionRow): string {
  const rel = `peace ${d.peace}, tension ${d.tension}, war ${d.war}`;
  return `${d.parcels} parcels · army ${d.strength} · ${d.neighbours} neighbours · ${rel}`;
}

export function hamletLine(h: HamletRow): string {
  return `folk ${h.folk} · ${h.buildings} buildings · ${h.parcels} parcels`;
}

/** Name of a dominion's campaign target, or null when it has none. */
export function campaignTargetName(snap: Snapshot, d: DominionRow): string | null {
  if (d.campaignTarget < 0) return null;
  return snap.dominions.find((x) => x.id === d.campaignTarget)?.name ?? `Dominion ${d.campaignTarget}`;
}
