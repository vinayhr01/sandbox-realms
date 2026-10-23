import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, SETTINGS_KEY, loadOptions, sanitizeOptions, saveOptions, setOption, type KeyValueStorage } from '../../src/ui/panels/options.ts';
import { sortFilterSearch, visibleRange } from '../../src/ui/panels/listWindow.ts';
import { currentStep, newTutorial, skipTutorial, tutorialEvent, TUTORIAL_STEPS } from '../../src/ui/panels/tutorial.ts';
import { BRUSH_MAX, BRUSH_MIN, cooldownFraction, favourite, selectTab, stepBrush } from '../../src/ui/panels/powerBar.ts';

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

describe('options', () => {
  it('defaults are valid and sanitize is identity on them', () => {
    expect(sanitizeOptions(DEFAULT_OPTIONS)).toEqual(DEFAULT_OPTIONS);
  });

  it('clamps numeric ranges and rejects unknown enums', () => {
    const o = sanitizeOptions({ scale: 999, brushSize: 0, soundVolume: -5, layout: 'weird', theme: 'light' });
    expect(o.scale).toBe(150);
    expect(o.brushSize).toBe(1);
    expect(o.soundVolume).toBe(0);
    expect(o.layout).toBe(DEFAULT_OPTIONS.layout);
    expect(o.theme).toBe('light');
  });

  it('a corrupt saved value falls back to defaults without throwing', () => {
    expect(loadOptions(fakeStorage({ [SETTINGS_KEY]: '{not json' }))).toEqual(DEFAULT_OPTIONS);
  });

  it('round-trips through storage', () => {
    const st = fakeStorage();
    expect(saveOptions(st, setOption(DEFAULT_OPTIONS, 'scale', 120))).toBe(true);
    expect(loadOptions(st).scale).toBe(120);
  });

  it('storage that throws is handled: load gives defaults, save reports false', () => {
    expect(loadOptions(throwingStorage)).toEqual(DEFAULT_OPTIONS);
    expect(saveOptions(throwingStorage, DEFAULT_OPTIONS)).toBe(false);
    expect(loadOptions(null)).toEqual(DEFAULT_OPTIONS);
  });
});

describe('list window', () => {
  const items = [
    { name: 'Wolf', hp: 30 },
    { name: 'bear', hp: 80 },
    { name: 'Deer', hp: 30 },
  ];
  const label = (x: { name: string }) => x.name;

  it('sorts ascending and descending, stable on ties', () => {
    expect(sortFilterSearch(items, { sortKey: 'hp', desc: false, query: '', label }).map((x) => x.name)).toEqual(['Wolf', 'Deer', 'bear']);
    expect(sortFilterSearch(items, { sortKey: 'hp', desc: true, query: '', label }).map((x) => x.name)).toEqual(['bear', 'Wolf', 'Deer']);
  });

  it('search is case-insensitive substring on the label', () => {
    expect(sortFilterSearch(items, { sortKey: 'name', desc: false, query: 'EE', label }).map((x) => x.name)).toEqual(['Deer']);
  });

  it('filter applies before search and sort', () => {
    const r = sortFilterSearch(items, { sortKey: 'name', desc: false, query: '', filter: (x) => x.hp > 50, label });
    expect(r.map((x) => x.name)).toEqual(['bear']);
  });

  it('visible range covers the viewport with overscan and clamps', () => {
    expect(visibleRange(1000, 20, 200, 0)).toEqual({ start: 0, end: 13 });
    expect(visibleRange(1000, 20, 200, 10000)).toEqual({ start: 497, end: 513 });
    expect(visibleRange(5, 20, 200, 0)).toEqual({ start: 0, end: 5 });
    expect(visibleRange(0, 20, 200, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('tutorial', () => {
  it('advances in order on the matching events and completes', () => {
    let s = newTutorial();
    expect(currentStep(s)?.id).toBe('pick-tool');
    s = tutorialEvent(s, 'paint');
    expect(s.index).toBe(0);
    for (const step of TUTORIAL_STEPS) s = tutorialEvent(s, step.waitFor);
    expect(s.done).toBe(true);
    expect(currentStep(s)).toBeNull();
  });

  it('can be skipped at any point and then ignores events', () => {
    const skipped = skipTutorial(tutorialEvent(newTutorial(), 'tool-armed'));
    expect(skipped.skipped).toBe(true);
    const after = tutorialEvent(skipped, 'stroke-finished');
    expect(after.index).toBe(1);
    expect(currentStep(after)).toBeNull();
  });
});

describe('power bar', () => {
  it('favourites are capped at 12 and unique', () => {
    let list: string[] = [];
    for (let k = 0; k < 20; k++) list = favourite(list, `p${k}`);
    expect(list.length).toBe(12);
    expect(favourite(list, 'p0')).toEqual(list);
  });

  it('brush size stays in 1..72 for any step', () => {
    let s = 5;
    for (let k = 0; k < 50; k++) {
      s = stepBrush(s, 1);
      expect(s).toBeGreaterThanOrEqual(BRUSH_MIN);
      expect(s).toBeLessThanOrEqual(BRUSH_MAX);
    }
    expect(s).toBe(BRUSH_MAX);
    for (let k = 0; k < 50; k++) s = stepBrush(s, -1);
    expect(s).toBe(BRUSH_MIN);
  });

  it('cooldown fraction runs from 1 down to 0', () => {
    expect(cooldownFraction(0, 100, 100)).toBe(1);
    expect(cooldownFraction(50, 100, 100)).toBeCloseTo(0.5);
    expect(cooldownFraction(100, 100, 100)).toBe(0);
  });

  it('selecting an unknown tab keeps the state', () => {
    const st = { active: 'terrain', tabs: ['terrain', 'beings'] };
    expect(selectTab(st, 'nope')).toEqual(st);
    expect(selectTab(st, 'beings').active).toBe('beings');
  });
});
