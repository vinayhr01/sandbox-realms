import { describe, expect, it } from 'vitest';
import type { BeingRow, DominionRow, Snapshot, StructureRow } from '../../src/shared/protocol.ts';
import { RealmHistory, realmHistory, HISTORY_CAP } from '../../src/ui/realm-history.ts';
import {
  BANNER_COLOURS,
  BANNER_ICONS,
  MISSING,
  annalRows,
  armyFacts,
  armyLine,
  beingFacts,
  capLog,
  compareSeries,
  counterGroup,
  runConsoleCommand,
  seriesMax,
  stageLabel,
  structureFacts,
  type ConsoleContext,
} from '../../src/ui/spec-model.ts';
import { favouriteBeing, favouriteBeingList, resetSessionMemory, setBanner, setFavouriteBeing, setTraitRain, syncFavouriteBeings, traitRainOf, bannerOf } from '../../src/ui/session-memory.ts';

function being(over: Partial<BeingRow> & { id: number }): BeingRow {
  return {
    species: 'Wolf',
    folk: false,
    female: false,
    baby: false,
    ageYears: 4,
    vitality: 80,
    maxVitality: 100,
    strain: '',
    children: 1,
    ...over,
  };
}

function dominion(over: Partial<DominionRow> & { id: number }): DominionRow {
  return {
    name: `Dominion ${over.id}`,
    parcels: 4,
    strength: 10,
    neighbours: 1,
    peace: 1,
    tension: 0,
    war: 0,
    atWar: false,
    campaignTarget: -1,
    ...over,
  };
}

/** A snapshot with the given dominions and tick; other fields are empty. */
function snap(tick: number, dominions: DominionRow[] = [], counters: Record<string, number> = {}): Snapshot {
  return {
    v: 1,
    tick,
    truncated: false,
    population: { total: 0, folk: 0, wild: 0, species: [] },
    counters,
    sets: {},
    achievements: [],
    codex: { discoveries: 0, traits: 0, traitTotal: 0, species: 0, rosterTotal: 0 },
    dominions,
    dominionCount: dominions.length,
    hamlets: [],
    hamletCount: 0,
    culture: { customs: 0, creeds: 0, creedHolders: 0, dialects: 0, dialectGroups: 0, intriguesActive: 0, intriguesResolved: 0, families: 0 },
  };
}

const ctx = (over: Partial<ConsoleContext> = {}): ConsoleContext => ({ tick: 42, version: '1.0.0', snap: null, ...over });

describe('being and structure facts', () => {
  it('lists the stored fields of a being and the stage from the baby flag', () => {
    const facts = beingFacts(being({ id: 1, baby: true, ageYears: 1, strain: 'Pale line', children: 3, folk: true, female: true }));
    expect(Object.fromEntries(facts)).toEqual({
      Species: 'Wolf',
      Kind: 'Folk',
      Sex: 'Female',
      Stage: 'Child',
      Age: '1 year',
      Vitality: '80 of 100',
      Strain: 'Pale line',
      Children: '3',
    });
    expect(stageLabel(being({ id: 2 }))).toBe('Adult');
    expect(beingFacts(being({ id: 2, ageYears: 5 }))).toContainEqual(['Age', '5 years']);
    expect(beingFacts(being({ id: 2 }))).toContainEqual(['Strain', 'None']);
  });

  it('gives a structure its building, hamlet, position and footprint from the catalogue', () => {
    const s = snap(1);
    s.hamlets = [{ name: 'Hamlet 1', folk: 0, buildings: 1, parcels: 1 }];
    const row: StructureRow = { id: 3 * 1024 + 5, kind: 'house', name: 'House', hamlet: 0, x: 5, y: 3 };
    expect(Object.fromEntries(structureFacts(row, s))).toEqual({ Building: 'House', Hamlet: 'Hamlet 1', Position: '5, 3', Footprint: '2 x 2 tiles' });
  });

  it('says the sim does not store the rest of the spec fields', () => {
    expect(MISSING.structures).toContain('not stored');
    expect(MISSING.items).toContain('Wear, durability');
  });
});

describe('armies', () => {
  it('describes strength and the campaign of a dominion', () => {
    expect(armyLine(dominion({ id: 2, strength: 7 }), null)).toBe('Strength 7 · No campaign');
    expect(armyLine(dominion({ id: 2, strength: 7, campaignTarget: 3 }), 'Dominion 3')).toBe('Strength 7 · Campaigning against Dominion 3');
    expect(armyLine(dominion({ id: 2, campaignTarget: 9 }), null)).toBe('Strength 10 · Campaigning against Dominion 9');
  });

  it('gives army facts from the dominion row', () => {
    const d = dominion({ id: 2, name: 'Dominion 2', strength: 7, parcels: 5, campaignTarget: 3, peace: 1, tension: 1, war: 2 });
    const facts = Object.fromEntries(armyFacts(d, 'Dominion 3', snap(1, [d])));
    expect(facts['Campaign']).toBe('Against Dominion 3');
    expect(facts['Relations']).toBe('1 peace, 1 tension, 2 war');
    expect(facts['Dominions in the realm']).toBe('1');
  });
});

describe('annals (counter changes between snapshots)', () => {
  it('lists increases newest first and skips counters that did not change', () => {
    const h = new RealmHistory();
    h.record(snap(20, [], { deaths: 1, campaignsStarted: 0 }));
    h.record(snap(40, [], { deaths: 3, campaignsStarted: 0, beingsBorn: 2 }));
    h.record(snap(60, [], { deaths: 3, campaignsStarted: 1, beingsBorn: 2 }));
    const rows = annalRows(h.all);
    expect(rows.map((r) => `${r.tick}:${r.key}:+${r.delta}`)).toEqual(['60:campaignsStarted:+1', '40:beingsBorn:+2', '40:deaths:+2']);
    expect(rows[0]?.group).toBe('Realm');
    expect(rows[1]?.group).toBe('Beings');
  });

  it('groups counters by their words, and falls back to Other', () => {
    expect(counterGroup('beingsBorn')).toBe('Beings');
    expect(counterGroup('campaignsStarted')).toBe('Realm');
    expect(counterGroup('tilesBurned')).toBe('Land');
    expect(counterGroup('simYearsElapsed')).toBe('Other');
  });

  it('caps the rows', () => {
    const h = new RealmHistory();
    h.record(snap(1, [], { deaths: 0 }));
    h.record(snap(2, [], { deaths: 5 }));
    expect(annalRows(h.all, 0)).toEqual([]);
    expect(annalRows(h.all, 1)).toHaveLength(1);
  });
});

describe('session history', () => {
  it('keeps at most HISTORY_CAP samples and skips a repeated tick', () => {
    const h = new RealmHistory();
    for (let t = 0; t < HISTORY_CAP + 10; t++) h.record(snap(t * 2));
    h.record(snap((HISTORY_CAP + 9) * 2));
    expect(h.all).toHaveLength(HISTORY_CAP);
    expect(h.all[h.all.length - 1]?.tick).toBe((HISTORY_CAP + 9) * 2);
  });

  it('starts again when the tick goes back (a new realm)', () => {
    const h = new RealmHistory();
    h.record(snap(100));
    h.record(snap(120));
    h.record(snap(0));
    expect(h.all.map((s) => s.tick)).toEqual([0]);
  });

  it('keeps the dominion strengths of each sample', () => {
    const h = new RealmHistory();
    h.record(snap(20, [dominion({ id: 1, strength: 5 }), dominion({ id: 2, strength: 9 })]));
    h.record(snap(40, [dominion({ id: 1, strength: 7 })]));
    const series = compareSeries(h.all, [1, 2]);
    expect(series[0]?.points).toEqual([
      { tick: 20, value: 5 },
      { tick: 40, value: 7 },
    ]);
    expect(series[1]?.points).toEqual([{ tick: 20, value: 9 }]);
    expect(seriesMax(series)).toBe(9);
    expect(seriesMax([])).toBe(1);
  });

  it('exposes a shared instance for the windows', () => {
    expect(realmHistory.all).toBeDefined();
  });
});

describe('developer console', () => {
  it('answers read commands from the snapshot', () => {
    const s = snap(42, [dominion({ id: 1, strength: 5, parcels: 2 })]);
    s.population = { total: 3, folk: 1, wild: 2, species: [{ id: 'wolf', name: 'Wolf', count: 3, folk: false }] };
    const c = ctx({ snap: s });
    expect(runConsoleCommand('tick', c)).toEqual(['Tick 42']);
    expect(runConsoleCommand('version', c)).toEqual(['Sandbox Realms 1.0.0']);
    expect(runConsoleCommand('population', c)).toEqual(['Wolf: 3']);
    expect(runConsoleCommand('dominions', c)).toEqual(['Dominion 1: strength 5, 2 parcels']);
    expect(runConsoleCommand('counts', c)[0]).toBe('Beings 3, folk 1, wild 2');
    expect(runConsoleCommand('help', c)).toContain('help: list the commands');
  });

  it('refuses write commands and unknown ones without changing anything', () => {
    const c = ctx({ snap: snap(1) });
    expect(runConsoleCommand('spawn wolf 3', c)[0]).toContain('not built');
    expect(runConsoleCommand('frobnicate', c)).toEqual(['Unknown command: frobnicate. Type help.']);
    expect(runConsoleCommand('   ', c)).toEqual([]);
  });

  it('says when no snapshot has arrived yet', () => {
    expect(runConsoleCommand('population', ctx())).toEqual(['The realm has not sent a snapshot yet.']);
    expect(runConsoleCommand('tick', ctx())).toEqual(['Tick 42']);
  });

  it('caps the log to the newest lines', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `l${i}`);
    expect(capLog(lines, 2)).toEqual(['l3', 'l4']);
    expect(capLog(lines, 10)).toEqual(lines);
  });
});

describe('banner palette', () => {
  it('has distinct colours and icons', () => {
    expect(new Set(BANNER_COLOURS.map((c) => c.hex)).size).toBe(BANNER_COLOURS.length);
    expect(new Set(BANNER_COLOURS.map((c) => c.name)).size).toBe(BANNER_COLOURS.length);
    expect(new Set(BANNER_ICONS).size).toBe(BANNER_ICONS.length);
  });
});

describe('session memory', () => {
  it('keeps favourites with their last row, and refreshes rows the snapshot still lists', () => {
    resetSessionMemory();
    const b = being({ id: 7 });
    setFavouriteBeing(b, 10, true);
    expect(favouriteBeing(7)?.seenTick).toBe(10);
    const s = snap(30);
    s.detail = {
      counts: { customs: 0, creeds: 0, dialects: 0, families: 0, intrigues: 0, strains: 0 },
      customs: [],
      creeds: [],
      dialects: [],
      families: [],
      intrigues: [],
      strains: [],
      notable: { beingCount: 1, beings: [being({ id: 7, ageYears: 9 })], structureCount: 0, structures: [] },
    };
    syncFavouriteBeings(s);
    expect(favouriteBeing(7)?.row.ageYears).toBe(9);
    expect(favouriteBeing(7)?.seenTick).toBe(30);
    expect(favouriteBeingList()).toHaveLength(1);
    setFavouriteBeing(b, 40, false);
    expect(favouriteBeingList()).toHaveLength(0);
    resetSessionMemory();
  });

  it('keeps banners and trait rain per page session', () => {
    resetSessionMemory();
    expect(bannerOf('dominion', 1)).toBeUndefined();
    setBanner('dominion', 1, { colour: '#000000', icon: 'Sun' });
    expect(bannerOf('dominion', 1)).toEqual({ colour: '#000000', icon: 'Sun' });
    setTraitRain('B', ['vigour', 'vigour', 'keen']);
    expect(traitRainOf('B')).toEqual(['vigour', 'keen']);
    expect(traitRainOf('A')).toEqual([]);
    resetSessionMemory();
  });
});
