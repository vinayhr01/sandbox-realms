/**
 * Source guards for the layering and autosave rules that live in CSS and in the wiring of main.ts, where a DOM test
 * cannot reach them. Each one reads the file and checks the rule as written.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The z-index a rule sets for one selector, or null when the rule has none. */
function zIndexOf(css: string, selector: string): number | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  const z = rule ? /z-index:\s*(\d+)/.exec(rule[1] ?? '') : null;
  return z ? Number(z[1]) : null;
}

describe('toasts layering', () => {
  it('toasts paint above the Atlas scrim', () => {
    const atlas = read('../../src/ui/shell/Atlas.css');
    const styles = read('../../src/ui/styles.css');
    const scrim = zIndexOf(atlas, '.atlas-scrim');
    const toasts = zIndexOf(styles, '.toasts');
    expect(scrim).not.toBeNull();
    expect(toasts).not.toBeNull();
    expect(toasts ?? 0).toBeGreaterThan(scrim ?? Number.POSITIVE_INFINITY);
  });

  it('a toast with a button can still be clicked through the pointer-events none column', () => {
    const styles = read('../../src/ui/styles.css');
    expect(styles).toMatch(/\.toast \{\s*pointer-events: auto;/);
  });
});

describe('autosave', () => {
  it('only a confirmation pauses autosave: the Atlas open state is not part of the autosave modal flag', () => {
    const main = read('../../src/app/main.ts');
    expect(main).toMatch(/modalOpen: windowHost\.current !== null,/);
    expect(main).not.toMatch(/modalOpen:[^\n]*atlas/);
  });
});
