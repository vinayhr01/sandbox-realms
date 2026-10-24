/**
 * Visual cues, captions and haptics for audio events (16 B9 "Visual sound cues" and "Haptics",
 * 16 A7 sound-visual pulse, 13 section 14 "audio cues have visual equivalents").
 *
 * The pure half (tables, option reading, the Age and war watch, the off-screen test) is tested in
 * Node. The DOM half is `CueOverlay`: one caption line and four screen-edge pulses, mounted once.
 * Nothing here touches the simulation.
 */
import { SOUND_BY_ID } from '../audio/sounds.ts';
import { boolOption, type Options } from './panels/options.ts';

/** Captions for stingers (16 B9: "a caption line for stingers"). Speech is never captioned: voices are non-verbal (13 section 14). */
export const STINGER_CAPTIONS: Readonly<Record<string, string>> = {
  stg_age_change: 'A new Age begins',
  stg_war_declared: 'War is declared',
  stg_peace: 'Peace settles on the realm',
  stg_pact_formed: 'A pact is formed',
  stg_ruler_crowned: 'A ruler is crowned',
  stg_dominion_fallen: 'A dominion has fallen',
  stg_calamity_warning: 'A calamity is coming',
  stg_achievement: 'Achievement unlocked',
};

/** Haptic patterns in milliseconds (16 B9): UI confirm, a hit on the selected being, the calamity peak. */
export const HAPTIC_PATTERNS: Readonly<Record<string, readonly number[]>> = {
  ui_confirm: [8],
  cmb_hit_blunt: [12],
  cmb_hit_blade: [12],
  cal_storm_peak: [30, 40, 30],
  cal_quake: [30, 40, 30],
  exp_large: [30, 40, 30],
};

/** The four options this module reads from the saved settings. Absent keys read as off. */
export interface CueOptions {
  visualCues: boolean;
  mono: boolean;
  reduceLoudSounds: boolean;
  haptics: boolean;
}

export function cueOptionsFrom(options: Options): CueOptions {
  return {
    visualCues: boolOption(options, 'audio.visualCues'),
    mono: boolOption(options, 'audio.mono'),
    reduceLoudSounds: boolOption(options, 'audio.reduceLoud'),
    haptics: boolOption(options, 'input.haptics'),
  };
}

/** The caption for a sound when the visual cues option is on; null for everything else. */
export function captionFor(soundId: string, visualCues: boolean): string | null {
  if (!visualCues) return null;
  return STINGER_CAPTIONS[soundId] ?? null;
}

/**
 * The vibration pattern for a sound, or null. Off unless the haptics option is on. Pure; the
 * device call is `vibrate`.
 */
export function hapticPattern(soundId: string, haptics: boolean): readonly number[] | null {
  if (!haptics) return null;
  return HAPTIC_PATTERNS[soundId] ?? null;
}

/**
 * Calls navigator.vibrate when the device has it. Unsupported platforms (iOS Safari, desktops)
 * are a no-op, and a throwing implementation never breaks the caller. Returns true when a
 * vibration was requested.
 */
export function vibrate(pattern: readonly number[] | null, nav: { vibrate?: (p: number | number[]) => boolean } | undefined = globalThis.navigator): boolean {
  if (!pattern || !nav || typeof nav.vibrate !== 'function') return false;
  try {
    nav.vibrate([...pattern]);
    return true;
  } catch {
    return false;
  }
}

export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';

/** Which screen edge a point lies beyond, or null when it is on screen. */
export function offscreenSide(x: number, y: number, width: number, height: number): EdgeSide | null {
  if (x < 0) return 'left';
  if (x > width) return 'right';
  if (y < 0) return 'top';
  if (y > height) return 'bottom';
  return null;
}

/**
 * Whether a sound gets the sound-visual pulse (16 A7): priority 0 or 1 sounds whose source is
 * off screen. Unknown sound ids never pulse.
 */
export function pulsesWhenOffscreen(soundId: string): boolean {
  const def = SOUND_BY_ID.get(soundId);
  return def !== undefined && def.priority <= 1;
}

/**
 * Turns the snapshot feed into stinger ids (16 B9 captions): an Age change, the first dominion at
 * war, and the last one standing down. The first snapshot only sets the baseline, so loading a
 * realm plays nothing.
 */
export class StingerWatch {
  private age: string | null = null;
  private warring: boolean | null = null;
  private seeded = false;

  ingest(age: string | null, warCount: number): string[] {
    const out: string[] = [];
    const war = warCount > 0;
    if (!this.seeded) {
      this.seeded = true;
    } else {
      if (age !== null && this.age !== null && age !== this.age) out.push('stg_age_change');
      if (this.warring !== null && war !== this.warring) out.push(war ? 'stg_war_declared' : 'stg_peace');
    }
    if (age !== null) this.age = age;
    this.warring = war;
    return out;
  }
}

const PULSE_MS = 600;
const CAPTION_MS = 2500;
const EDGES: readonly EdgeSide[] = ['left', 'right', 'top', 'bottom'];

/**
 * The caption line and the edge pulses. Created once; hidden entirely while the visual cues option
 * is off. Motion is left to CSS, which already turns animations off under reduced motion, so a
 * pulse then shows as a static edge for its duration. Each pulse runs once, far below 3 per second.
 */
export class CueOverlay {
  private readonly root: HTMLElement;
  private readonly line: HTMLElement;
  private readonly edges = new Map<EdgeSide, HTMLElement>();
  private captionTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pulseTimers = new Map<EdgeSide, ReturnType<typeof setTimeout>>();
  private enabled = false;

  constructor(doc: Document, parent: HTMLElement = doc.body) {
    this.root = doc.createElement('div');
    this.root.className = 'audio-cues';
    this.root.hidden = true;
    for (const side of EDGES) {
      const edge = doc.createElement('div');
      edge.className = `cue-edge cue-edge-${side}`;
      edge.setAttribute('aria-hidden', 'true');
      this.edges.set(side, edge);
      this.root.appendChild(edge);
    }
    this.line = doc.createElement('div');
    this.line.className = 'cue-caption';
    this.line.setAttribute('role', 'status');
    this.line.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.line);
    parent.appendChild(this.root);
  }

  /** Shows or hides the whole layer. Hiding clears any caption or pulse on screen. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.root.hidden = !on;
    if (!on) this.clear();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Shows a caption line for a few seconds; the newest caption replaces the old one. */
  caption(text: string | null): void {
    if (!this.enabled || !text) return;
    this.line.textContent = text;
    this.line.classList.add('visible');
    if (this.captionTimer !== null) clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => {
      this.line.classList.remove('visible');
      this.captionTimer = null;
    }, CAPTION_MS);
  }

  /** Pulses the screen edge nearest an off-screen source. */
  pulse(side: EdgeSide): void {
    if (!this.enabled) return;
    const edge = this.edges.get(side);
    if (!edge) return;
    edge.classList.add('on');
    const old = this.pulseTimers.get(side);
    if (old !== undefined) clearTimeout(old);
    this.pulseTimers.set(
      side,
      setTimeout(() => {
        edge.classList.remove('on');
        this.pulseTimers.delete(side);
      }, PULSE_MS),
    );
  }

  private clear(): void {
    if (this.captionTimer !== null) clearTimeout(this.captionTimer);
    this.captionTimer = null;
    this.line.classList.remove('visible');
    for (const [side, timer] of this.pulseTimers) {
      clearTimeout(timer);
      this.edges.get(side)?.classList.remove('on');
    }
    this.pulseTimers.clear();
  }
}
