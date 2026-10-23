/**
 * Pure audio model (16 section B3 and B5): buses with clamped volumes, per-category voice caps,
 * the lowest-priority voice is stolen when a cap is reached, and a hidden tab mutes everything.
 * No WebAudio here; the audio engine reads `effectiveGain` and `voices` and applies them.
 */
export type Bus = 'master' | 'music' | 'sfx' | 'ui';

/** Priority: 0 is most important, 4 trivial (16 section B3). */
export type Priority = 0 | 1 | 2 | 3 | 4;

export interface Voice {
  id: number;
  category: string;
  priority: Priority;
  startedAt: number;
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

/** Global cap on simultaneous voices (16 mobile, 24 desktop; desktop here). */
export const GLOBAL_CAP = 24;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export class AudioModel {
  private readonly volumes: Record<Bus, number> = { master: 1, music: 0.8, sfx: 0.9, ui: 0.9 };
  private hidden = false;
  private nextId = 1;
  readonly voices: Voice[] = [];

  setVolume(bus: Bus, value: number): void {
    this.volumes[bus] = clamp01(value);
  }

  volume(bus: Bus): number {
    return this.volumes[bus];
  }

  /** Hidden tabs play nothing (16 section B5 mute on hidden). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
  }

  /** Gain a bus actually plays at: master times the bus, zero when hidden. */
  effectiveGain(bus: Exclude<Bus, 'master'>): number {
    if (this.hidden) return 0;
    return this.volumes.master * this.volumes[bus];
  }

  /**
   * Starts a voice if the caps allow it. When the category cap or the global cap is full, the
   * lowest-priority voice (the oldest among equals) is stolen, but only when the new voice is more
   * important. Returns the new voice id and the stolen voice id (or null), or null when refused.
   */
  play(category: string, priority: Priority, now: number): { id: number; stolen: number | null } | null {
    if (this.hidden) return null;
    const cap = CATEGORY_CAPS[category] ?? 4;
    let stolen: number | null = null;
    const inCategory = this.voices.filter((v) => v.category === category);
    if (inCategory.length >= cap) {
      const victim = weakest(inCategory);
      if (!victim || victim.priority <= priority) return null;
      stolen = this.remove(victim.id);
    }
    if (this.voices.length >= GLOBAL_CAP) {
      const victim = weakest(this.voices);
      if (!victim || victim.priority <= priority) return null;
      stolen = this.remove(victim.id);
    }
    const id = this.nextId++;
    this.voices.push({ id, category, priority, startedAt: now });
    return { id, stolen };
  }

  /** Ends a voice that finished on its own. */
  release(id: number): void {
    this.remove(id);
  }

  private remove(id: number): number {
    const idx = this.voices.findIndex((v) => v.id === id);
    if (idx >= 0) this.voices.splice(idx, 1);
    return id;
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
