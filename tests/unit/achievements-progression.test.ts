import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_BY_ID, ACHIEVEMENTS } from '../../src/content/achievements.ts';
import { emptyStats, recordEvent } from '../../src/sim/stats.ts';
import {
  achievementProgress,
  codexProgress,
  countsCredited,
  grantAllowed,
  trophySummary,
  visibleText,
} from '../../src/sim/progression.ts';

function def(id: string) {
  const d = ACHIEVEMENT_BY_ID.get(id);
  if (!d) throw new Error(`missing ${id}`);
  return d;
}

describe('crediting and taint rules (14 sections 3, 6, 12)', () => {
  it('a tainted Realm credits no counters and grants no achievements', () => {
    expect(countsCredited({ origin: 'player', tainted: true }, false)).toBe(false);
    expect(grantAllowed('ach_cradle', { origin: 'player', tainted: true })).toBe(false);
  });

  it('auto events never count, even in a clean Realm', () => {
    expect(countsCredited({ origin: 'player', tainted: false }, true)).toBe(false);
    expect(countsCredited({ origin: 'player', tainted: false }, false)).toBe(true);
  });

  it('a tutorial Realm grants only the safe list', () => {
    const tut = { origin: 'tutorial' as const, tainted: false };
    expect(grantAllowed('ach_cradle', tut)).toBe(true);
    expect(grantAllowed('ach_quick_study', tut)).toBe(true);
    expect(grantAllowed('ach_busy_hands', tut)).toBe(false);
    expect(countsCredited(tut, false)).toBe(false);
  });

  it('an imported Realm grants like a player Realm', () => {
    expect(grantAllowed('ach_atlas', { origin: 'import', tainted: false })).toBe(true);
  });
});

describe('trophies summary (14 section 11)', () => {
  it('counts unlocked entries, secrets left and per-group totals', () => {
    const none = trophySummary(new Set());
    expect(none.total).toBe(63);
    expect(none.unlocked).toBe(0);
    expect(none.secretsLeft).toBe(18);
    expect(none.complete).toBe(false);
    const groupTotal = Object.values(none.groups).reduce((n, g) => n + g.total, 0);
    expect(groupTotal).toBe(63);
  });

  it('secrets left falls as hidden entries unlock and ignores unknown ids', () => {
    const got = trophySummary(new Set(['ach_long_watch', 'ach_night_owl', 'ach_cradle', 'not_real']));
    expect(got.unlocked).toBe(3);
    expect(got.secretsLeft).toBe(16);
    expect(got.groups.Realms.unlocked).toBe(1);
  });

  it('is complete when every id is unlocked', () => {
    const all = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(trophySummary(all).complete).toBe(true);
  });

  it('masks hidden names and descriptions until unlocked', () => {
    const secret = def('ach_plague_year');
    expect(visibleText(secret, false)).toEqual({ name: '?', desc: '' });
    expect(visibleText(secret, true).name).toBe(secret.name);
    expect(visibleText(def('ach_cradle'), false).name).toBe('Cradle');
  });
});

describe('progress bars', () => {
  it('reads the counter against its target and clamps the fraction', () => {
    const s = emptyStats();
    for (let k = 0; k < 25; k++) recordEvent(s, { kind: 'being.spawned', count: 1 });
    const p = achievementProgress(def('ach_cradle'), s);
    expect(p.value).toBe(25);
    expect(p.fraction).toBeCloseTo(0.25);
    for (let k = 0; k < 200; k++) recordEvent(s, { kind: 'being.spawned', count: 1 });
    expect(achievementProgress(def('ach_cradle'), s).fraction).toBe(1);
  });

  it('Read the Fine Print needs both windows', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'set.add', set: 'windowsOpened', id: 'help' });
    expect(achievementProgress(def('ach_fine_print'), s).value).toBe(1);
    recordEvent(s, { kind: 'set.add', set: 'windowsOpened', id: 'realm_rules' });
    expect(achievementProgress(def('ach_fine_print'), s).value).toBe(2);
  });
});

describe('codex (14 section 5)', () => {
  it('splits discoveries into traits and species by prefix', () => {
    const s = emptyStats();
    recordEvent(s, { kind: 'set.add', set: 'discoveries', id: 'trait:swift' });
    recordEvent(s, { kind: 'set.add', set: 'discoveries', id: 'trait:brave' });
    recordEvent(s, { kind: 'set.add', set: 'discoveries', id: 'species:mossback' });
    const c = codexProgress(s);
    expect(c.discoveries).toBe(3);
    expect(c.traits).toBe(2);
    expect(c.species).toBe(1);
    expect(c.traitFraction).toBeCloseTo(2 / 298);
  });

  it('Trait Collector and Naturalist read their own prefixes', () => {
    const s = emptyStats();
    for (let k = 0; k < 239; k++) recordEvent(s, { kind: 'set.add', set: 'discoveries', id: `trait:t${k}` });
    expect(ACHIEVEMENT_BY_ID.get('ach_trait_collector')?.value(s)).toBe(239);
    expect(ACHIEVEMENT_BY_ID.get('ach_trait_collector')?.value(s)).toBeGreaterThanOrEqual(ACHIEVEMENT_BY_ID.get('ach_trait_collector')?.target ?? 0);
    expect(ACHIEVEMENT_BY_ID.get('ach_naturalist')?.value(s)).toBe(0);
  });
});
