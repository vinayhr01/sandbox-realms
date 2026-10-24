import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, ROSTER_SPAWNABLE, TRAIT_TOTAL } from '../../src/content/achievements.ts';
import type { Snapshot } from '../../src/shared/protocol.ts';
import {
  achievementHeadline,
  achievementViews,
  campaignTargetName,
  codexLines,
  counterLabel,
  cultureLines,
  dominionLine,
  figureRows,
  fraction,
  hamletLine,
  lifetimeRows,
  populationLines,
  topSpecies,
} from '../../src/ui/snapshot-model.ts';
import { SimView } from '../../src/ui/sim-view.ts';
import { WINDOW_CATALOG, windowTitle } from '../../src/ui/windowCatalog.ts';

/** A complete snapshot with empty lists; tests override the parts they read. */
function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    v: 1,
    tick: 0,
    truncated: false,
    population: { total: 0, folk: 0, wild: 0, species: [] },
    counters: {},
    sets: {},
    achievements: [],
    codex: { discoveries: 0, traits: 0, traitTotal: TRAIT_TOTAL, species: 0, rosterTotal: ROSTER_SPAWNABLE },
    dominions: [],
    dominionCount: 0,
    hamlets: [],
    hamletCount: 0,
    culture: { customs: 0, creeds: 0, creedHolders: 0, dialects: 0, dialectGroups: 0, intriguesActive: 0, intriguesResolved: 0, families: 0 },
    ...over,
  };
}

describe('counter labels', () => {
  it('reads plain counters as sentences', () => {
    expect(counterLabel('beingsSpawned')).toBe('Beings spawned');
    expect(counterLabel('simYearsElapsed')).toBe('Sim years elapsed');
  });

  it('reads keyed counters with their key', () => {
    expect(counterLabel('deathsByCause.eaten')).toBe('Deaths by cause: eaten');
    expect(counterLabel('powerUses.terrain')).toBe('Power uses: terrain');
    expect(counterLabel('milestone.first_realm')).toBe('Milestone: first realm');
  });

  it('lists every counter as a row with its value', () => {
    const rows = lifetimeRows(snapshot({ counters: { deaths: 3, 'deathsByCause.age': 2 } }));
    expect(rows).toEqual([
      { id: 'deaths', label: 'Deaths', value: 3 },
      { id: 'deathsByCause.age', label: 'Deaths by cause: age', value: 2 },
    ]);
  });
});

describe('figures', () => {
  it('reads the headline counters and shows zero for missing ones', () => {
    const rows = Object.fromEntries(figureRows(snapshot({ counters: { deaths: 4, beingsBorn: 9 } })));
    expect(rows['Deaths']).toBe('4');
    expect(rows['Beings born']).toBe('9');
    expect(rows['Powers used']).toBe('0');
  });
});

describe('achievements', () => {
  it('shows all 63 catalogue entries, locked, before any snapshot', () => {
    const views = achievementViews(null);
    expect(views.length).toBe(ACHIEVEMENTS.length);
    expect(views.every((v) => !v.unlocked && v.value === 0)).toBe(true);
  });

  it('masks hidden entries until they unlock', () => {
    const hidden = ACHIEVEMENTS.find((a) => a.hidden);
    expect(hidden).toBeDefined();
    const locked = achievementViews(null).find((v) => v.id === hidden?.id);
    expect(locked?.name).toBe('?');
    const got = achievementViews(snapshot({ achievements: [{ id: hidden?.id ?? '', value: hidden?.target ?? 0, target: hidden?.target ?? 0, unlocked: true }] })).find(
      (v) => v.id === hidden?.id,
    );
    expect(got?.name).toBe(hidden?.name);
    expect(got?.unlocked).toBe(true);
  });

  it('caps progress at 1 and reports unlocked state from the snapshot', () => {
    const first = ACHIEVEMENTS[0];
    expect(first).toBeDefined();
    const view = achievementViews(snapshot({ achievements: [{ id: first?.id ?? '', value: (first?.target ?? 1) * 3, target: first?.target ?? 1, unlocked: false }] }))[0];
    expect(view?.fraction).toBe(1);
    expect(view?.unlocked).toBe(false);
  });

  it('headline counts unlocked entries and secrets left', () => {
    const hiddenCount = ACHIEVEMENTS.filter((a) => a.hidden).length;
    const secrets = hiddenCount === 1 ? '1 secret left' : `${hiddenCount} secrets left`;
    expect(achievementHeadline(null)).toBe(`0 of ${ACHIEVEMENTS.length} unlocked, ${secrets}`);
    const one = ACHIEVEMENTS.find((a) => !a.hidden);
    const text = achievementHeadline(snapshot({ achievements: [{ id: one?.id ?? '', value: 1, target: 1, unlocked: true }] }));
    expect(text.startsWith(`1 of ${ACHIEVEMENTS.length} unlocked`)).toBe(true);
  });
});

describe('population and beings', () => {
  it('sorts species by count, ties by name, and limits the bars', () => {
    const species = [
      { id: 'a', name: 'Bee', count: 2, folk: false },
      { id: 'b', name: 'Ant', count: 5, folk: false },
      { id: 'c', name: 'Cat', count: 2, folk: false },
    ];
    const top = topSpecies(snapshot({ population: { total: 9, folk: 0, wild: 9, species } }), 2);
    expect(top.map((r) => r.name)).toEqual(['Ant', 'Bee']);
  });

  it('shows the population summary', () => {
    const rows = Object.fromEntries(populationLines(snapshot({ population: { total: 10, folk: 4, wild: 6, species: [] }, counters: { beingsBorn: 3, deaths: 1 } })));
    expect(rows['Alive now']).toBe('10');
    expect(rows['Folk']).toBe('4');
    expect(rows['Wild']).toBe('6');
    expect(rows['Born so far']).toBe('3');
    expect(rows['Deaths so far']).toBe('1');
  });

  it('turns counts into meter shares', () => {
    expect(fraction(3, 4)).toBe(0.75);
    expect(fraction(9, 4)).toBe(1);
    expect(fraction(1, 0)).toBe(0);
  });
});

describe('codex, culture, dominions and hamlets', () => {
  it('codex lines show totals against the catalogue', () => {
    const rows = codexLines(snapshot({ codex: { discoveries: 5, traits: 4, traitTotal: TRAIT_TOTAL, species: 1, rosterTotal: ROSTER_SPAWNABLE } }));
    expect(rows).toContainEqual(['Traits known', `4 of ${TRAIT_TOTAL}`]);
    expect(rows).toContainEqual(['Species known', `1 of ${ROSTER_SPAWNABLE}`]);
  });

  it('culture lines name each count', () => {
    const rows = cultureLines(snapshot({ culture: { customs: 2, creeds: 1, creedHolders: 3, dialects: 2, dialectGroups: 4, intriguesActive: 1, intriguesResolved: 0, families: 5 } }));
    expect(rows).toContainEqual(['Customs', '2']);
    expect(rows).toContainEqual(['Creeds', '1 (3 holder groups)']);
    expect(rows).toContainEqual(['Families', '5']);
  });

  it('dominion and hamlet lines carry their counts', () => {
    const d = {
      id: 2,
      name: 'Dominion 2',
      parcels: 4,
      strength: 9,
      neighbours: 1,
      peace: 0,
      tension: 1,
      war: 1,
      atWar: true,
      campaignTarget: 1,
    };
    expect(dominionLine(d)).toBe('4 parcels · army 9 · 1 neighbours · peace 0, tension 1, war 1');
    expect(hamletLine({ name: 'Hamlet 1', folk: 6, buildings: 3, parcels: 2 })).toBe('folk 6 · 3 buildings · 2 parcels');
    const snap = snapshot({ dominions: [d, { ...d, id: 1, name: 'Dominion 1' }] });
    expect(campaignTargetName(snap, d)).toBe('Dominion 1');
    expect(campaignTargetName(snap, { ...d, campaignTarget: -1 })).toBeNull();
  });
});

describe('sim view', () => {
  it('starts empty, stores the latest snapshot and tells its listeners', () => {
    const view = new SimView();
    expect(view.current).toBeNull();
    const seen: number[] = [];
    const stop = view.subscribe((s) => seen.push(s.tick));
    view.apply(snapshot({ tick: 40 }));
    view.apply(snapshot({ tick: 80 }));
    expect(view.current?.tick).toBe(80);
    expect(seen).toEqual([40, 80]);
    stop();
    view.apply(snapshot({ tick: 120 }));
    expect(seen).toEqual([40, 80]);
  });

  it('accepts a snapshot whose tick went back, as after a new realm', () => {
    const view = new SimView();
    view.apply(snapshot({ tick: 900 }));
    view.apply(snapshot({ tick: 0 }));
    expect(view.current?.tick).toBe(0);
  });
});

describe('live window catalogue', () => {
  it('every snapshot window has a title in the catalogue', () => {
    for (const id of ['win_population', 'win_beings', 'win_figures', 'win_stats_lifetime', 'list_codex', 'list_dominions', 'list_hamlets', 'win_culture', 'win_trophies']) {
      expect(WINDOW_CATALOG.some((w) => w.id === id), id).toBe(true);
      expect(windowTitle(id).length, id).toBeGreaterThan(0);
    }
  });
});
