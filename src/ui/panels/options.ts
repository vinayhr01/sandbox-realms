/**
 * Settings model (13 section 15). Every row of the spec table has its id, type, range and default.
 * `live` marks the settings the running game reacts to; the others are stored and shown but have
 * no effect yet (their feature is not built). Values load and save through an injected storage
 * object; storage can throw (private windows, full quota), so every access is wrapped and falls
 * back to defaults.
 */

export type OptionGroup = 'display' | 'map' | 'marks' | 'hud' | 'input' | 'audio' | 'game' | 'perf' | 'lang' | 'privacy' | 'dev';
export type OptionValue = boolean | number | string;
export type Options = Readonly<Record<string, OptionValue>>;

export interface SettingDef {
  id: string;
  group: OptionGroup;
  label: string;
  kind: 'bool' | 'int' | 'choice';
  def: OptionValue;
  /** Int range (inclusive). */
  min?: number;
  max?: number;
  /** Choice values, in display order. */
  choices?: readonly OptionValue[];
  /** True when the running game reacts to the value. */
  live: boolean;
}

const B = (id: string, group: OptionGroup, label: string, def: boolean, live = false): SettingDef => ({ id, group, label, kind: 'bool', def, live });
const I = (id: string, group: OptionGroup, label: string, min: number, max: number, def: number, live = false): SettingDef => ({
  id,
  group,
  label,
  kind: 'int',
  def,
  min,
  max,
  live,
});
const C = (id: string, group: OptionGroup, label: string, choices: readonly OptionValue[], def: OptionValue, live = false): SettingDef => ({
  id,
  group,
  label,
  kind: 'choice',
  def,
  choices,
  live,
});

/** The spec's settings table, in spec order (13 section 15). */
export const SETTINGS: readonly SettingDef[] = [
  // Display
  C('ui.layout', 'display', 'Layout', ['auto', 'compact', 'medium', 'expanded'], 'auto'),
  I('ui.scale', 'display', 'UI scale (%)', 70, 150, 100, true),
  I('ui.scaleWindows', 'display', 'Window scale (%)', 60, 115, 100, true),
  I('ui.scaleTooltips', 'display', 'Tooltip scale (%)', 60, 150, 100, true),
  I('ui.scaleNames', 'display', 'Name scale (%)', 30, 160, 70),
  C('ui.theme', 'display', 'Colour theme', ['dark', 'light', 'highcontrast'], 'dark', true),
  C('ui.colorBlindPalette', 'display', 'Colour-blind palette', ['none', 'deuteranopia', 'protanopia', 'tritanopia'], 'none'),
  B('ui.reduceMotion', 'display', 'Reduce motion', false, true),
  B('ui.reduceFlash', 'display', 'Reduce flashing', false, true),
  B('ui.fullscreen', 'display', 'Full screen', false, true),
  B('ui.hideStatusBar', 'display', 'Hide status bar on phones', false),
  C('ui.fpsCap', 'display', 'Frame rate cap', [30, 60, 120, 0], 60, true),
  B('ui.showFps', 'display', 'Show frame rate', false, true),
  // Map
  I('map.layerOpacity', 'map', 'Layer opacity (%)', 30, 100, 88),
  I('map.layerBrightness', 'map', 'Layer brightness (%)', 60, 100, 100),
  B('map.nightLights', 'map', 'Night lights', true),
  B('map.shadows', 'map', 'Shadows', true),
  B('map.bloom', 'map', 'Bloom', true),
  B('map.vignette', 'map', 'Vignette', true),
  B('map.particles', 'map', 'Fire and smoke particles', true),
  B('map.treeWind', 'map', 'Tree sway', true),
  I('map.ageEffects', 'map', 'Age overlay (%)', 0, 100, 100),
  C('map.names', 'map', 'Nameplates', ['full', 'banner', 'off'], 'full'),
  B('map.favouritesOnlyNames', 'map', 'Nameplates for favourites only', false),
  B('map.cursorLights', 'map', 'Cursor lights', true),
  // Marks (the 7 mark toggles, 13 section 15)
  B('marks.favourites', 'marks', 'Mark favourites', true),
  B('marks.items', 'marks', 'Mark items', true),
  B('marks.intrigues', 'marks', 'Mark intrigues', true),
  B('marks.armies', 'marks', 'Mark armies', true),
  B('marks.battles', 'marks', 'Mark battles', true),
  B('marks.boats', 'marks', 'Mark boats', true),
  B('marks.campaigns', 'marks', 'Mark campaigns', true),
  // HUD
  B('ui.minimap', 'hud', 'Minimap', true),
  I('ui.minimapSize', 'hud', 'Minimap size (px)', 80, 256, 160),
  B('ui.worldTooltips', 'hud', 'World tooltips', true),
  B('ui.tips', 'hud', 'Tip messages', true),
  B('ui.talkBubbles', 'hud', 'Talk bubbles', true),
  B('ui.happinessIcons', 'hud', 'Happiness icons', false),
  B('ui.taskIcons', 'hud', 'Task icons', false),
  B('ui.moneyFlow', 'hud', 'Money flow', false),
  B('ui.cursorArrows', 'hud', 'Cursor arrows', false),
  B('ui.autoOpenContextTab', 'hud', 'Open context tab on select', true),
  B('ui.quickStrip', 'hud', 'Pinned quick strip', false),
  // Input
  B('input.touchOrder', 'input', 'Tap to order selected beings', false),
  B('input.stickyHold', 'input', 'Sticky hold', false),
  B('input.stepDrag', 'input', 'Step drag', false),
  B('input.haptics', 'input', 'Haptic feedback', true, true),
  I('input.panSpeed', 'input', 'Pan speed (%)', 50, 200, 100, true),
  I('input.zoomSpeed', 'input', 'Zoom speed (%)', 50, 200, 100, true),
  B('input.invertZoom', 'input', 'Invert zoom', false, true),
  B('input.edgePan', 'input', 'Edge pan', false, true),
  // Audio (volumes feed the audio model, which the audio engine applies)
  I('audio.master', 'audio', 'Master volume', 0, 100, 100, true),
  I('audio.music', 'audio', 'Music volume', 0, 100, 60, true),
  I('audio.sfx', 'audio', 'Effects volume', 0, 100, 100, true),
  I('audio.ui', 'audio', 'Interface volume', 0, 100, 80, true),
  B('audio.muteOnBlur', 'audio', 'Mute when hidden', true, true),
  B('audio.mono', 'audio', 'Mono sound', false, true),
  B('audio.visualCues', 'audio', 'Visual cues for sounds', false, true),
  B('audio.reduceLoud', 'audio', 'Reduce loud sounds', false, true),
  // Game
  B('game.autosave', 'game', 'Autosave', true),
  I('game.autosaveMinutes', 'game', 'Autosave every (min)', 1, 30, 5),
  I('game.autosaveKeep', 'game', 'Autosaves kept', 3, 30, 10),
  B('game.confirmQuit', 'game', 'Confirm before leaving a realm', true, true),
  B('game.pauseOnBlur', 'game', 'Pause when the window loses focus', false),
  C('game.defaultSpeed', 'game', 'Starting speed', ['0.5x', '1x', '2x', '5x', '10x'], '1x', true),
  B('game.disasters', 'game', 'Natural disasters', true),
  B('game.experimentalRules', 'game', 'Show experimental rules', false, true),
  // Performance
  B('perf.preloadWindows', 'perf', 'Preload windows', true),
  I('perf.maxBeingsHint', 'perf', 'Beings hint (0 = auto)', 0, 5000, 0),
  I('perf.simBudgetMs', 'perf', 'Sim time budget (ms)', 4, 16, 8),
  I('perf.renderScale', 'perf', 'Render scale (%)', 50, 100, 100),
  // Language and privacy
  C('lang', 'lang', 'Language', ['auto', 'en'], 'auto'),
  B('privacy.telemetry', 'privacy', 'Share anonymous usage data', false),
  B('privacy.errorReports', 'privacy', 'Send error reports', false),
  // Developer
  B('dev.enabled', 'dev', 'Developer tools', false),
];

export const SETTING_BY_ID = new Map(SETTINGS.map((s) => [s.id, s]));

export const GROUP_LABELS: Readonly<Record<OptionGroup, string>> = {
  display: 'Display',
  map: 'Map',
  marks: 'Marks',
  hud: 'Interface',
  input: 'Input',
  audio: 'Audio',
  game: 'Game',
  perf: 'Performance',
  lang: 'Language',
  privacy: 'Privacy',
  dev: 'Developer',
};

export const DEFAULT_OPTIONS: Options = Object.freeze(Object.fromEntries(SETTINGS.map((s) => [s.id, s.def])));

/** Minimal storage surface; `localStorage` satisfies it. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTINGS_KEY = 'settings';

/** Returns a valid option set. Unknown keys are dropped; bad or missing values fall back to `base`. */
export function sanitizeOptions(input: unknown, base: Options = DEFAULT_OPTIONS): Options {
  const src = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const out: Record<string, OptionValue> = {};
  for (const s of SETTINGS) {
    const raw = src[s.id];
    const fallback = base[s.id] ?? s.def;
    if (raw === undefined) {
      out[s.id] = fallback;
      continue;
    }
    if (s.kind === 'bool') {
      out[s.id] = typeof raw === 'boolean' ? raw : fallback;
    } else if (s.kind === 'int') {
      out[s.id] = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(s.max ?? raw, Math.max(s.min ?? raw, Math.round(raw))) : fallback;
    } else {
      out[s.id] = (s.choices ?? []).includes(raw as OptionValue) ? (raw as OptionValue) : fallback;
    }
  }
  return out;
}

/** Loads saved options; any storage failure or corrupt JSON yields the base (defaults). */
export function loadOptions(storage: KeyValueStorage | null, base: Options = DEFAULT_OPTIONS): Options {
  if (!storage) return sanitizeOptions({}, base);
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (raw === null) return sanitizeOptions({}, base);
    return sanitizeOptions(JSON.parse(raw), base);
  } catch {
    return sanitizeOptions({}, base);
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

/** Applies one change and returns the new, validated options. Unknown ids are ignored. */
export function setOption(options: Options, id: string, value: OptionValue): Options {
  return sanitizeOptions({ ...options, [id]: value }, options);
}

/** Restores every setting in one group to its default. */
export function resetGroup(options: Options, group: OptionGroup): Options {
  const next: Record<string, OptionValue> = { ...options };
  for (const s of SETTINGS) if (s.group === group) next[s.id] = s.def;
  return sanitizeOptions(next, DEFAULT_OPTIONS);
}

export function numberOption(options: Options, id: string): number {
  const v = options[id];
  return typeof v === 'number' ? v : Number(SETTING_BY_ID.get(id)?.def ?? 0);
}

export function boolOption(options: Options, id: string): boolean {
  const v = options[id];
  return typeof v === 'boolean' ? v : false;
}

export function stringOption(options: Options, id: string): string {
  const v = options[id];
  return typeof v === 'string' ? v : String(SETTING_BY_ID.get(id)?.def ?? '');
}
