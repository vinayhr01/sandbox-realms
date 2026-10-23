import { describe, expect, it } from 'vitest';
import {
  AudioModel,
  CATEGORY_CAPS,
  DEFAULT_CATEGORY_CAP,
  DEFAULT_VOLUMES,
  GLOBAL_CAP,
  type Priority,
} from '../../src/audio/model.ts';

/** Fills a category up to its cap with voices of one priority, returning their ids in start order. */
function fill(m: AudioModel, category: string, priority: Priority, startAt = 0): number[] {
  const cap = CATEGORY_CAPS[category] ?? DEFAULT_CATEGORY_CAP;
  const ids: number[] = [];
  for (let k = 0; k < cap; k++) {
    const r = m.play(category, priority, startAt + k);
    if (!r) throw new Error(`fill refused at ${k}`);
    ids.push(r.id);
  }
  return ids;
}

/**
 * Fills the mix to the global cap: combat 8, voices 6, work 6 and ambience 4, all priority 3,
 * which is 24 voices. Ids are returned in start order per call sequence.
 */
function fillGlobalWithPriority3(m: AudioModel): void {
  fill(m, 'combat', 3, 0);
  fill(m, 'voices', 3, 10);
  fill(m, 'work', 3, 20);
  for (let k = 0; k < 4; k++) m.play('ambience', 3, 30 + k);
  expect(m.voices.length).toBe(GLOBAL_CAP);
}

describe('bus volume and mute', () => {
  it('starts at the default volumes', () => {
    const m = new AudioModel();
    for (const bus of ['master', 'music', 'sfx', 'ui'] as const) {
      expect(m.volume(bus)).toBe(DEFAULT_VOLUMES[bus]);
    }
  });

  it('clamps volume into 0..1', () => {
    const m = new AudioModel();
    m.setVolume('music', 1.5);
    expect(m.volume('music')).toBe(1);
    m.setVolume('music', -0.3);
    expect(m.volume('music')).toBe(0);
    m.setVolume('music', 0.42);
    expect(m.volume('music')).toBe(0.42);
  });

  it('treats NaN as 0 and clamps infinities', () => {
    const m = new AudioModel();
    m.setVolume('ui', Number.NaN);
    expect(m.volume('ui')).toBe(0);
    m.setVolume('ui', Number.POSITIVE_INFINITY);
    expect(m.volume('ui')).toBe(1);
    m.setVolume('ui', Number.NEGATIVE_INFINITY);
    expect(m.volume('ui')).toBe(0);
  });

  it('effective gain is master times the bus volume', () => {
    const m = new AudioModel();
    m.setVolume('master', 0.5);
    m.setVolume('sfx', 0.5);
    expect(m.effectiveGain('sfx')).toBeCloseTo(0.25);
    expect(m.effectiveGain('master')).toBeCloseTo(0.5);
  });

  it('muting a bus silences it without changing its saved volume', () => {
    const m = new AudioModel();
    m.setVolume('sfx', 0.6);
    m.setMuted('sfx', true);
    expect(m.isMuted('sfx')).toBe(true);
    expect(m.effectiveGain('sfx')).toBe(0);
    expect(m.volume('sfx')).toBe(0.6);
    expect(m.effectiveGain('music')).toBeGreaterThan(0);
  });

  it('unmuting restores the saved volume', () => {
    const m = new AudioModel();
    m.setVolume('music', 0.7);
    m.setMuted('music', true);
    m.setMuted('music', false);
    expect(m.isMuted('music')).toBe(false);
    expect(m.effectiveGain('music')).toBeCloseTo(0.7);
  });

  it('muting master silences every bus', () => {
    const m = new AudioModel();
    m.setMuted('master', true);
    expect(m.effectiveGain('master')).toBe(0);
    expect(m.effectiveGain('music')).toBe(0);
    expect(m.effectiveGain('sfx')).toBe(0);
    expect(m.effectiveGain('ui')).toBe(0);
    expect(m.volume('master')).toBe(1);
  });

  it('setting a volume does not clear a mute', () => {
    const m = new AudioModel();
    m.setMuted('ui', true);
    m.setVolume('ui', 0.3);
    expect(m.effectiveGain('ui')).toBe(0);
  });
});

describe('category voice cap', () => {
  it('refuses a voice of the same priority once the category is full', () => {
    const m = new AudioModel();
    fill(m, 'ui', 2);
    const before = m.voices.map((v) => v.id);
    expect(m.play('ui', 2, 100)).toBeNull();
    expect(m.voices.map((v) => v.id)).toEqual(before);
  });

  it('refuses a less important voice and changes nothing', () => {
    const m = new AudioModel();
    fill(m, 'stingers', 1);
    const before = m.voices.map((v) => ({ ...v }));
    expect(m.play('stingers', 3, 99)).toBeNull();
    expect(m.voices.map((v) => ({ ...v }))).toEqual(before);
  });

  it('drops the lowest-priority voice for a strictly more important one', () => {
    const m = new AudioModel();
    const ids = fill(m, 'voices', 4);
    const result = m.play('voices', 1, 100);
    expect(result).not.toBeNull();
    expect(result?.stolen).toBe(ids[0]);
    expect(m.voices.length).toBe(CATEGORY_CAPS['voices']);
    expect(m.voices.some((v) => v.id === ids[0])).toBe(false);
    expect(m.voices.some((v) => v.id === result?.id && v.priority === 1)).toBe(true);
  });

  it('among equally weak voices the oldest by start time is dropped', () => {
    const m = new AudioModel();
    const cap = CATEGORY_CAPS['combat'] ?? DEFAULT_CATEGORY_CAP;
    const ids: number[] = [];
    // The first voice has the latest start time, so the oldest by startedAt is the second one.
    ids.push(m.play('combat', 3, 50)?.id ?? -1);
    for (let k = 1; k < cap; k++) ids.push(m.play('combat', 3, k)?.id ?? -1);
    const result = m.play('combat', 0, 200);
    expect(result?.stolen).toBe(ids[1]);
  });

  it('a voice that does not need to steal reports stolen as null', () => {
    const m = new AudioModel();
    const result = m.play('ui', 4, 0);
    expect(result).not.toBeNull();
    expect(result?.stolen).toBeNull();
  });

  it('only counts voices of the same category', () => {
    const m = new AudioModel();
    fill(m, 'ui', 4);
    expect(m.play('combat', 4, 0)).not.toBeNull();
  });

  it('unknown categories use the default cap', () => {
    const m = new AudioModel();
    for (let k = 0; k < DEFAULT_CATEGORY_CAP; k++) expect(m.play('mystery', 2, k)).not.toBeNull();
    expect(m.play('mystery', 2, 99)).toBeNull();
  });

  it('prototype names such as constructor do not borrow Object.prototype values', () => {
    const m = new AudioModel();
    for (let k = 0; k < DEFAULT_CATEGORY_CAP; k++) expect(m.play('constructor', 2, k)).not.toBeNull();
    expect(m.play('constructor', 2, 99)).toBeNull();
  });

  it('a voice that finishes frees its slot', () => {
    const m = new AudioModel();
    const ids = fill(m, 'work', 2);
    m.release(ids[0] ?? -1);
    const result = m.play('work', 2, 100);
    expect(result).not.toBeNull();
    expect(result?.stolen).toBeNull();
  });

  it('releasing an unknown id is ignored', () => {
    const m = new AudioModel();
    fill(m, 'work', 2);
    const count = m.voices.length;
    m.release(123456);
    expect(m.voices.length).toBe(count);
  });

  it('rejects a priority outside 0..4 without stealing', () => {
    const m = new AudioModel();
    fill(m, 'calamity', 4);
    const before = m.voices.length;
    expect(m.play('calamity', Number.NaN as Priority, 0)).toBeNull();
    expect(m.play('calamity', 7 as Priority, 0)).toBeNull();
    expect(m.play('calamity', -1 as Priority, 0)).toBeNull();
    expect(m.voices.length).toBe(before);
  });
});

describe('global voice cap', () => {
  it('refuses an equal-priority voice when the whole mix is full', () => {
    const m = new AudioModel();
    fillGlobalWithPriority3(m);
    expect(m.play('calamity', 3, 500)).toBeNull();
    expect(m.voices.length).toBe(GLOBAL_CAP);
  });

  it('steals the oldest of the weakest voices from any category when the global cap is full', () => {
    const m = new AudioModel();
    fillGlobalWithPriority3(m);
    const oldest = m.voices[0];
    const result = m.play('calamity', 1, 900);
    expect(result).not.toBeNull();
    expect(result?.stolen).toBe(oldest?.id);
    expect(m.voices.length).toBe(GLOBAL_CAP);
  });

  it('the global victim is the weakest by priority, even if it is the youngest', () => {
    const m = new AudioModel();
    // 23 priority-3 voices, plus one priority-4 voice started last.
    fill(m, 'combat', 3, 0);
    fill(m, 'voices', 3, 10);
    for (let k = 0; k < 5; k++) m.play('work', 3, 20 + k);
    for (let k = 0; k < 4; k++) m.play('ambience', 3, 30 + k);
    const trivial = m.play('work', 4, 999);
    expect(trivial).not.toBeNull();
    expect(m.voices.length).toBe(GLOBAL_CAP);
    const result = m.play('calamity', 2, 1000);
    expect(result?.stolen).toBe(trivial?.id);
  });

  it('a refused play while the global cap is full changes nothing', () => {
    const m = new AudioModel();
    fillGlobalWithPriority3(m);
    const before = m.voices.map((v) => ({ ...v }));
    expect(m.play('ui', 3, 1000)).toBeNull();
    expect(m.voices.map((v) => ({ ...v }))).toEqual(before);
  });

  it('when the category and the global cap are both full, exactly one voice is dropped', () => {
    const m = new AudioModel();
    // ui is full of priority-4 voices (6), and the rest of the mix fills the global cap at priority 3.
    fill(m, 'ui', 4, 0);
    fill(m, 'combat', 3, 10);
    fill(m, 'voices', 3, 20);
    for (let k = 0; k < 4; k++) m.play('ambience', 3, 30 + k);
    expect(m.voices.length).toBe(GLOBAL_CAP);
    const result = m.play('ui', 1, 2000);
    expect(result).not.toBeNull();
    expect(result?.stolen).not.toBeNull();
    // One voice removed, one added: the total stays at the cap and the other categories are untouched.
    expect(m.voices.length).toBe(GLOBAL_CAP);
    expect(m.voices.filter((v) => v.category === 'ui').length).toBe(CATEGORY_CAPS['ui']);
    expect(m.voices.filter((v) => v.category === 'combat').length).toBe(CATEGORY_CAPS['combat']);
  });

  it('a full category refuses a voice that beats only voices outside the category', () => {
    const m = new AudioModel();
    // ui full of priority-1 voices, global full with priority-4 voices elsewhere.
    fill(m, 'ui', 1, 0);
    fill(m, 'combat', 4, 10);
    fill(m, 'voices', 4, 20);
    for (let k = 0; k < 4; k++) m.play('ambience', 4, 30 + k);
    expect(m.voices.length).toBe(GLOBAL_CAP);
    const before = m.voices.map((v) => ({ ...v }));
    expect(m.play('ui', 2, 100)).toBeNull();
    expect(m.voices.map((v) => ({ ...v }))).toEqual(before);
  });

  it('a category at its cap refuses when its own voices are not weaker, even with global room', () => {
    const m = new AudioModel();
    fill(m, 'ui', 1);
    expect(m.voices.length).toBeLessThan(GLOBAL_CAP);
    expect(m.play('ui', 1, 50)).toBeNull();
    expect(m.voices.length).toBe(CATEGORY_CAPS['ui']);
  });
});

describe('hidden tab', () => {
  it('mutes every bus without changing saved volumes', () => {
    const m = new AudioModel();
    m.setVolume('music', 0.5);
    m.setVolume('sfx', 0.4);
    m.setHidden(true);
    expect(m.isHidden()).toBe(true);
    for (const bus of ['master', 'music', 'sfx', 'ui'] as const) {
      expect(m.effectiveGain(bus)).toBe(0);
    }
    expect(m.volume('music')).toBe(0.5);
    expect(m.volume('sfx')).toBe(0.4);
  });

  it('refuses new voices while hidden', () => {
    const m = new AudioModel();
    expect(m.play('ui', 0, 0)).not.toBeNull();
    m.setHidden(true);
    expect(m.play('ui', 0, 1)).toBeNull();
  });

  it('restores the previous gains when shown again', () => {
    const m = new AudioModel();
    m.setVolume('music', 0.5);
    m.setHidden(true);
    m.setHidden(false);
    expect(m.isHidden()).toBe(false);
    expect(m.effectiveGain('music')).toBeCloseTo(0.5 * DEFAULT_VOLUMES.master);
    expect(m.play('ui', 0, 2)).not.toBeNull();
  });

  it('keeps a bus mute that was set before hiding', () => {
    const m = new AudioModel();
    m.setMuted('ui', true);
    m.setHidden(true);
    m.setHidden(false);
    expect(m.effectiveGain('ui')).toBe(0);
  });
});

describe('serialize and restore', () => {
  it('round-trips the saved volumes', () => {
    const a = new AudioModel();
    a.setVolume('master', 0.25);
    a.setVolume('music', 0.1);
    a.setVolume('sfx', 0.75);
    a.setVolume('ui', 0);
    const b = new AudioModel();
    expect(b.restore(a.serialize())).toBe(true);
    for (const bus of ['master', 'music', 'sfx', 'ui'] as const) {
      expect(b.volume(bus)).toBe(a.volume(bus));
    }
  });

  it('serialize writes the bus volumes and leaves out mutes and hidden state', () => {
    const m = new AudioModel();
    m.setMuted('sfx', true);
    m.setHidden(true);
    const parsed: unknown = JSON.parse(m.serialize());
    expect(parsed).toEqual({ v: 1, volumes: { master: 1, music: 0.8, sfx: 0.9, ui: 0.9 } });
  });

  it('accepts an already parsed object', () => {
    const m = new AudioModel();
    expect(m.restore({ volumes: { music: 0.2 } })).toBe(true);
    expect(m.volume('music')).toBe(0.2);
  });

  it('a string that is not JSON changes nothing and returns false', () => {
    const m = new AudioModel();
    expect(m.restore('{not json')).toBe(false);
    expect(m.volume('music')).toBe(DEFAULT_VOLUMES.music);
  });

  it('non-object inputs change nothing and return false', () => {
    const m = new AudioModel();
    for (const bad of [undefined, null, 0, 42, true, [], ['volumes'], 'null', '42', '[1,2]', '"text"']) {
      expect(m.restore(bad)).toBe(false);
    }
    expect(m.volume('sfx')).toBe(DEFAULT_VOLUMES.sfx);
  });

  it('an object without a volumes object changes nothing', () => {
    const m = new AudioModel();
    expect(m.restore({ v: 1 })).toBe(false);
    expect(m.restore({ volumes: 'loud' })).toBe(false);
    expect(m.restore({ volumes: [0.1, 0.2] })).toBe(false);
    expect(m.volume('master')).toBe(DEFAULT_VOLUMES.master);
  });

  it('clamps out of range numbers into 0..1', () => {
    const m = new AudioModel();
    expect(m.restore({ volumes: { master: 5, music: -2, sfx: 1e9, ui: -1e9 } })).toBe(true);
    expect(m.volume('master')).toBe(1);
    expect(m.volume('music')).toBe(0);
    expect(m.volume('sfx')).toBe(1);
    expect(m.volume('ui')).toBe(0);
  });

  it('keeps the current volume for a bus that is missing, non-numeric, or NaN', () => {
    const m = new AudioModel();
    m.setVolume('music', 0.33);
    m.setVolume('sfx', 0.44);
    m.setVolume('ui', 0.55);
    expect(m.restore({ volumes: { music: 'loud', sfx: Number.NaN, master: null } })).toBe(true);
    expect(m.volume('music')).toBe(0.33);
    expect(m.volume('sfx')).toBe(0.44);
    expect(m.volume('ui')).toBe(0.55);
    expect(m.volume('master')).toBe(DEFAULT_VOLUMES.master);
  });

  it('applies the valid buses even when others are bad', () => {
    const m = new AudioModel();
    expect(m.restore({ volumes: { music: 0.5, ui: {}, sfx: undefined } })).toBe(true);
    expect(m.volume('music')).toBe(0.5);
    expect(m.volume('ui')).toBe(DEFAULT_VOLUMES.ui);
  });

  it('ignores unknown bus names and does not change mutes', () => {
    const m = new AudioModel();
    m.setMuted('music', true);
    expect(m.restore({ volumes: { bogus: 0.1 }, muted: { music: false } })).toBe(true);
    expect(m.isMuted('music')).toBe(true);
    expect(m.effectiveGain('music')).toBe(0);
  });

  it('a string value for a bus is not coerced into a volume', () => {
    const m = new AudioModel();
    expect(() => m.restore('{"volumes":{"music":"0.5"}}')).not.toThrow();
    expect(m.volume('music')).toBe(DEFAULT_VOLUMES.music);
  });
});
