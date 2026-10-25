/**
 * Clans (11-intrigue-customs-creeds-dialects.md, sec 2 and 7; the "kinbands" list in 13 section 7.1).
 *
 * Rule (chosen for this build, see DECISIONS.md): a clan is the living members of one strain. A strain
 * with at least CLAN_FOUND_MIN living members and no clan yet founds one, once per strain. The chief is
 * the oldest living member (birth tick, then slot). The clan's member count is the living count of its strain
 * (plus the strains merged into it, see mergeClans); a clan whose strains have no living member left is extinct
 * for good (births need a living parent, so a strain cannot come back). Families are not stored by the beings system
 * (culture.families is only written by tests), so clans are founded from strains; the spec's "group of families" is
 * the open part of this rule.
 *
 * Renown (11 section 7): a clan gains 1 renown per year that it has a living chief. Merges (mergeClans) are a god-tool
 * operation: 11 section 2 says objects never merge on their own. Splits are not in the spec for clans (11 section 2:
 * "a clan never splits").
 *
 * Structural only: the module reads the beings store and the strain registry and writes its own state
 * (`sim.clans`). It never writes beings, strains or realm data, so the state hash is unchanged. Names come from the
 * name generator (culture/names.ts) with its own seed, so naming draws no sim RNG.
 */
import { SPECIES } from '../../content/beasts.ts';
import { MONTH_TICKS, YEAR_TICKS } from '../../shared/constants.ts';
import { CLAN_RECIPE, generateName, NAME_KIND, nameSeed } from '../culture/names.ts';
import { MAX_BEINGS } from '../beings/store.ts';
import type { Sim } from '../sim.ts';

/** Ticks between clan scans: once per Month (02 section 1). */
export const CLAN_SCAN_TICKS = MONTH_TICKS;
/** Living members a strain needs before it founds a clan (OPEN, design default). */
export const CLAN_FOUND_MIN = 4;
/** Member limit recorded on each clan (11 section 7: CLAN_DEFAULT_LIMIT, OPEN). Enforced for merges; births are not refused (see DECISIONS.md). */
export const CLAN_DEFAULT_LIMIT = 50;

export interface Clan {
  id: number;
  name: string;
  /** The strain whose living members make up the clan. */
  strain: number;
  /** Species index into SPECIES. */
  species: number;
  foundedTick: number;
  /** Living members, as of the last scan. */
  members: number;
  /** Chief as a BeingRow id (generation * MAX_BEINGS + slot), or -1 when there is none. */
  chief: number;
  /** Birth tick of the chief (for its age). */
  chiefBorn: number;
  /** Tick the clan was found to have no living member; -1 while it has members. A merged-away clan is stamped with its merge tick. */
  extinctTick: number;
  limit: number;
  /** Renown: 1 per year its chief leads (11 section 7). */
  renown: number;
  /** Tick the renown was counted up to. */
  renownTick: number;
  /** The clan this one was merged into, or -1. A merged-away clan counts no members of its own. */
  mergedInto: number;
  /** Strains merged into this clan: their living members count toward it. */
  absorbed: number[];
}

/** Saved and live clan records. `next` is the next id to hand out (ids start at 1). */
export interface ClanState {
  next: number;
  list: Clan[];
}

export function createClanState(): ClanState {
  return { next: 1, list: [] };
}

/** A clan name from the name generator; a taken name is redrawn with another salt a few times, then numbered. */
function clanName(worldSeed: number, id: number, taken: ReadonlySet<string>): string {
  for (let salt = 0; salt < 8; salt++) {
    const name = generateName(CLAN_RECIPE, nameSeed(worldSeed, NAME_KIND.clan, id, salt));
    if (name !== 'Nameless' && !taken.has(name)) return name;
  }
  return `Clan ${id}`;
}

interface Census {
  count: number;
  chief: number;
  born: number;
}

/** Living members per strain id, with each strain's chief (oldest, then lowest slot). Read-only. */
function census(sim: Sim): Map<number, Census> {
  const s = sim.beings.store;
  const out = new Map<number, Census>();
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    const strain = s.strain[slot] ?? 0;
    if (strain === 0) continue;
    const born = s.born[slot] ?? 0;
    const c = out.get(strain);
    if (!c) {
      out.set(strain, { count: 1, chief: slot, born });
    } else {
      c.count++;
      if (born < c.born || (born === c.born && slot < c.chief)) {
        c.chief = slot;
        c.born = born;
      }
    }
  }
  return out;
}

/** Living members of a clan: its own strain plus the strains merged into it, with the oldest member as chief. */
function combined(clan: Clan, counts: ReadonlyMap<number, Census>): Census | undefined {
  let out: Census | undefined;
  for (const strain of [clan.strain, ...clan.absorbed]) {
    const c = counts.get(strain);
    if (!c) continue;
    if (!out) {
      out = { count: c.count, chief: c.chief, born: c.born };
    } else {
      out.count += c.count;
      if (c.born < out.born || (c.born === out.born && c.chief < out.chief)) {
        out.chief = c.chief;
        out.born = c.born;
      }
    }
  }
  return out;
}

/**
 * One clan scan (every CLAN_SCAN_TICKS). Refreshes each clan's members and chief, counts renown for the years its chief
 * has led, marks clans whose strains have no living member as extinct, and founds clans for strains that qualify, in
 * strain id order. A merged-away clan is skipped: its strains are counted by the clan it merged into.
 */
export function clansStep(sim: Sim): void {
  if (!sim.due('clans', CLAN_SCAN_TICKS)) return;
  const state = sim.clans;
  const counts = census(sim);
  const s = sim.beings.store;

  for (const clan of state.list) {
    if (clan.mergedInto >= 0) continue;
    const c = combined(clan, counts);
    if (!c) {
      clan.members = 0;
      clan.chief = -1;
      clan.chiefBorn = 0;
      if (clan.extinctTick < 0) clan.extinctTick = sim.tick;
      continue;
    }
    clan.members = c.count;
    clan.chief = (s.generation[c.chief] ?? 0) * MAX_BEINGS + c.chief;
    clan.chiefBorn = c.born;
    const years = Math.floor((sim.tick - clan.renownTick) / YEAR_TICKS);
    if (years > 0) {
      clan.renown += years;
      clan.renownTick += years * YEAR_TICKS;
    }
  }

  // Every strain that belongs to a clan on record (own or merged in) cannot found another clan.
  const founded = new Set<number>();
  for (const clan of state.list) {
    founded.add(clan.strain);
    for (const a of clan.absorbed) founded.add(a);
  }
  const taken = new Set(state.list.map((c) => c.name));
  const strains = sim.beings.strains.snapshot().list;
  for (const strain of strains) {
    const c = counts.get(strain.id);
    if (founded.has(strain.id) || !c || c.count < CLAN_FOUND_MIN) continue;
    const id = state.next++;
    const name = clanName(sim.realm.seed, id, taken);
    taken.add(name);
    state.list.push({
      id,
      name,
      strain: strain.id,
      species: strain.species,
      foundedTick: sim.tick,
      members: c.count,
      chief: (s.generation[c.chief] ?? 0) * MAX_BEINGS + c.chief,
      chiefBorn: c.born,
      extinctTick: -1,
      limit: CLAN_DEFAULT_LIMIT,
      renown: 0,
      renownTick: sim.tick,
      mergedInto: -1,
      absorbed: [],
    });
  }
}

/** Result of mergeClans: ok, or the reason it was refused. */
export type MergeResult = { ok: true } | { ok: false; reason: string };

/**
 * Merges clan `fromId` into clan `intoId` (god tool; 11 section 2, objects never merge on their own). The strains of `from`
 * count toward `into` from the next scan on. Refused when a clan is missing, when they are the same, when either is merged
 * away or extinct, or when the combined living members would exceed `into`'s member limit (the 50-member enforcement).
 * Renown stays with `into`. Draws no rng.
 */
export function mergeClans(state: ClanState, intoId: number, fromId: number, tick: number): MergeResult {
  if (intoId === fromId) return { ok: false, reason: 'a clan cannot merge into itself' };
  const into = state.list.find((c) => c.id === intoId);
  const from = state.list.find((c) => c.id === fromId);
  if (!into || !from) return { ok: false, reason: 'no such clan' };
  if (into.mergedInto >= 0 || from.mergedInto >= 0 || into.extinctTick >= 0 || from.extinctTick >= 0) {
    return { ok: false, reason: 'a clan that is merged away or extinct cannot merge' };
  }
  if (into.members + from.members > into.limit) return { ok: false, reason: `the merged clan would have more than ${into.limit} members` };
  into.absorbed = [...into.absorbed, from.strain, ...from.absorbed];
  into.members += from.members;
  from.mergedInto = into.id;
  from.absorbed = [];
  from.members = 0;
  from.chief = -1;
  from.chiefBorn = 0;
  from.extinctTick = tick;
  return { ok: true };
}

/** Species name of a clan, or '' when the index is unknown. */
export function clanSpeciesName(clan: Clan): string {
  return SPECIES[clan.species]?.name ?? '';
}

/** Whole years since a tick, from a birth tick (0 when not yet born). */
export function yearsSince(tick: number, born: number): number {
  return Math.max(0, Math.floor((tick - born) / YEAR_TICKS));
}

/**
 * Replaces the clan records with a saved form. Throws when the shape is wrong, so a bad save never
 * yields partial clans. Unknown extra fields are dropped by copying only the known ones. The renown, merge and
 * absorbed fields are optional (saves written before them load with 0, -1 and none).
 */
export function restoreClans(state: ClanState, data: unknown): void {
  if (typeof data !== 'object' || data === null) throw new Error('chronicle: clans section is not valid');
  const d = data as { next?: unknown; list?: unknown };
  if (!Number.isInteger(d.next) || !Array.isArray(d.list)) throw new Error('chronicle: clans section is not valid');
  const next = d.next as number;
  const ids = new Set<number>();
  const list: Clan[] = [];
  for (const item of d.list as Partial<Record<keyof Clan, unknown>>[]) {
    const id = item.id;
    const species = item.species;
    const renown = item.renown ?? 0;
    const renownTick = item.renownTick ?? item.foundedTick;
    const mergedInto = item.mergedInto ?? -1;
    const absorbed = item.absorbed ?? [];
    const valid =
      Number.isInteger(id) &&
      (id as number) >= 1 &&
      (id as number) < next &&
      !ids.has(id as number) &&
      typeof item.name === 'string' &&
      Number.isInteger(item.strain) &&
      Number.isInteger(species) &&
      (species as number) >= 0 &&
      (species as number) < SPECIES.length &&
      Number.isInteger(item.foundedTick) &&
      Number.isInteger(item.members) &&
      Number.isInteger(item.chief) &&
      Number.isInteger(item.chiefBorn) &&
      Number.isInteger(item.extinctTick) &&
      Number.isInteger(item.limit) &&
      Number.isInteger(renown) &&
      (renown as number) >= 0 &&
      Number.isInteger(renownTick) &&
      Number.isInteger(mergedInto) &&
      (mergedInto as number) >= -1 &&
      Array.isArray(absorbed) &&
      absorbed.every((a) => Number.isInteger(a));
    if (!valid) throw new Error('chronicle: clan record is not valid');
    ids.add(id as number);
    list.push({
      id: id as number,
      name: item.name as string,
      strain: item.strain as number,
      species: species as number,
      foundedTick: item.foundedTick as number,
      members: item.members as number,
      chief: item.chief as number,
      chiefBorn: item.chiefBorn as number,
      extinctTick: item.extinctTick as number,
      limit: item.limit as number,
      renown: renown as number,
      renownTick: renownTick as number,
      mergedInto: mergedInto as number,
      absorbed: [...(absorbed as number[])],
    });
  }
  state.next = next;
  state.list = list;
}
