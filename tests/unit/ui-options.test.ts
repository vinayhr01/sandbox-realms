import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIONS,
  SETTINGS,
  SETTINGS_KEY,
  boolOption,
  loadOptions,
  numberOption,
  resetGroup,
  sanitizeOptions,
  saveOptions,
  setOption,
  stringOption,
  type KeyValueStorage,
} from '../../src/ui/panels/options.ts';

function fakeStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in data ? (data[k] ?? null) : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const throwingStorage: KeyValueStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('settings table', () => {
  it('covers the spec options: 72 rows, 3 audio rows and 3 Insight rows; 7 spec mark toggles plus marks.armyLines (13 section 15)', () => {
    // 72 spec 13 rows, three audio options from spec 16 (audio.mono, audio.visualCues, audio.reduceLoud), and three
    // Insight options (map.layer, map.layerMode, marks.armyLines). The marks group holds the 7 spec toggles and armyLines.
    expect(SETTINGS.length).toBe(77);
    expect(SETTINGS.filter((s) => s.id.startsWith('marks.')).length).toBe(8);
  });

  it('ids are unique and every default is valid for its type', () => {
    expect(new Set(SETTINGS.map((s) => s.id)).size).toBe(SETTINGS.length);
    expect(sanitizeOptions(DEFAULT_OPTIONS)).toEqual(DEFAULT_OPTIONS);
    for (const s of SETTINGS) {
      if (s.kind === 'int') expect(Number(s.def)).toBeGreaterThanOrEqual(s.min ?? 0);
      if (s.kind === 'choice') expect(s.choices).toContain(s.def);
    }
  });

  it('uses the spec defaults for the settings named in the brief', () => {
    expect(DEFAULT_OPTIONS['ui.scale']).toBe(100);
    expect(DEFAULT_OPTIONS['ui.theme']).toBe('dark');
    expect(DEFAULT_OPTIONS['ui.scaleNames']).toBe(70);
    expect(DEFAULT_OPTIONS['audio.master']).toBe(100);
    expect(DEFAULT_OPTIONS['audio.music']).toBe(60);
    expect(DEFAULT_OPTIONS['audio.sfx']).toBe(100);
    expect(DEFAULT_OPTIONS['audio.ui']).toBe(80);
    expect(DEFAULT_OPTIONS['ui.fpsCap']).toBe(60);
    expect(DEFAULT_OPTIONS['map.layerOpacity']).toBe(88);
    expect(DEFAULT_OPTIONS['game.defaultSpeed']).toBe('1x');
  });

  it('the live flag marks only settings the game reacts to', () => {
    const live = SETTINGS.filter((s) => s.live).map((s) => s.id);
    expect(live).toEqual(expect.arrayContaining(['ui.scale', 'ui.theme', 'audio.master', 'input.panSpeed']));
    expect(live).not.toContain('map.bloom');
    expect(live.length).toBeGreaterThan(15);
  });
});

describe('options load, save and clamp', () => {
  it('clamps numeric ranges and rejects unknown choices', () => {
    const o = sanitizeOptions({ 'ui.scale': 999, 'input.panSpeed': 0, 'audio.master': -5, 'ui.layout': 'weird', 'ui.theme': 'light' });
    expect(o['ui.scale']).toBe(150);
    expect(o['input.panSpeed']).toBe(50);
    expect(o['audio.master']).toBe(0);
    expect(o['ui.layout']).toBe(DEFAULT_OPTIONS['ui.layout']);
    expect(o['ui.theme']).toBe('light');
  });

  it('rejects a value of the wrong type and keeps the default', () => {
    const o = sanitizeOptions({ 'map.bloom': 'yes', 'ui.fpsCap': '120', 'ui.scale': Number.NaN });
    expect(o['map.bloom']).toBe(true);
    expect(o['ui.fpsCap']).toBe(60);
    expect(o['ui.scale']).toBe(100);
  });

  it('drops unknown keys', () => {
    expect(sanitizeOptions({ 'nope.nope': 1 })).not.toHaveProperty('nope.nope');
  });

  it('a corrupt saved value falls back to defaults without throwing', () => {
    expect(loadOptions(fakeStorage({ [SETTINGS_KEY]: '{not json' }))).toEqual(DEFAULT_OPTIONS);
  });

  it('round-trips through storage', () => {
    const st = fakeStorage();
    expect(saveOptions(st, setOption(DEFAULT_OPTIONS, 'ui.scale', 120))).toBe(true);
    expect(loadOptions(st)['ui.scale']).toBe(120);
  });

  it('a base other than the defaults fills missing keys (OS preference for reduce motion)', () => {
    const base = { ...DEFAULT_OPTIONS, 'ui.reduceMotion': true };
    expect(loadOptions(fakeStorage(), base)['ui.reduceMotion']).toBe(true);
    expect(loadOptions(fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ 'ui.reduceMotion': false }) }), base)['ui.reduceMotion']).toBe(false);
  });

  it('storage that throws is handled: load gives defaults, save reports false', () => {
    expect(loadOptions(throwingStorage)).toEqual(DEFAULT_OPTIONS);
    expect(saveOptions(throwingStorage, DEFAULT_OPTIONS)).toBe(false);
    expect(loadOptions(null)).toEqual(DEFAULT_OPTIONS);
  });

  it('setOption ignores ids the table does not know', () => {
    expect(setOption(DEFAULT_OPTIONS, 'nope', 1)).toEqual(DEFAULT_OPTIONS);
  });

  it('resetGroup restores one group and leaves the others', () => {
    const changed = setOption(setOption(DEFAULT_OPTIONS, 'audio.master', 10), 'ui.scale', 120);
    const reset = resetGroup(changed, 'audio');
    expect(reset['audio.master']).toBe(100);
    expect(reset['ui.scale']).toBe(120);
  });

  it('typed accessors return the stored value', () => {
    expect(numberOption(DEFAULT_OPTIONS, 'audio.music')).toBe(60);
    expect(boolOption(DEFAULT_OPTIONS, 'marks.boats')).toBe(true);
    expect(stringOption(DEFAULT_OPTIONS, 'game.defaultSpeed')).toBe('1x');
  });
});
