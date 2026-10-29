import { describe, expect, it } from 'vitest';
import { sortFilterSearch, visibleRange } from '../../src/ui/panels/listWindow.ts';
import { currentStep, newTutorial, parseTutorial, skipTutorial, tutorialEvent, TUTORIAL_STEPS, TUTORIAL_TEXT } from '../../src/ui/panels/tutorial.ts';
import { cooldownFraction, favourite } from '../../src/ui/panels/powerBar.ts';

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
    expect(currentStep(s)?.id).toBe('shape');
    s = tutorialEvent(s, 'spawned');
    expect(s.index).toBe(0);
    for (const step of TUTORIAL_STEPS) s = tutorialEvent(s, step.waitFor);
    expect(s.done).toBe(true);
    expect(currentStep(s)).toBeNull();
  });

  it('can be skipped at any point and then ignores events', () => {
    const skipped = skipTutorial(tutorialEvent(newTutorial(), 'stroke-finished'));
    expect(skipped.skipped).toBe(true);
    expect(skipped.index).toBe(1);
    const after = tutorialEvent(skipped, 'spawned');
    expect(after.index).toBe(1);
    expect(currentStep(after)).toBeNull();
  });
});

describe('power bar', () => {
  it('favourites are capped at 9 (the recent row shows 9) and unique', () => {
    let list: string[] = [];
    for (let k = 0; k < 20; k++) list = favourite(list, `p${k}`);
    expect(list.length).toBe(9);
    expect(favourite(list, 'p0')).toEqual(list);
  });

  it('cooldown fraction runs from 1 down to 0', () => {
    expect(cooldownFraction(0, 100, 100)).toBe(1);
    expect(cooldownFraction(50, 100, 100)).toBeCloseTo(0.5);
    expect(cooldownFraction(100, 100, 100)).toBe(0);
  });
});
