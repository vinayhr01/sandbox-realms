/**
 * Settings model (13 section 15, subset): display, sound and accessibility options with defaults,
 * clamped ranges and load/save through an injected storage object. Storage can throw (private
 * windows, full quota), so every access is wrapped and falls back to defaults.
 */
export type Layout = 'auto' | 'compact' | 'medium' | 'expanded';
export type Theme = 'dark' | 'light' | 'highcontrast';
export type ColorBlindPalette = 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia';
export type Quality = 'auto' | 'low' | 'medium' | 'high';

export interface Options {
  layout: Layout;
  /** Percent of base font and targets, 70..150. */
  scale: number;
  theme: Theme;
  colorBlindPalette: ColorBlindPalette;
  reduceMotion: boolean;
  reduceFlash: boolean;
  quality: Quality;
  /** Brush size, 1..72 (13 section 4). */
  brushSize: number;
  soundVolume: number;
  musicVolume: number;
  autoOpenContextTab: boolean;
  showFps: boolean;
}

export const DEFAULT_OPTIONS: Options = {
  layout: 'auto',
  scale: 100,
  theme: 'dark',
  colorBlindPalette: 'none',
  reduceMotion: false,
  reduceFlash: false,
  quality: 'auto',
  brushSize: 5,
  soundVolume: 80,
  musicVolume: 60,
  autoOpenContextTab: true,
  showFps: false,
};

/** Minimal storage surface; `localStorage` satisfies it. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTINGS_KEY = 'settings';

const LAYOUTS: readonly Layout[] = ['auto', 'compact', 'medium', 'expanded'];
const THEMES: readonly Theme[] = ['dark', 'light', 'highcontrast'];
const PALETTES: readonly ColorBlindPalette[] = ['none', 'deuteranopia', 'protanopia', 'tritanopia'];
const QUALITIES: readonly Quality[] = ['auto', 'low', 'medium', 'high'];

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Returns valid Options from any input: unknown keys are dropped, bad values fall back. */
export function sanitizeOptions(input: unknown): Options {
  const src = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_OPTIONS;
  return {
    layout: oneOf(src['layout'], LAYOUTS, d.layout),
    scale: clampInt(src['scale'], 70, 150, d.scale),
    theme: oneOf(src['theme'], THEMES, d.theme),
    colorBlindPalette: oneOf(src['colorBlindPalette'], PALETTES, d.colorBlindPalette),
    reduceMotion: boolOr(src['reduceMotion'], d.reduceMotion),
    reduceFlash: boolOr(src['reduceFlash'], d.reduceFlash),
    quality: oneOf(src['quality'], QUALITIES, d.quality),
    brushSize: clampInt(src['brushSize'], 1, 72, d.brushSize),
    soundVolume: clampInt(src['soundVolume'], 0, 100, d.soundVolume),
    musicVolume: clampInt(src['musicVolume'], 0, 100, d.musicVolume),
    autoOpenContextTab: boolOr(src['autoOpenContextTab'], d.autoOpenContextTab),
    showFps: boolOr(src['showFps'], d.showFps),
  };
}

/** Loads saved options; any storage failure or corrupt JSON yields the defaults. */
export function loadOptions(storage: KeyValueStorage | null): Options {
  if (!storage) return { ...DEFAULT_OPTIONS };
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (raw === null) return { ...DEFAULT_OPTIONS };
    return sanitizeOptions(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

/** Saves options; returns false when storage refused (quota, private mode). Never throws. */
export function saveOptions(storage: KeyValueStorage | null, options: Options): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeOptions(options)));
    return true;
  } catch {
    return false;
  }
}

/** Applies one change and returns the new, validated options. */
export function setOption<K extends keyof Options>(options: Options, key: K, value: Options[K]): Options {
  return sanitizeOptions({ ...options, [key]: value });
}
