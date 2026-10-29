/**
 * Progressive discovery entries (UX redesign, spec E). Each entry is met when a lifetime counter or a snapshot figure
 * says the simulation has done the thing. Triggers only read data that already exists: no sim change, no new events.
 * `chip` is the power chip the entry brings forward (a shell id, see src/ui/shell/powerCatalog.ts).
 */
import type { Snapshot } from '../shared/protocol.ts';
import type { StatsRecord } from '../sim/stats.ts';

export interface DiscoveryEntry {
  id: string;
  /** The chip this entry brings forward, if any. */
  chip?: string;
  title: string;
  /** One plain line on what the simulation did. */
  text: string;
  /**
   * True when the entry is met. `seenSpecies` holds the species ids that had living beings at an earlier evaluation,
   * so an extinction can be told from a species that never existed.
   */
  met(s: Snapshot, stats: StatsRecord, seenSpecies: ReadonlySet<string>): boolean;
}

/** A lifetime counter, or 0 when the counter has not moved yet. */
const count = (stats: StatsRecord, key: string): number => stats.counters[key] ?? 0;

export const DISCOVERIES: readonly DiscoveryEntry[] = [
  {
    id: 'first-weather',
    chip: 'weather',
    title: 'First weather',
    text: 'Rain, lightning or a whirlwind has crossed the realm.',
    met: (_s, stats) => count(stats, 'rainTiles') > 0 || count(stats, 'boltsStruck') > 0 || count(stats, 'whirlwindsSpawned') > 0,
  },
  {
    id: 'first-town',
    chip: 'peoples',
    title: 'First town',
    text: 'A hamlet has grown up on the land.',
    met: (s) => s.hamletCount > 0,
  },
  {
    id: 'first-calamity',
    chip: 'disasters',
    title: 'First calamity',
    text: 'A disaster has struck the realm.',
    // A calamity counter, or two sim years in: old saves with years behind them meet it at once.
    met: (_s, stats) => count(stats, 'calamitiesCaused') > 0 || count(stats, 'simYearsElapsed') >= 2,
  },
  {
    id: 'first-creed',
    chip: 'blessings',
    title: 'First creed',
    text: 'A people has taken up a creed.',
    met: (s) => s.culture.creeds > 0,
  },
  {
    id: 'first-war',
    chip: 'inspect',
    title: 'First war',
    text: 'Two dominions have gone to war.',
    met: (_s, stats) => count(stats, 'campaignsStarted') > 0,
  },
  {
    id: 'first-strain',
    title: 'First strain',
    text: 'A new strain of beings has appeared beside its species.',
    met: (s) => (s.detail?.counts.strains ?? 0) > s.population.species.length,
  },
  {
    id: 'first-extinction',
    title: 'First extinction',
    text: 'A species has died out.',
    met: (s, _stats, seenSpecies) => {
      const living = new Map(s.population.species.map((row) => [row.id, row.count]));
      for (const id of seenSpecies) if ((living.get(id) ?? 0) === 0) return true;
      return false;
    },
  },
];
