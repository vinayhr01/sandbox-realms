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
  open: () => undefined,
  brush: () => ({ shape: 'circle', sizeIndex: 5, radii: [0, 1, 2, 3, 4, 5] }),
  setBrush: () => undefined,
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

  it('spec ids are used where the spec names the window; the spec table has 62 rows', () => {
    const spec = WINDOW_CATALOG.filter((w) => w.spec !== null);
    // win_customize_* is one row of the spec table with nine ids (one per banner kind).
    const rows = new Set(spec.map((w) => w.spec));
    expect(rows.size).toBe(62);
    for (const w of spec) {
      const customize = w.spec === 'win_customize_*' && w.id.startsWith('win_customize_');
      expect(customize || w.spec === w.id, w.id).toBe(true);
    }
  });

  it('every spec row of 13 section 7.1 has a window (62 rows, customise as one)', () => {
    const rows = new Set(WINDOW_CATALOG.map((w) => w.spec).filter((s): s is string => s !== null));
    const missing = [
      'win_being', 'win_item', 'win_structure', 'win_pact', 'win_army', 'win_clan',
      'list_pacts', 'list_hosts', 'list_kinbands', 'list_fav_beings', 'list_fav_items', 'win_customize_*',
      'win_compare', 'win_annals', 'win_chronicle_confirm', 'win_trait_rain_edit', 'win_item_rain_edit',
      'win_trait_editor', 'win_gear_editor', 'win_patch_notes', 'win_error', 'win_confirm_quit', 'win_update',
      'win_dev_console', 'win_dev_tools',
    ];
    for (const id of missing) expect(rows.has(id), id).toBe(true);
  });
});
