/**
 * Volume and audio options (16 section B9). Pure: defaults, slider mapping, the category-to-option
 * table and tolerant parsing of the saved options. The app stores the result in `settings`, never
 * in a Chronicle.
 */
export type VolumeOption = 'master' | 'music' | 'effects' | 'voices' | 'ambience' | 'ui';
export type MusicFrequency = 'constant' | 'often' | 'occasional';
export type SpatialIntensity = 'low' | 'normal' | 'high';

export interface AudioOptions {
  /** Sliders 0..100 (B9). */
  volumes: Record<VolumeOption, number>;
  musicFrequency: MusicFrequency;
  muteWhenHidden: boolean;
  reduceLoudSounds: boolean;
  mono: boolean;
  visualCues: boolean;
  spatialIntensity: SpatialIntensity;
  haptics: boolean;
}

export const VOLUME_OPTIONS: readonly VolumeOption[] = ['master', 'music', 'effects', 'voices', 'ambience', 'ui'];

export const DEFAULT_AUDIO_OPTIONS: AudioOptions = {
  volumes: { master: 80, music: 60, effects: 90, voices: 70, ambience: 70, ui: 80 },
  musicFrequency: 'often',
  muteWhenHidden: true,
  reduceLoudSounds: false,
  mono: false,
  visualCues: false,
  spatialIntensity: 'normal',
  haptics: true,
};

/** Perceptual slider law (B9): gain = (v / 100) squared. Input is clamped to 0..100; NaN is 0. */
export function sliderToGain(v: number): number {
  if (Number.isNaN(v)) return 0;
  const c = Math.min(100, Math.max(0, v)) / 100;
  return c * c;
}

/**
 * The option that scales a category, or null when only the bus slider applies. Stingers follow
 * the music slider; world effects use the effects slider.
 */
export function optionOfCategory(category: string): VolumeOption | null {
  switch (category) {
    case 'voices':
      return 'voices';
    case 'ambience':
      return 'ambience';
    case 'ui':
      return 'ui';
    case 'stingers':
      return 'music';
    case 'calamity':
    case 'combat':
    case 'work':
      return 'effects';
    default:
      return 'effects';
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function slider(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback;
}

/**
 * Reads saved options. Accepts a JSON string or an object. Anything missing or invalid falls back
 * to its default, so a damaged settings record never throws and never silences the game by accident.
 */
export function parseAudioOptions(input: unknown): AudioOptions {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      return { ...DEFAULT_AUDIO_OPTIONS, volumes: { ...DEFAULT_AUDIO_OPTIONS.volumes } };
    }
  }
  const d = isRecord(data) ? data : {};
  const vol = isRecord(d['volumes']) ? d['volumes'] : {};
  const volumes = { ...DEFAULT_AUDIO_OPTIONS.volumes };
  for (const k of VOLUME_OPTIONS) volumes[k] = slider(vol[k], DEFAULT_AUDIO_OPTIONS.volumes[k]);
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  return {
    volumes,
    musicFrequency: pick(d['musicFrequency'], ['constant', 'often', 'occasional'] as const, DEFAULT_AUDIO_OPTIONS.musicFrequency),
    muteWhenHidden: bool(d['muteWhenHidden'], DEFAULT_AUDIO_OPTIONS.muteWhenHidden),
    reduceLoudSounds: bool(d['reduceLoudSounds'], DEFAULT_AUDIO_OPTIONS.reduceLoudSounds),
    mono: bool(d['mono'], DEFAULT_AUDIO_OPTIONS.mono),
    visualCues: bool(d['visualCues'], DEFAULT_AUDIO_OPTIONS.visualCues),
    spatialIntensity: pick(d['spatialIntensity'], ['low', 'normal', 'high'] as const, DEFAULT_AUDIO_OPTIONS.spatialIntensity),
    haptics: bool(d['haptics'], DEFAULT_AUDIO_OPTIONS.haptics),
  };
}

/** Pan scale for the spatial intensity option (B9). */
export function spatialScale(intensity: SpatialIntensity): number {
  return intensity === 'low' ? 0.5 : intensity === 'high' ? 1.2 : 1;
}
