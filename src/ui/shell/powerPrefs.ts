/**
 * Favourites and the recent powers, kept across reloads in safe storage (the same way as the tutorial and the options).
 * Ids that are no longer powers are dropped on load, so a renamed or removed power cannot leave a dead button behind.
 */
import { POWER_BY_ID } from '../../content/powers.ts';
import type { KeyValueStorage } from '../panels/options.ts';
import { MAX_FAVOURITES } from '../panels/powerBar.ts';

export const POWER_PREFS_KEY = 'sr.powers.v1';
/** The recent row holds at most this many powers (spec B). */
export const MAX_RECENT = 9;

export interface PowerPrefs {
  favourites: string[];
  recent: string[];
}

function ids(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const kept: string[] = [];
  for (const id of value) {
    if (typeof id === 'string' && POWER_BY_ID.has(id) && !kept.includes(id)) kept.push(id);
    if (kept.length === max) break;
  }
  return kept;
}

/** Reads a stored value, keeping only known power ids. Anything else gives empty lists. */
export function parsePowerPrefs(raw: unknown): PowerPrefs {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { favourites: [], recent: [] };
  const record = raw as Record<string, unknown>;
  return { favourites: ids(record['favourites'], MAX_FAVOURITES), recent: ids(record['recent'], MAX_RECENT) };
}

/** Loads the saved preferences. A missing, corrupt or unreadable store gives empty lists. */
export function loadPowerPrefs(storage: KeyValueStorage | null): PowerPrefs {
  try {
    const raw = storage?.getItem(POWER_PREFS_KEY);
    return parsePowerPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return parsePowerPrefs(null);
  }
}

/** Saves the preferences. A write that fails leaves the lists in memory for this visit only. */
export function savePowerPrefs(storage: KeyValueStorage | null, prefs: PowerPrefs): void {
  try {
    storage?.setItem(POWER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not saved: favourites and the recent row start again on the next visit.
  }
}
