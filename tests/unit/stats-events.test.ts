import { describe, expect, it } from 'vitest';
import { emptyStats, evaluateAchievements, recordEvent, setCount, type StatsEvent } from '../../src/sim/stats.ts';
import { POWERS } from '../../src/content/powers.ts';

describe('typed stats events (14 section 3)', () => {
  it('counts births, spawns, deaths by cause and the total', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'being.born', count: 3 });
    recordEvent(s, { kind: 'being.spawned', count: 2 });
    recordEvent(s, { kind: 'being.died', cause: 'age' });
    recordEvent(s, { kind: 'being.died', cause: 'eaten' });
    expect(s.counters).toMatchObject({ beingsBorn: 3, beingsSpawned: 2, deaths: 2, 'deathsByCause.age': 1, 'deathsByCause.eaten': 1 });
  });

  it('buckets power uses by the tab of the power', () => {
    const s = emptyStats();
    const power = POWERS[0];
    if (!power) throw new Error('no powers');
    recordEvent(s, { kind: 'power.used', power: power.id });
    recordEvent(s, { kind: 'power.used', power: 'no_such_power' });
    expect(s.counters['powerUsesTotal']).toBe(2);
    expect(s.counters[`powerUses.${power.tab}`]).toBeGreaterThanOrEqual(1);
    expect(s.counters['powerUses.other']).toBe(1);
  });

  it('maps calamity ids to their named counters and counts every calamity', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'calamity.fired', calamity: 'tremor' });
    recordEvent(s, { kind: 'calamity.fired', calamity: 'skyfall' });
    recordEvent(s, { kind: 'calamity.fired', calamity: 'whirlwind' });
    recordEvent(s, { kind: 'calamity.fired', calamity: 'skyfall' });
    expect(s.counters).toMatchObject({ calamitiesCaused: 4, tremorsTriggered: 1, skystonesDropped: 2, whirlwindsSpawned: 1 });
  });

  it('keeps a gauge at its highest value, never lower', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'gauge.max', name: 'burningTilesMax', value: 40 });
    recordEvent(s, { kind: 'gauge.max', name: 'burningTilesMax', value: 10 });
    expect(s.counters['burningTilesMax']).toBe(40);
  });

  it('records a surrounded island only at its size, and ignores unsurrounded ones', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'island.formed', size: 800, surrounded: false });
    expect(s.counters['islandMaxSize']).toBeUndefined();
    recordEvent(s, { kind: 'island.formed', size: 520, surrounded: true });
    expect(s.counters['islandMaxSize']).toBe(520);
  });

  it('set adds keep each id once, and milestones and generic counters add up', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'set.add', set: 'stamps', id: 'a' });
    recordEvent(s, { kind: 'set.add', set: 'stamps', id: 'a' });
    recordEvent(s, { kind: 'set.add', set: 'discoveries', id: 'trait:x' });
    recordEvent(s, { kind: 'milestone', name: 'offering' });
    recordEvent(s, { kind: 'counter.add', name: 'rainTiles', by: 5 });
    expect(s.sets['stamps']).toEqual(['a']);
    expect(setCount(s, 'discoveries', 'trait:')).toBe(1);
    expect(s.counters).toMatchObject({ 'milestone.offering': 1, rainTiles: 5 });
  });

  it('campaigns and treaties: only treaties count as ended by treaty', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'campaign.started' });
    recordEvent(s, { kind: 'campaign.ended', byTreaty: false });
    recordEvent(s, { kind: 'campaign.ended', byTreaty: true });
    recordEvent(s, { kind: 'pact.made' });
    expect(s.counters).toMatchObject({ campaignsStarted: 1, campaignsEndedByTreaty: 1, pactsFormed: 1 });
  });

  it('ages reached are recorded once each as a set', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'age.reached', age: 'dawn' });
    recordEvent(s, { kind: 'age.reached', age: 'dawn' });
    recordEvent(s, { kind: 'age.reached', age: 'scorch' });
    expect(s.sets['agesReached']).toEqual(['dawn', 'scorch']);
  });

  it('ignores every auto event, whatever its kind', () => {
    const s = emptyStats();
    const autos: StatsEvent[] = [
      { kind: 'realm.created', auto: true, custom: true },
      { kind: 'being.spawned', count: 5, auto: true },
      { kind: 'being.died', cause: 'age', auto: true },
      { kind: 'power.used', power: 'x', auto: true },
      { kind: 'calamity.fired', calamity: 'tremor', auto: true },
      { kind: 'campaign.started', auto: true },
      { kind: 'counter.add', name: 'rainTiles', auto: true },
      { kind: 'set.add', set: 'stamps', id: 'z', auto: true },
    ];
    for (const e of autos) recordEvent(s, e);
    expect(s).toEqual(emptyStats());
  });

  it('a Realm created with custom settings is only counted when it is not the first', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'realm.created', custom: true });
    expect(s.counters['realmsCustomized']).toBe(1);
    const first = evaluateAchievements(s, new Set());
    expect(first).not.toContain('ach_made_to_measure');
    recordEvent(s, { kind: 'realm.created' });
    expect(evaluateAchievements(s, new Set())).toContain('ach_made_to_measure');
  });
});
