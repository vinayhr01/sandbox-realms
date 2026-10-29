import { describe, expect, it } from 'vitest';
import { POWER_PREFS_KEY, loadPowerPrefs, savePowerPrefs, type PowerPrefs } from '../../src/ui/shell/powerPrefs.ts';
import type { KeyValueStorage } from '../../src/ui/panels/options.ts';

/** An in-memory storage with the same two methods as window.localStorage. */
function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('power preferences (favourites and recent, persisted)', () => {
  it('uses the sr.powers.v1 key', () => {
    expect(POWER_PREFS_KEY).toBe('sr.powers.v1');
  });

  it('round-trips favourites and recent powers through storage', () => {
    const storage = memory();
    const prefs: PowerPrefs = { favourites: ['sky_rain', 'havoc_bomb'], recent: ['fav_vigor', 'shape_raise'] };
    savePowerPrefs(storage, prefs);
    expect(loadPowerPrefs(storage)).toEqual(prefs);
  });

  it('drops ids that are no longer powers, and duplicates', () => {
    const storage = memory();
    storage.setItem(POWER_PREFS_KEY, JSON.stringify({ favourites: ['sky_rain', 'gone_power', 'sky_rain'], recent: ['nope', 'fav_vigor'] }));
    expect(loadPowerPrefs(storage)).toEqual({ favourites: ['sky_rain'], recent: ['fav_vigor'] });
  });

  it('caps the recent row at 9 and favourites at 9 (the pins the row can show)', () => {
    const storage = memory();
    const ids = ['sky_rain', 'sky_snow', 'sky_ignite', 'sky_quench', 'sky_warm', 'sky_chill', 'havoc_bomb', 'havoc_bolt', 'fav_vigor', 'fav_ward'];
    storage.setItem(POWER_PREFS_KEY, JSON.stringify({ favourites: ids, recent: ids }));
    const loaded = loadPowerPrefs(storage);
    expect(loaded.recent.length).toBe(9);
    expect(loaded.favourites.length).toBe(9);
  });

  it('a corrupt or missing value loads as empty lists', () => {
    const storage = memory();
    expect(loadPowerPrefs(storage)).toEqual({ favourites: [], recent: [] });
    storage.setItem(POWER_PREFS_KEY, '{not json');
    expect(loadPowerPrefs(storage)).toEqual({ favourites: [], recent: [] });
    storage.setItem(POWER_PREFS_KEY, JSON.stringify([1, 2]));
    expect(loadPowerPrefs(storage)).toEqual({ favourites: [], recent: [] });
  });

  it('a null storage (blocked site data) neither throws nor keeps anything', () => {
    expect(loadPowerPrefs(null)).toEqual({ favourites: [], recent: [] });
    expect(() => savePowerPrefs(null, { favourites: ['sky_rain'], recent: [] })).not.toThrow();
  });

  it('a throwing storage is survived on both read and write', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadPowerPrefs(broken)).toEqual({ favourites: [], recent: [] });
    expect(() => savePowerPrefs(broken, { favourites: [], recent: [] })).not.toThrow();
  });
});
