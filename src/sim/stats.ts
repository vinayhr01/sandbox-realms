/**
 * Lifetime counters (14 section 3) and achievement evaluation (14 sections 2 and 4). Pure data and
 * functions: the sim or UI calls recordEvent with a typed event, and evaluateAchievements returns
 * the ids that unlocked on this check. Unlocks are the caller's to store; the function never
 * returns an id already in `unlocked`.
 *
 * Gauges ("at once" conditions such as 1,000 burning tiles) are stored in `counters` with max
 * semantics: the value is the highest seen, so it only ever grows, like a counter.
 */
import { ACHIEVEMENTS } from '../content/achievements.ts';
import { POWER_BY_ID } from '../content/powers.ts';

export interface StatsRecord {
  /** Monotonic counters and max gauges, keyed by id (14 section 3). */
  counters: Record<string, number>;
  /** Sets of ids seen so far (stamps used, seeds used, discoveries as `kind:id`, windows opened). */
  sets: Record<string, string[]>;
}

export type StatsEvent =
  | { kind: 'realm.created'; auto?: boolean; custom?: boolean }
  | { kind: 'being.spawned'; count: number; auto?: boolean }
  | { kind: 'being.born'; count: number }
  | { kind: 'being.died'; cause: string; auto?: boolean }
  | { kind: 'power.used'; power: string; auto?: boolean }
  | { kind: 'calamity.fired'; calamity: string; auto?: boolean }
  | { kind: 'campaign.started'; auto?: boolean }
  | { kind: 'campaign.ended'; byTreaty: boolean }
  | { kind: 'pact.made' }
  | { kind: 'sim.year' }
  | { kind: 'age.reached'; age: string }
  | { kind: 'tile.burned'; count: number }
  | { kind: 'tile.painted.land'; count: number }
  | { kind: 'lightning.struck' }
  | { kind: 'island.formed'; size: number; surrounded: boolean }
  | { kind: 'milestone'; name: string }
  | { kind: 'counter.add'; name: string; by?: number; auto?: boolean }
  | { kind: 'gauge.max'; name: string; value: number }
  | { kind: 'set.add'; set: string; id: string; auto?: boolean };

export function emptyStats(): StatsRecord {
  return { counters: {}, sets: {} };
}

function bump(s: StatsRecord, key: string, by = 1): void {
  s.counters[key] = (s.counters[key] ?? 0) + by;
}

function raise(s: StatsRecord, key: string, value: number): void {
  if (value > (s.counters[key] ?? 0)) s.counters[key] = value;
}

/** Counts the entries of a set, optionally only those starting with a prefix (e.g. 'trait:'). */
export function setCount(s: StatsRecord, set: string, prefix = ''): number {
  const list = s.sets[set];
  if (!list) return 0;
  if (prefix === '') return list.length;
  let n = 0;
  for (const id of list) if (id.startsWith(prefix)) n++;
  return n;
}

/** Powers tab (12 catalogue) for the per-tab counters; unknown ids count under 'other'. */
function tabOf(power: string): string {
  return POWER_BY_ID.get(power)?.tab ?? 'other';
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
      if (event.custom) bump(s, 'realmsCustomized');
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
      bump(s, 'powerUsesTotal');
      bump(s, `powerUses.${tabOf(event.power)}`);
      return;
    case 'calamity.fired':
      bump(s, 'calamitiesCaused');
      if (event.calamity === 'tremor') bump(s, 'tremorsTriggered');
      if (event.calamity === 'whirlwind') bump(s, 'whirlwindsSpawned');
      if (event.calamity === 'skyfall') bump(s, 'skystonesDropped');
      return;
    case 'campaign.started':
      bump(s, 'campaignsStarted');
      return;
    case 'campaign.ended':
      if (event.byTreaty) bump(s, 'campaignsEndedByTreaty');
      return;
    case 'pact.made':
      bump(s, 'pactsFormed');
      return;
    case 'sim.year':
      bump(s, 'simYearsElapsed');
      return;
    case 'age.reached':
      recordEvent(s, { kind: 'set.add', set: 'agesReached', id: event.age });
      return;
    case 'tile.burned':
      bump(s, 'tilesBurned', event.count);
      return;
    case 'tile.painted.land':
      bump(s, 'tilesPaintedLand', event.count);
      return;
    case 'lightning.struck':
      bump(s, 'boltsStruck');
      return;
    case 'island.formed':
      if (event.surrounded) raise(s, 'islandMaxSize', event.size);
      return;
    case 'milestone':
      bump(s, `milestone.${event.name}`);
      return;
    case 'counter.add':
      bump(s, event.name, event.by ?? 1);
      return;
    case 'gauge.max':
      raise(s, event.name, event.value);
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
    if (a.value(s) >= a.target) fresh.push(a.id);
  }
  return fresh;
}
