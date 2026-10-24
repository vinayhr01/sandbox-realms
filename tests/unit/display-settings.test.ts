import { describe, expect, it } from 'vitest';
import { colourFilterMarkup, daltonizeMatrix, layoutMaxWidth, mapCanvasFilter } from '../../src/ui/display.ts';
import { AutosaveClock } from '../../src/app/saves.ts';

describe('display settings (13 section 15)', () => {
  it('the colour-blind correction is a 3x3 matrix for each palette and none for none', () => {
    expect(daltonizeMatrix('none')).toBeNull();
    for (const p of ['deuteranopia', 'protanopia', 'tritanopia'] as const) {
      const m = daltonizeMatrix(p);
      expect(m).toHaveLength(3);
      for (const row of m ?? []) {
        expect(row).toHaveLength(3);
        for (const v of row) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('the SVG markup defines one filter per palette with a full 4x5 colour matrix', () => {
    const markup = colourFilterMarkup();
    for (const p of ['deuteranopia', 'protanopia', 'tritanopia']) {
      expect(markup).toContain(`id="sr-cvd-${p}"`);
    }
    const values = /values="([^"]+)"/g;
    let count = 0;
    for (const match of markup.matchAll(values)) {
      expect(match[1]?.trim().split(/\s+/)).toHaveLength(20);
      count++;
    }
    expect(count).toBe(3);
  });

  it('the map canvas filter combines the palette and the brightness, and is none at the defaults', () => {
    expect(mapCanvasFilter('none', 100)).toBe('none');
    expect(mapCanvasFilter('deuteranopia', 100)).toBe('url(#sr-cvd-deuteranopia)');
    expect(mapCanvasFilter('none', 80)).toBe('brightness(0.80)');
    expect(mapCanvasFilter('tritanopia', 60)).toBe('url(#sr-cvd-tritanopia) brightness(0.60)');
  });

  it('layout choices map to a width cap, and auto has none', () => {
    expect(layoutMaxWidth('auto')).toBeNull();
    expect(layoutMaxWidth('compact')).toBe(600);
    expect(layoutMaxWidth('medium')).toBe(960);
    expect(layoutMaxWidth('expanded')).toBe(1440);
  });

  it('an autosave interval of 0 turns the timer off, and a new interval starts it again', () => {
    const clock = new AutosaveClock(60_000);
    expect(clock.advance(60_000, false)).toBe(true);
    clock.markSaved();
    clock.setInterval(0);
    expect(clock.enabled).toBe(false);
    expect(clock.advance(10_000_000, false)).toBe(false);
    clock.setInterval(120_000);
    expect(clock.enabled).toBe(true);
    expect(clock.advance(60_000, false)).toBe(false);
  });
});
