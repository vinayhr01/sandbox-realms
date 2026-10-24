/**
 * Clans (11-intrigue-customs-creeds-dialects.md, sec 2 and 7; the "kinbands" list in 13 section 7.1).
 *
 * Rule (chosen for this build, see DECISIONS.md): a clan is the living members of one strain. A strain
 * with at least CLAN_FOUND_MIN living members and no clan yet founds one, once per strain. The chief is
 * the oldest living member (birth tick, then slot). The clan's member count is the strain's living
 * count; a clan whose strain has no living member left is extinct for good (births need a living
 * parent, so the strain cannot come back). Families are not stored by the beings system (culture.families
 * is only written by tests), so clans are founded from strains; the spec's "group of families" is
 * the open part of this rule.
 *
 * Structural only: the module reads the beings store and the strain registry and writes its own state
 * (`sim.clans`). It never writes beings, strains or realm data, so the state hash is unchanged. Names
 * come from the sim's `clans` RNG stream, drawn only when a clan forms.
 */
import { SPECIES } from '../../content/beasts.ts';
import { MONTH_TICKS, YEAR_TICKS } from '../../shared/constants.ts';
import type { Rng } from '../../shared/rng.ts';
import { MAX_BEINGS } from '../beings/store.ts';
import type { Sim } from '../sim.ts';

/** Ticks between clan scans: once per Month (02 section 1). */
export const CLAN_SCAN_TICKS = MONTH_TICKS;
/** Living members a strain needs before it founds a clan (OPEN, design default). */
export const CLAN_FOUND_MIN = 4;
/** Member limit recorded on each clan (11 section 7: CLAN_DEFAULT_LIMIT, OPEN). Advisory: births are not refused. */
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
  /** Tick the clan was found to have no living member; -1 while it has members. */
  extinctTick: number;
  limit: number;
}

/** Saved and live clan records. `next` is the next id to hand out (ids start at 1). */
export interface ClanState {
  next: number;
  list: Clan[];
}

export function createClanState(): ClanState {
  return { next: 1, list: [] };
}

const PREFIXES = ['Ash', 'Briar', 'Cinder', 'Dun', 'Ember', 'Fen', 'Gale', 'Heath', 'Iron', 'Kestrel', 'Lark', 'Marrow', 'Nettle', 'Oak', 'Pell', 'Quill', 'Reed', 'Stone', 'Thorn', 'Vale', 'Wren', 'Yew'] as const;
const SUFFIXES = ['hold', 'fell', 'mere', 'wick', 'brand', 'stair', 'moor', 'kin', 'reach', 'ford'] as const;

/** A clan name from the prefix and suffix lists; a taken name is redrawn a few times, then numbered. */
function clanName(rng: Rng, taken: ReadonlySet<string>, id: number): string {
  for (let tries = 0; tries < 8; tries++) {
    const name = `${PREFIXES[rng.int(PREFIXES.length)] ?? 'Ash'}${SUFFIXES[rng.int(SUFFIXES.length)] ?? 'hold'}`;
    if (!taken.has(name)) return name;
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

/**
 * One clan scan (every CLAN_SCAN_TICKS). Refreshes each clan's members and chief, marks clans whose
 * strain has no living member as extinct, and founds clans for strains that qualify, in strain id order.
 */
export function clansStep(sim: Sim): void {
  if (!sim.due('clans', CLAN_SCAN_TICKS)) return;
  const state = sim.clans;
  const counts = census(sim);
  const s = sim.beings.store;

  for (const clan of state.list) {
    const c = counts.get(clan.strain);
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
  }

  const founded = new Set(state.list.map((c) => c.strain));
  const taken = new Set(state.list.map((c) => c.name));
  const strains = sim.beings.strains.snapshot().list;
  for (const strain of strains) {
    const c = counts.get(strain.id);
    if (founded.has(strain.id) || !c || c.count < CLAN_FOUND_MIN) continue;
    const id = state.next++;
    const name = clanName(sim.rng('clans'), taken, id);
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
    });
  }
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
 * yields partial clans. Unknown extra fields are dropped by copying only the known ones.
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
      Number.isInteger(item.limit);
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
    });
  }
  state.next = next;
  state.list = list;
}
