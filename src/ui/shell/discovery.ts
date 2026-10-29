/**
 * Progressive discovery state (UX redesign, spec E). Pure: `evaluate` takes the last state and a snapshot and returns the
 * next state and the entries met on this check. The app keeps the state in safe storage (main.ts) and turns the result
 * into chips and one card.
 */
import type { Snapshot } from '../../shared/protocol.ts';
import type { StatsRecord } from '../../sim/stats.ts';
import { DISCOVERIES, type DiscoveryEntry } from '../../content/discoveries.ts';
import { CHIP_IDS, CHIP_LABELS, type ChipId } from './powerCatalog.ts';

/** Storage key for the discovery state (per device, lifetime). */
export const DISCOVERY_KEY = 'sr.discovery.v1';

/** The chips every new player starts with. */
export const STARTER_CHIPS: readonly ChipId[] = ['land', 'nature', 'creatures'];

export interface DiscoveryState {
  /** Entry ids met so far, in the order they were met. */
  found: string[];
  /** Species ids that had living beings at an earlier evaluation (the extinction trigger reads them). */
  seen: string[];
}

export function newDiscovery(): DiscoveryState {
  return { found: [], seen: [] };
}

/** Reads a saved state; anything unexpected starts again from nothing. */
export function parseDiscovery(raw: unknown): DiscoveryState {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { found: strings(src['found']), seen: strings(src['seen']) };
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
  const newly = entries.filter((e) => !known.has(e.id) && e.met(snap, stats, seen)).map((e) => e.id);
  const alive = snap.population.species.filter((row) => row.count > 0).map((row) => row.id);
  const seenNext = [...new Set([...state.seen, ...alive])];
  if (newly.length === 0 && seenNext.length === state.seen.length) return { state, newly };
  return { state: { found: [...state.found, ...newly], seen: seenNext }, newly };
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
