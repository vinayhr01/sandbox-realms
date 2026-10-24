import { describe, expect, it } from 'vitest';
import { emptyStats, evaluateAchievements, recordEvent } from '../../src/sim/stats.ts';
import { ACHIEVEMENTS } from '../../src/content/achievements.ts';
import { AudioModel, CATEGORY_CAPS } from '../../src/audio/model.ts';

describe('achievements', () => {
  it('has at least 20 entries with unique ids', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it('unlocks once and never re-unlocks', () => {
    const s = emptyStats();
    for (let k = 0; k < 100; k++) recordEvent(s, { kind: 'being.spawned', count: 1 });
    const unlocked = new Set<string>();
    const first = evaluateAchievements(s, unlocked);
    expect(first).toContain('ach_cradle');
    for (const id of first) unlocked.add(id);
    expect(evaluateAchievements(s, unlocked)).not.toContain('ach_cradle');
    recordEvent(s, { kind: 'being.spawned', count: 1 });
    expect(evaluateAchievements(s, unlocked)).not.toContain('ach_cradle');
  });

  it('auto events do not count toward counters', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'being.spawned', count: 500, auto: true });
    expect(s.counters['beingsSpawned'] ?? 0).toBe(0);
  });
});

describe('death counters', () => {
  it('each death cause increments its own counter', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'being.died', cause: 'starved' });
    recordEvent(s, { kind: 'being.died', cause: 'starved' });
    recordEvent(s, { kind: 'being.died', cause: 'eaten' });
    expect(s.counters['deathsByCause.starved']).toBe(2);
    expect(s.counters['deathsByCause.eaten']).toBe(1);
    expect(s.counters['deathsByCause.age']).toBeUndefined();
    expect(s.counters['deaths']).toBe(3);
  });

  it('sets keep each id once', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'set.add', set: 'stamps', id: 'a' });
    recordEvent(s, { kind: 'set.add', set: 'stamps', id: 'a' });
    expect(s.sets['stamps']).toEqual(['a']);
  });
});

describe('audio model', () => {
  it('refuses a voice that is less important than every playing voice', () => {
    const m = new AudioModel();
    const cap = CATEGORY_CAPS['ui'] ?? 6;
    for (let k = 0; k < cap; k++) m.play('ui', 1, k);
    expect(m.play('ui', 4, 50)).toBeNull();
  });

  it('volume clamps to 0..1 and NaN becomes 0', () => {
    const m = new AudioModel();
    m.setVolume('sfx', 3);
    expect(m.volume('sfx')).toBe(1);
    m.setVolume('sfx', -2);
    expect(m.volume('sfx')).toBe(0);
    m.setVolume('sfx', Number.NaN);
    expect(m.volume('sfx')).toBe(0);
  });
});
