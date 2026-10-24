/**
 * Progression rules from 14 that the sim can express, as pure functions (no state, no I/O):
 * the taint and tutorial crediting rules (14 sections 3, 6 and 12), the trophies summary
 * (14 section 11) and the codex totals that drive achievements 56-59 (14 section 5).
 */
import { ACHIEVEMENTS, GROUPS, ROSTER_SPAWNABLE, TRAIT_TOTAL, type AchievementDef, type AchievementGroup } from '../content/achievements.ts';
import { setCount, type StatsRecord } from './stats.ts';

export type RealmOrigin = 'player' | 'tutorial' | 'import';

export interface RealmCredit {
  origin: RealmOrigin;
  /** Set when developer tools mutated the Realm (14 section 6). Sticky. */
  tainted: boolean;
}

/** Achievements a tutorial Realm may still be granted (14 section 12). */
export const TUTORIAL_SAFE: readonly string[] = ['ach_cradle', 'ach_quick_study'];

/**
 * Whether counters are credited for an event in this Realm. Auto events (bots, scripts) never
 * count; tainted Realms and tutorial Realms credit nothing here (tutorial achievements are handled
 * by grantAllowed).
 */
export function countsCredited(realm: RealmCredit, auto: boolean): boolean {
  return !auto && !realm.tainted && realm.origin !== 'tutorial';
}

/**
 * Whether an achievement may be granted in this Realm. Tainted Realms grant nothing; tutorial
 * Realms grant only the safe list. Granting is also blocked for already unlocked ids by the caller.
 */
export function grantAllowed(id: string, realm: RealmCredit): boolean {
  if (realm.tainted) return false;
  if (realm.origin === 'tutorial') return TUTORIAL_SAFE.includes(id);
  return true;
}

export interface TrophySummary {
  total: number;
  unlocked: number;
  /** Hidden entries not yet unlocked (the "n secrets left" line of 14 section 11). */
  secretsLeft: number;
  complete: boolean;
  groups: Record<AchievementGroup, { total: number; unlocked: number }>;
}

/** Counts for the trophies header and group sections. Unknown ids in `unlocked` are ignored. */
export function trophySummary(unlocked: ReadonlySet<string>, defs: readonly AchievementDef[] = ACHIEVEMENTS): TrophySummary {
  const groups = Object.fromEntries(GROUPS.map((g) => [g, { total: 0, unlocked: 0 }])) as TrophySummary['groups'];
  let done = 0;
  let secrets = 0;
  for (const d of defs) {
    const got = unlocked.has(d.id);
    const g = groups[d.group];
    g.total++;
    if (got) {
      g.unlocked++;
      done++;
    } else if (d.hidden) {
      secrets++;
    }
  }
  return { total: defs.length, unlocked: done, secretsLeft: secrets, complete: done === defs.length, groups };
}

/** Name and description as the trophies window shows them: hidden entries mask both until unlocked. */
export function visibleText(def: AchievementDef, unlocked: boolean): { name: string; desc: string } {
  if (unlocked || !def.hidden) return { name: def.name, desc: def.desc };
  return { name: '?', desc: '' };
}

export interface AchievementProgress {
  value: number;
  target: number;
  /** 0..1, for the progress bar. */
  fraction: number;
}

/** Current value against the target, clamped for the bar. Values above the target read as complete. */
export function achievementProgress(def: AchievementDef, s: StatsRecord): AchievementProgress {
  const value = Math.max(0, def.value(s));
  const fraction = def.target <= 0 ? 1 : Math.min(1, value / def.target);
  return { value, target: def.target, fraction };
}

export interface CodexProgress {
  discoveries: number;
  traits: number;
  traitTotal: number;
  species: number;
  rosterTotal: number;
  traitFraction: number;
}

/** Codex totals for the Codex view and for achievements 56-59. */
export function codexProgress(s: StatsRecord): CodexProgress {
  const traits = setCount(s, 'discoveries', 'trait:');
  const species = setCount(s, 'discoveries', 'species:');
  return {
    discoveries: setCount(s, 'discoveries'),
    traits,
    traitTotal: TRAIT_TOTAL,
    species,
    rosterTotal: ROSTER_SPAWNABLE,
    traitFraction: Math.min(1, traits / TRAIT_TOTAL),
  };
}
