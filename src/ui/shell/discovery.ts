/**
 * Progressive discovery state (UX redesign, spec E). Pure: `evaluate` takes the last state and a snapshot and returns the
 * next state and the entries met on this check. The app keeps the state in safe storage (main.ts) and turns the result
 * into chips and one card.
 */
import type { Snapshot } from '../../shared/protocol.ts';
import type { StatsRecord } from '../../sim/stats.ts';
import { DISCOVERIES, type DiscoveryEntry } from '../../content/discoveries.ts';
import { POWERS, type PowerDef } from '../../content/powers.ts';
import { CHIP_IDS, CHIP_LABELS, chipOf as chipOfPower, type ChipId } from './powerCatalog.ts';

/** Storage key for the discovery state (per device, lifetime). */
export const DISCOVERY_KEY = 'sr.discovery.v1';

/** The chips every new player starts with. */
export const STARTER_CHIPS: readonly ChipId[] = ['land', 'nature', 'creatures'];

export interface DiscoveryState {
  /** Entry ids met so far, in the order they were met. Saved. */
  found: string[];
  /** Power ids the player has seen in the expanded grid or used. Saved (lifetime); it clears the "New" markers. */
  seenPowers: string[];
  /** Species ids that had living beings at an earlier evaluation (the extinction trigger reads them). Per realm, not saved. */
  seen: string[];
  /** The strain count at the last check that had snapshot detail (the first-strain trigger reads it). Per realm, not saved. */
  strains: number | null;
}

export function newDiscovery(): DiscoveryState {
  return { found: [], seenPowers: [], seen: [], strains: null };
}

/**
 * Reads a saved state; anything unexpected starts again from nothing. Only `found` and `seenPowers` are saved. `seen` and
 * `strains` are the per-realm memory of the triggers, so an old save's values are dropped here, not carried into a new
 * world. A save from before `seenPowers` existed reads as no powers seen.
 */
export function parseDiscovery(raw: unknown): DiscoveryState {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { found: strings(src['found']), seenPowers: strings(src['seenPowers']), seen: [], strains: null };
}

/**
 * Evaluates every entry against the snapshot. Entries already found are skipped, so a second call with the same snapshot
 * returns the same state and no new entries (idempotent). Returns the input state object itself when nothing changed.
 */
export function evaluate(
  state: DiscoveryState,
  snap: Snapshot,
  stats: StatsRecord,
  entries: readonly DiscoveryEntry[] = DISCOVERIES,
): { state: DiscoveryState; newly: string[] } {
  const known = new Set(state.found);
  const seen = new Set(state.seen);
  const newly = entries.filter((e) => !known.has(e.id) && e.met(snap, stats, seen, state.strains)).map((e) => e.id);
  const alive = snap.population.species.filter((row) => row.count > 0).map((row) => row.id);
  const seenNext = [...new Set([...state.seen, ...alive])];
  // A snapshot without detail says nothing about strains, so the last count stays.
  const strainsNext = snap.detail?.counts.strains ?? state.strains;
  if (newly.length === 0 && seenNext.length === state.seen.length && strainsNext === state.strains) return { state, newly };
  return { state: { ...state, found: [...state.found, ...newly], seen: seenNext, strains: strainsNext }, newly };
}

/**
 * The power ids that carry a "New" marker: their chip came forward from a found entry (the starter chips never do) and the
 * player has not seen or used the power yet. With "show all categories" on, only the chips that were met count.
 */
export function newPowerIds(found: readonly string[], seenPowers: readonly string[], powers: readonly PowerDef[] = POWERS, entries: readonly DiscoveryEntry[] = DISCOVERIES): Set<string> {
  const brought = new Set<ChipId>(chipsFor(found, false, entries).filter((c) => !STARTER_CHIPS.includes(c)));
  const seen = new Set(seenPowers);
  const fresh = new Set<string>();
  for (const power of powers) {
    const chip = chipOfPower(power);
    if (chip !== null && brought.has(chip) && !seen.has(power.id)) fresh.add(power.id);
  }
  return fresh;
}

/** The chip an entry brings forward, if it has one. */
function chipOf(entry: DiscoveryEntry): ChipId | null {
  return (CHIP_IDS as readonly string[]).includes(entry.chip ?? '') ? (entry.chip as ChipId) : null;
}

/**
 * The toast for the entries met on one check: none for an empty list, "New!" with the chip and title for one entry,
 * and one summary line for several (an old save meets many at once, so it does not burst cards).
 */
export function discoveryToast(newly: readonly string[], entries: readonly DiscoveryEntry[] = DISCOVERIES): { text: string; kind: 'new' } | null {
  const met = newly.map((id) => entries.find((e) => e.id === id)).filter((e): e is DiscoveryEntry => e !== undefined);
  if (met.length === 0) return null;
  const labelOf = (e: DiscoveryEntry): string => {
    const chip = chipOf(e);
    return chip ? CHIP_LABELS[chip] : e.title;
  };
  if (met.length === 1) {
    const [only] = met;
    if (!only) return null;
    const chip = chipOf(only);
    return { text: chip ? `${CHIP_LABELS[chip]}: ${only.title}` : only.title, kind: 'new' };
  }
  const labels = [...new Set(met.map(labelOf))];
  return { text: `Discovered: ${labels.join(', ')}`, kind: 'new' };
}

/** The chips to show: the starter chips and the chips of the entries found, or every chip when `all` is on. */
export function chipsFor(found: readonly string[], all: boolean, entries: readonly DiscoveryEntry[] = DISCOVERIES): ChipId[] {
  if (all) return [...CHIP_IDS];
  const brought = new Set<string>(STARTER_CHIPS);
  for (const id of found) {
    const entry = entries.find((e) => e.id === id);
    const chip = entry ? chipOf(entry) : null;
    if (chip) brought.add(chip);
  }
  return CHIP_IDS.filter((c) => brought.has(c));
}
