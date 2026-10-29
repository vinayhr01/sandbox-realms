import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/shared/protocol.ts';
import type { StatsRecord } from '../../src/sim/stats.ts';
import { chipsFor, discoveryToast, evaluate, newDiscovery, parseDiscovery, STARTER_CHIPS } from '../../src/ui/shell/discovery.ts';
import { CHIP_IDS } from '../../src/ui/shell/powerCatalog.ts';

/** A snapshot with only the fields the triggers read. */
function snap(over: { counters?: Record<string, number>; hamlets?: number; creeds?: number; species?: { id: string; count: number }[]; strains?: number } = {}): Snapshot {
  return {
    v: 1,
    tick: 0,
    truncated: false,
    population: { total: 0, folk: 0, wild: 0, species: (over.species ?? []).map((s) => ({ ...s, name: s.id, folk: false })) },
    counters: over.counters ?? {},
    sets: {},
    achievements: [],
    codex: { discoveries: 0, traits: 0, traitTotal: 0, species: 0, rosterTotal: 0 },
    dominions: [],
    dominionCount: 0,
    hamlets: [],
    hamletCount: over.hamlets ?? 0,
    culture: { customs: 0, creeds: over.creeds ?? 0, creedHolders: 0, dialects: 0, dialectGroups: 0, intriguesActive: 0, intriguesResolved: 0, families: 0 },
    detail: over.strains === undefined ? undefined : ({ counts: { customs: 0, creeds: 0, dialects: 0, families: 0, intrigues: 0, strains: over.strains } } as unknown as Snapshot['detail']),
  } as unknown as Snapshot;
}

const noStats: StatsRecord = { counters: {}, sets: {} };

describe('evaluate', () => {
  it('a hamlet adds first-town and reports it once', () => {
    const first = evaluate(newDiscovery(), snap({ hamlets: 1 }), noStats);
    expect(first.newly).toEqual(['first-town']);
    expect(first.state.found).toEqual(['first-town']);
    const again = evaluate(first.state, snap({ hamlets: 1 }), noStats);
    expect(again.newly).toEqual([]);
    expect(again.state).toBe(first.state);
  });

  it('three triggers met at once give three found entries', () => {
    const counters = { rainTiles: 3, calamitiesCaused: 1, campaignsStarted: 1 };
    const r = evaluate(newDiscovery(), snap(), { counters, sets: {} });
    expect(r.newly).toHaveLength(3);
    expect(r.state.found).toEqual(['first-weather', 'first-calamity', 'first-war']);
  });

  it('an extinction is met when a species that had beings now has none', () => {
    const seen = evaluate(newDiscovery(), snap({ species: [{ id: 'wolf', count: 4 }] }), noStats);
    expect(seen.newly).toEqual([]);
    expect(seen.state.seen).toEqual(['wolf']);
    const gone = evaluate(seen.state, snap({ species: [{ id: 'wolf', count: 0 }] }), noStats);
    expect(gone.newly).toEqual(['first-extinction']);
  });

  it('a strain counts only above the number of species', () => {
    expect(evaluate(newDiscovery(), snap({ species: [{ id: 'a', count: 1 }], strains: 1 }), noStats).newly).toEqual([]);
    expect(evaluate(newDiscovery(), snap({ species: [{ id: 'a', count: 1 }], strains: 2 }), noStats).newly).toEqual(['first-strain']);
  });
});

describe('discoveryToast', () => {
  it('one entry gives one New card: chip label and title', () => {
    expect(discoveryToast(['first-town'])).toEqual({ text: 'Peoples: First town', kind: 'new' });
  });

  it('several entries in one check give one summary line', () => {
    const t = discoveryToast(['first-weather', 'first-town', 'first-war']);
    expect(t?.text.startsWith('Discovered: ')).toBe(true);
    expect(t?.text).toContain('Weather');
    expect(t?.text).toContain('Peoples');
  });

  it('nothing met gives no card', () => {
    expect(discoveryToast([])).toBeNull();
  });
});

describe('chipsFor', () => {
  it('a new player has the starter chips', () => {
    expect(chipsFor([], false)).toEqual([...STARTER_CHIPS]);
  });

  it('a found entry brings its chip forward, in catalogue order', () => {
    expect(chipsFor(['first-town', 'first-weather'], false)).toEqual(['land', 'nature', 'creatures', 'weather', 'peoples']);
  });

  it('ui.allChips shows every chip', () => {
    expect(chipsFor([], true)).toEqual([...CHIP_IDS]);
    expect(chipsFor([], true)).toHaveLength(8);
  });
});

describe('parseDiscovery', () => {
  it('keeps the string lists and starts over from anything else', () => {
    // `seen` is the per-realm memory: an old save's lifetime species are dropped, not carried into a new world.
    expect(parseDiscovery({ found: ['first-town', 3], seen: ['wolf'] })).toEqual({ found: ['first-town'], seen: [] });
    expect(parseDiscovery('nonsense')).toEqual({ found: [], seen: [] });
  });
});
