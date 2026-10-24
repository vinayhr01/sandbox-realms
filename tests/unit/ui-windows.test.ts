import { describe, expect, it } from 'vitest';
import { POWER_BY_ID } from '../../src/content/powers.ts';
import { RuleSet } from '../../src/sim/rules.ts';
import { DEFAULT_OPTIONS } from '../../src/ui/panels/options.ts';
import { WINDOW_CATALOG, WINDOW_IDS, windowTitle } from '../../src/ui/windowCatalog.ts';
import { windowFor, type WindowDeps } from '../../src/ui/windowContent.ts';

const deps: WindowDeps = {
  options: () => DEFAULT_OPTIONS,
  setOption: () => undefined,
  rules: new RuleSet(),
  setRule: () => true,
  realm: () => ({ seed: 42, side: 256, calendar: 'Y1 M1' }),
  newRealm: () => undefined,
  activate: () => undefined,
  tutorial: () => ({ state: { index: 0, skipped: false, done: false }, restart: () => undefined, skip: () => undefined }),
  saves: () => Promise.resolve([]),
  close: () => undefined,
};

describe('window catalogue', () => {
  it('ids are unique and each has a title', () => {
    expect(WINDOW_IDS.size).toBe(WINDOW_CATALOG.length);
    for (const w of WINDOW_CATALOG) expect(w.title.length).toBeGreaterThan(0);
    expect(windowTitle('win_settings')).toBe('Settings');
    expect(windowTitle('win_missing')).toBe('');
  });

  it('every catalogue window has content, and unknown ids have none', () => {
    for (const w of WINDOW_CATALOG) {
      const built = windowFor(w.id, deps);
      expect(built, w.id).not.toBeNull();
      expect(built?.title, w.id).toBe(w.title);
    }
    expect(windowFor('win_codex', deps)).toBeNull();
    expect(windowFor('win_lore', deps)).toBeNull();
  });

  it('the power bar only opens windows that exist', () => {
    for (const id of ['realm_rules', 'realm_ages']) {
      const def = POWER_BY_ID.get(id);
      expect(def?.handler).toBe('open_window');
      expect(WINDOW_IDS.has(`win_${String(def?.params['window'])}`)).toBe(true);
    }
  });

  it('spec ids are used where the spec names the window', () => {
    const spec = WINDOW_CATALOG.filter((w) => w.spec !== null);
    expect(spec.length).toBe(11);
    for (const w of spec) expect(w.spec).toBe(w.id);
  });
});
