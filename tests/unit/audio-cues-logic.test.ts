import { describe, expect, it } from 'vitest';
import { SOUND_BY_ID } from '../../src/audio/sounds.ts';
import { DEFAULT_OPTIONS } from '../../src/ui/panels/options.ts';
import {
  HAPTIC_PATTERNS,
  STINGER_CAPTIONS,
  StingerWatch,
  captionFor,
  cueOptionsFrom,
  hapticPattern,
  offscreenSide,
  pulsesWhenOffscreen,
  vibrate,
} from '../../src/ui/cues.ts';

describe('visual cues: captions', () => {
  it('captions every stinger and only stingers', () => {
    for (const id of Object.keys(STINGER_CAPTIONS)) {
      expect(SOUND_BY_ID.get(id)?.category).toBe('stingers');
      expect(captionFor(id, true)).toBe(STINGER_CAPTIONS[id]);
    }
    expect(captionFor('ui_click', true)).toBeNull();
    expect(captionFor('vox_hurt', true)).toBeNull();
  });

  it('shows nothing while the visual cues option is off', () => {
    expect(captionFor('stg_age_change', false)).toBeNull();
  });
});

describe('haptics', () => {
  it('maps UI confirm, the being hit and the calamity peak to patterns that exist as sounds', () => {
    for (const id of Object.keys(HAPTIC_PATTERNS)) expect(SOUND_BY_ID.has(id)).toBe(true);
    expect(hapticPattern('ui_confirm', true)).toEqual([8]);
    expect(hapticPattern('cal_storm_peak', true)?.length).toBeGreaterThan(1);
    expect(hapticPattern('ui_click', true)).toBeNull();
  });

  it('is silent when the haptics option is off', () => {
    expect(hapticPattern('ui_confirm', false)).toBeNull();
  });

  it('is on by default, as the settings row says', () => {
    expect(cueOptionsFrom(DEFAULT_OPTIONS).haptics).toBe(true);
  });

  it('calls navigator.vibrate with a copy of the pattern', () => {
    const calls: unknown[] = [];
    const nav = { vibrate: (p: number | number[]) => (calls.push(p), true) };
    expect(vibrate([8], nav)).toBe(true);
    expect(calls).toEqual([[8]]);
  });

  it('does nothing where the device has no vibrate (iOS Safari, desktop)', () => {
    expect(vibrate([8], {})).toBe(false);
    expect(vibrate([8], undefined)).toBe(false);
    expect(vibrate(null, { vibrate: () => true })).toBe(false);
  });

  it('never throws when the device call throws', () => {
    expect(
      vibrate([8], {
        vibrate: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe(false);
  });
});

describe('options read from settings', () => {
  it('reads the four cue options and defaults them off when absent', () => {
    const o = cueOptionsFrom({});
    expect(o).toEqual({ visualCues: false, mono: false, reduceLoudSounds: false, haptics: false });
    const on = cueOptionsFrom({ 'audio.visualCues': true, 'audio.mono': true, 'audio.reduceLoud': true, 'input.haptics': true });
    expect(on).toEqual({ visualCues: true, mono: true, reduceLoudSounds: true, haptics: true });
  });
});

describe('sound-visual pulse (16 A7)', () => {
  it('finds the screen edge an off-screen point lies beyond', () => {
    expect(offscreenSide(-1, 10, 100, 100)).toBe('left');
    expect(offscreenSide(101, 10, 100, 100)).toBe('right');
    expect(offscreenSide(10, -1, 100, 100)).toBe('top');
    expect(offscreenSide(10, 101, 100, 100)).toBe('bottom');
    expect(offscreenSide(50, 50, 100, 100)).toBeNull();
    expect(offscreenSide(0, 100, 100, 100)).toBeNull();
  });

  it('pulses only for priority 0 and 1 sounds', () => {
    expect(pulsesWhenOffscreen('stg_age_change')).toBe(true);
    expect(pulsesWhenOffscreen('cal_storm_peak')).toBe(true);
    expect(pulsesWhenOffscreen('cmb_hit_blade')).toBe(false);
    expect(pulsesWhenOffscreen('amb_wind_low')).toBe(false);
    expect(pulsesWhenOffscreen('no_such_sound')).toBe(false);
  });
});

describe('StingerWatch', () => {
  it('sets a baseline on the first snapshot and plays nothing', () => {
    const w = new StingerWatch();
    expect(w.ingest('dawn', 2)).toEqual([]);
  });

  it('plays the Age stinger once when the Age changes', () => {
    const w = new StingerWatch();
    w.ingest('dawn', 0);
    expect(w.ingest('dawn', 0)).toEqual([]);
    expect(w.ingest('scorch', 0)).toEqual(['stg_age_change']);
    expect(w.ingest('scorch', 0)).toEqual([]);
  });

  it('plays war declared on the first war and peace when the last one ends', () => {
    const w = new StingerWatch();
    w.ingest('dawn', 0);
    expect(w.ingest('dawn', 1)).toEqual(['stg_war_declared']);
    expect(w.ingest('dawn', 3)).toEqual([]);
    expect(w.ingest('dawn', 0)).toEqual(['stg_peace']);
  });

  it('ignores a missing Age (no realm yet) instead of treating it as a change', () => {
    const w = new StingerWatch();
    w.ingest('dawn', 0);
    expect(w.ingest(null, 0)).toEqual([]);
    expect(w.ingest('dawn', 0)).toEqual([]);
  });
});
