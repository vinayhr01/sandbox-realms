/**
 * Lifetime counters (14 section 3) and achievement evaluation (14 section 2). Pure data and
 * functions: the sim or UI calls recordEvent with a typed event, and evaluateAchievements returns
 * the ids that unlocked on this check. Unlocks are the caller's to store; the function never
 * returns an id already in `unlocked`.
 */
import { ACHIEVEMENTS } from '../content/achievements.ts';

export interface StatsRecord {
  /** Monotonic counters, keyed by counter id (14 section 3). */
  counters: Record<string, number>;
  /** Sets of ids seen so far (stamps used, seed biomes used, discoveries). */
  sets: Record<string, string[]>;
}

export type StatsEvent =
  | { kind: 'realm.created'; auto?: boolean }
  | { kind: 'being.spawned'; count: number; auto?: boolean }
  | { kind: 'being.born'; count: number }
  | { kind: 'being.died'; cause: string }
  | { kind: 'power.used'; power: string; auto?: boolean }
  | { kind: 'calamity.fired'; calamity: string }
  | { kind: 'campaign.started' }
  | { kind: 'pact.made' }
  | { kind: 'sim.year' }
  | { kind: 'tile.burned'; count: number }
  | { kind: 'tile.painted.land'; count: number }
  | { kind: 'lightning.struck' }
  | { kind: 'set.add'; set: string; id: string };

export function emptyStats(): StatsRecord {
  return { counters: {}, sets: {} };
}

function bump(s: StatsRecord, key: string, by = 1): void {
  s.counters[key] = (s.counters[key] ?? 0) + by;
}

/**
 * Applies one event to the counters. Events flagged `auto` (tutorial scripts, bots) do not count
 * (14 section 3). Death causes each have their own counter `deathsByCause.<cause>`.
 */
export function recordEvent(s: StatsRecord, event: StatsEvent): void {
  if ('auto' in event && event.auto) return;
  switch (event.kind) {
    case 'realm.created':
      bump(s, 'realmsCreated');
      return;
    case 'being.spawned':
      bump(s, 'beingsSpawned', event.count);
      return;
    case 'being.born':
      bump(s, 'beingsBorn', event.count);
      return;
    case 'being.died':
      bump(s, `deathsByCause.${event.cause}`);
      bump(s, 'deaths');
      return;
    case 'power.used':
      bump(s, 'powersUsed');
      bump(s, `powerUses.${event.power}`);
      return;
    case 'calamity.fired':
      bump(s, 'calamitiesCaused');
      return;
    case 'campaign.started':
      bump(s, 'warsStarted');
      return;
    case 'pact.made':
      bump(s, 'peaceTreaties');
      return;
    case 'sim.year':
      bump(s, 'simYearsElapsed');
      return;
    case 'tile.burned':
      bump(s, 'tilesBurned', event.count);
      return;
    case 'tile.painted.land':
      bump(s, 'tilesPaintedLand', event.count);
      return;
    case 'lightning.struck':
      bump(s, 'lightningStrikes');
      return;
    case 'set.add': {
      const list = (s.sets[event.set] ??= []);
      if (!list.includes(event.id)) list.push(event.id);
      return;
    }
  }
}

/**
 * Returns the achievements whose predicate holds and that are not yet in `unlocked`, in catalogue
 * order. Pure: the caller stores them. Each id appears at most once.
 */
export function evaluateAchievements(s: StatsRecord, unlocked: ReadonlySet<string>): string[] {
  const fresh: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.id)) continue;
    if (a.check(s)) fresh.push(a.id);
  }
  return fresh;
}
