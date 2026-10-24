/**
 * Pure glue between the settings and the audio engine: the four audio sliders become the engine's
 * AudioOptions, and each UI event maps to a sound id from src/audio/sounds.ts. No WebAudio here, so
 * the mapping is tested in Node.
 */
import { DEFAULT_AUDIO_OPTIONS, type AudioOptions } from '../audio/options.ts';
import { silentMusicState, type MusicState } from '../audio/music.ts';
import { boolOption, numberOption, type Options } from '../ui/panels/options.ts';

/**
 * The music state the view can supply: paused and zoom come from the game; the Age, biome shares and
 * mood come from the sim feed (`feed`, see src/audio/feed.ts) and stay silent until it arrives. The
 * lineage stays unset. `zoom01` is the camera zoom scaled to 0 (most zoomed out) .. 1 (most zoomed
 * in); below 0.15 is the overview (16 B8).
 */
export function musicViewState(view: { paused: boolean; zoom01: number }, feed?: Partial<MusicState>): MusicState {
  const zoom = Number.isFinite(view.zoom01) ? Math.min(1, Math.max(0, view.zoom01)) : 0;
  return { ...silentMusicState(), ...feed, paused: view.paused, zoom, isOverview: zoom < 0.15 };
}

/** Engine options from the settings. Sliders are 0..100 on both sides. */
export function audioOptionsFrom(options: Options): AudioOptions {
  return {
    ...DEFAULT_AUDIO_OPTIONS,
    volumes: {
      ...DEFAULT_AUDIO_OPTIONS.volumes,
      master: numberOption(options, 'audio.master'),
      music: numberOption(options, 'audio.music'),
      effects: numberOption(options, 'audio.sfx'),
      ui: numberOption(options, 'audio.ui'),
    },
    muteWhenHidden: boolOption(options, 'audio.muteOnBlur'),
  };
}

/** Sound ids for UI events (ids from src/audio/sounds.ts; the test checks each one exists). */
export const CUE = {
  /** A brush stroke starts (painting). */
  paint: 'ui_click',
  /** A power is armed for the next tap. */
  arm: 'ui_power_select',
  /** A power or tool is used on the map. */
  power: 'ui_confirm',
  /** A plain notification (toast). */
  notify: 'ui_toast',
  /** A non-fatal fault or refused action. */
  error: 'ui_error',
  windowOpen: 'ui_window_open',
  save: 'ui_save',
  load: 'ui_load',
} as const;

export type Cue = (typeof CUE)[keyof typeof CUE];
