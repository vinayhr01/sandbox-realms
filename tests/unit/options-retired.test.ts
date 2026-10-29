import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, loadOptions, SETTING_BY_ID, SETTINGS_KEY, type KeyValueStorage } from '../../src/ui/panels/options.ts';

/** A storage holding one saved settings object. */
function savedWith(value: unknown): KeyValueStorage {
  const data = new Map<string, string>([[SETTINGS_KEY, JSON.stringify(value)]]);
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, v) => {
      data.set(key, v);
    },
  };
}

describe('retired settings (UX redesign, spec H)', () => {
  it('the inert quick strip and context-tab settings are gone from the table', () => {
    expect(SETTING_BY_ID.has('ui.quickStrip')).toBe(false);
    expect(SETTING_BY_ID.has('ui.autoOpenContextTab')).toBe(false);
  });

  it('the second developer switch is gone: dev.enabled is the one switch', () => {
    expect(SETTING_BY_ID.has('ui.devTools')).toBe(false);
    expect(SETTING_BY_ID.get('dev.enabled')?.group).toBe('dev');
  });

  it('a saved file that still holds the retired keys loads without them and keeps the rest', () => {
    const loaded = loadOptions(
      savedWith({ 'ui.quickStrip': true, 'ui.autoOpenContextTab': false, 'ui.devTools': true, 'dev.enabled': true, 'ui.minimap': false, 'not.a.setting': 4 }),
    );
    expect(loaded).not.toHaveProperty('ui.quickStrip');
    expect(loaded).not.toHaveProperty('ui.autoOpenContextTab');
    expect(loaded).not.toHaveProperty('ui.devTools');
    expect(loaded).not.toHaveProperty('not.a.setting');
    expect(loaded['dev.enabled']).toBe(true);
    expect(loaded['ui.minimap']).toBe(false);
  });

  it('a saved file with no retired keys loads to the defaults for the rest', () => {
    const loaded = loadOptions(savedWith({}));
    expect(loaded['dev.enabled']).toBe(DEFAULT_OPTIONS['dev.enabled']);
  });
});
