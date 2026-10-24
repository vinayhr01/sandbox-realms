/**
 * Pure audio model (16 section B3 and B5): buses with clamped volumes and mutes, per-category and
 * global voice caps, lowest-priority voice stealing, and a hidden tab that mutes everything.
 * No WebAudio here; the audio engine reads `effectiveGain` and `voices` and applies them.
 * See src/audio/README.md for how this connects to WebAudio and the open items.
 */
export type Bus = 'master' | 'music' | 'sfx' | 'ui';

/** Priority: 0 is most important, 4 trivial (16 section B3). */
export type Priority = 0 | 1 | 2 | 3 | 4;

export interface Voice {
  readonly id: number;
  readonly category: string;
  readonly priority: Priority;
  readonly startedAt: number;
}

export interface PlayResult {
  /** Id of the new voice. */
  readonly id: number;
  /** Id of the voice dropped to make room, or null when nothing was dropped. */
  readonly stolen: number | null;
}

export const BUSES: readonly Bus[] = ['master', 'music', 'sfx', 'ui'];

/**
 * Bus each voice category plays through (16 section B5). The model has four buses, so the
 * world categories share `sfx`; stingers follow the music slider by default.
 */
export const CATEGORY_BUS: Readonly<Record<string, Bus>> = {
  ui: 'ui',
  stingers: 'music',
  calamity: 'sfx',
  combat: 'sfx',
  voices: 'sfx',
  work: 'sfx',
  ambience: 'sfx',
};

/** Bus for a category; unknown categories play through `sfx`. */
export function busForCategory(category: string): Bus {
  return Object.prototype.hasOwnProperty.call(CATEGORY_BUS, category) ? (CATEGORY_BUS[category] ?? 'sfx') : 'sfx';
}

export const CATEGORY_CAPS: Readonly<Record<string, number>> = {
  ui: 6,
  stingers: 2,
  calamity: 4,
  combat: 8,
  voices: 6,
  work: 6,
  ambience: 6,
};

/** Cap for a category that is not listed in CATEGORY_CAPS. */
export const DEFAULT_CATEGORY_CAP = 4;

/** Global cap on simultaneous voices (16 mobile, 24 desktop; desktop here). */
export const GLOBAL_CAP = 24;

export const DEFAULT_VOLUMES: Readonly<Record<Bus, number>> = { master: 1, music: 0.8, sfx: 0.9, ui: 0.9 };

/** Serialized form version written by serialize(). */
const SAVE_VERSION = 1;

/** NaN becomes 0; anything else is clamped into 0..1 (so Infinity becomes 1). */
const clamp01 = (v: number): number => (Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)));

const isPriority = (p: unknown): p is Priority => p === 0 || p === 1 || p === 2 || p === 3 || p === 4;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export class AudioModel {
  private readonly volumes: Record<Bus, number> = { ...DEFAULT_VOLUMES };
  private readonly muted: Record<Bus, boolean> = { master: false, music: false, sfx: false, ui: false };
  private hidden = false;
  private nextId = 1;
  private readonly list: Voice[] = [];

  /** Voices currently playing. Read-only from outside; change them through play() and release(). */
  get voices(): readonly Voice[] {
    return this.list;
  }

  /** Sets a bus volume. Values are clamped to 0..1; NaN becomes 0. The mute flag is untouched. */
  setVolume(bus: Bus, value: number): void {
    this.volumes[bus] = clamp01(value);
  }

  /** The saved volume of a bus, ignoring mute and hidden state. */
  volume(bus: Bus): number {
    return this.volumes[bus];
  }

  /** Mutes or unmutes one bus. The saved volume is kept, so unmuting restores it. */
  setMuted(bus: Bus, muted: boolean): void {
    this.muted[bus] = muted;
  }

  isMuted(bus: Bus): boolean {
    return this.muted[bus];
  }

  /** Hidden tabs play nothing (16 section B5 mute on hidden). Saved volumes and mutes are kept. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
  }

  isHidden(): boolean {
    return this.hidden;
  }

  /**
   * Gain a bus actually plays at. Zero when the tab is hidden, when the master is muted, or when
   * the bus itself is muted. Otherwise master times the bus volume (master itself for 'master').
   */
  effectiveGain(bus: Bus): number {
    if (this.hidden || this.muted.master || this.muted[bus]) return 0;
    return bus === 'master' ? this.volumes.master : this.volumes.master * this.volumes[bus];
  }

  /**
   * Starts a voice if the caps allow it.
   *
   * - If the category cap is full, the lowest-priority voice of that category is the candidate
   *   victim. If the global cap is also full, that same victim frees the global slot too.
   * - If only the global cap is full, the lowest-priority voice overall is the victim.
   * - A victim is dropped only when the new voice is strictly more important (lower number).
   *   Ties go to the oldest voice among the weakest.
   * - Nothing is changed when the voice is refused.
   *
   * Returns the new voice id and the dropped voice id (or null), or null when refused. Refused
   * when the tab is hidden, the priority is not 0..4, or no victim is weaker than the new voice.
   */
  play(category: string, priority: Priority, now: number): PlayResult | null {
    if (this.hidden || !isPriority(priority)) return null;
    const cap = Object.prototype.hasOwnProperty.call(CATEGORY_CAPS, category)
      ? (CATEGORY_CAPS[category] ?? DEFAULT_CATEGORY_CAP)
      : DEFAULT_CATEGORY_CAP;

    const inCategory = this.list.filter((v) => v.category === category);
    let victim: Voice | undefined;
    if (inCategory.length >= cap) {
      victim = weakest(inCategory);
      if (!victim || priority >= victim.priority) return null;
    } else if (this.list.length >= GLOBAL_CAP) {
      victim = weakest(this.list);
      if (!victim || priority >= victim.priority) return null;
    }

    if (victim) this.removeById(victim.id);
    const id = this.nextId++;
    this.list.push({ id, category, priority, startedAt: now });
    return { id, stolen: victim ? victim.id : null };
  }

  /** Ends a voice that finished on its own. Unknown ids are ignored. */
  release(id: number): void {
    this.removeById(id);
  }

  /**
   * Saves the bus volumes as a JSON string for the options panel. Mutes and hidden state are
   * not saved.
   */
  serialize(): string {
    return JSON.stringify({ v: SAVE_VERSION, volumes: { ...this.volumes } });
  }

  /**
   * Loads volumes saved by serialize(). Accepts the JSON string or an already parsed object.
   * Bad input never throws: an unparsable string, a non-object, or a missing `volumes` object
   * changes nothing and returns false. Within a valid object, each bus is read on its own: a
   * finite number is clamped into 0..1, and anything else (missing, non-number, NaN) keeps the
   * current volume. Returns true when a volumes object was found.
   */
  restore(input: unknown): boolean {
    let data: unknown = input;
    if (typeof input === 'string') {
      try {
        data = JSON.parse(input);
      } catch {
        return false;
      }
    }
    if (!isRecord(data) || !isRecord(data['volumes'])) return false;
    const saved = data['volumes'];
    for (const bus of BUSES) {
      const raw = saved[bus];
      if (typeof raw === 'number' && !Number.isNaN(raw)) this.volumes[bus] = clamp01(raw);
    }
    return true;
  }

  private removeById(id: number): void {
    const idx = this.list.findIndex((v) => v.id === id);
    if (idx >= 0) this.list.splice(idx, 1);
  }
}

/** Lowest priority (largest number) first; among equals the oldest goes. */
function weakest(list: readonly Voice[]): Voice | undefined {
  let best: Voice | undefined;
  for (const v of list) {
    if (!best || v.priority > best.priority || (v.priority === best.priority && v.startedAt < best.startedAt)) best = v;
  }
  return best;
}
