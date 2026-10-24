import { describe, expect, it } from 'vitest';
import { audioOptionsFrom, CUE } from '../../src/app/audio-wiring.ts';
import { DEFAULT_AUDIO_OPTIONS } from '../../src/audio/options.ts';
import { SOUND_BY_ID } from '../../src/audio/sounds.ts';
import { SETTINGS, DEFAULT_OPTIONS } from '../../src/ui/panels/options.ts';

describe('audio wiring', () => {
  it('every cue the UI plays is a defined sound', () => {
    for (const id of Object.values(CUE)) expect(SOUND_BY_ID.has(id), id).toBe(true);
  });

  it('the four audio sliders feed the engine volumes on the same 0..100 scale', () => {
    const options = {
      ...DEFAULT_OPTIONS,
      'audio.master': 40,
      'audio.music': 10,
      'audio.sfx': 75,
      'audio.ui': 0,
      'audio.muteOnBlur': false,
    };
    const out = audioOptionsFrom(options);
    expect(out.volumes).toEqual({ ...DEFAULT_AUDIO_OPTIONS.volumes, master: 40, music: 10, effects: 75, ui: 0 });
    expect(out.muteWhenHidden).toBe(false);
  });

  it('the settings defaults map to a valid engine option set', () => {
    const out = audioOptionsFrom(DEFAULT_OPTIONS);
    for (const v of Object.values(out.volumes)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(SETTINGS.some((s) => s.id === 'audio.sfx')).toBe(true);
  });
});
