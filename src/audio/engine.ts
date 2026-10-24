/**
 * WebAudio adapter (16 section B5 and B6). Thin on purpose: every decision (caps, steals, cooldowns,
 * mutes, hidden tab, gains) comes from the pure model, sounds.ts, options.ts and mix.ts. This file
 * creates the node graph and applies those results. The simulation never imports it.
 *
 * Graph: voice -> amp (distance) -> panner (spatial sounds) -> [voices | ambience sub-bus] -> sfx bus
 * (or the category's own bus) -> master -> compressor (limiter) -> destination.
 */
import { AudioModel, BUSES, busForCategory, type Bus } from './model.ts';
import { DEFAULT_AUDIO_OPTIONS, optionOfCategory, sliderToGain, type AudioOptions } from './options.ts';
import { dbToGain } from './mix.ts';
import { SOUND_BY_ID, canStart, type SoundDef } from './sounds.ts';
import { renderSound } from './synth.ts';

/** Gain changes use a 30 ms time constant to avoid zipper noise (B5). */
const TIME_CONSTANT = 0.03;
/** Limiter settings from B5; "reduce loud sounds" lowers the threshold and the master. */
const LIMIT_DB = -3;
const LIMIT_REDUCED_DB = -10;
const MASTER_REDUCED_DB = -4;
/** Music ducking: the dip and the recovery time constants in seconds (B5). */
const DUCK_ATTACK = 0.01;
const DUCK_RELEASE = 0.2;

export interface ParamLike {
  value: number;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): void;
}
export interface NodeLike {
  connect(dest: NodeLike): void;
  disconnect(): void;
}
export interface GainLike extends NodeLike {
  readonly gain: ParamLike;
}
export interface PannerLike extends NodeLike {
  readonly pan: ParamLike;
}
export interface CompressorLike extends NodeLike {
  readonly threshold: ParamLike;
  readonly knee: ParamLike;
  readonly ratio: ParamLike;
  readonly attack: ParamLike;
  readonly release: ParamLike;
}
export interface BufferLike {
  copyToChannel(data: Float32Array, channel: number): void;
}
export interface SourceLike extends NodeLike {
  buffer: BufferLike | null;
  loop: boolean;
  onended: (() => void) | null;
  start(): void;
  stop(): void;
}
/** The subset of BaseAudioContext the engine uses. A fake satisfies it in tests. */
export interface ContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: NodeLike;
  createGain(): GainLike;
  createStereoPanner(): PannerLike;
  createDynamicsCompressor(): CompressorLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createBufferSource(): SourceLike;
  resume(): Promise<unknown>;
}

export type ContextFactory = () => ContextLike;

interface Voice {
  source: SourceLike;
  soundId: string;
}

/** The default factory: one interactive AudioContext, created only from a user gesture (B6). */
export function browserContextFactory(): ContextLike {
  return new AudioContext({ latencyHint: 'interactive' }) as unknown as ContextLike;
}

export class AudioEngine {
  readonly model = new AudioModel();
  private options: AudioOptions = { ...DEFAULT_AUDIO_OPTIONS, volumes: { ...DEFAULT_AUDIO_OPTIONS.volumes } };
  private ctx: ContextLike | null = null;
  private master: GainLike | null = null;
  private compressor: CompressorLike | null = null;
  private readonly busNodes = new Map<Bus, GainLike>();
  private readonly subNodes = new Map<'voices' | 'ambience', GainLike>();
  private readonly buffers = new Map<string, BufferLike>();
  private readonly voices = new Map<number, Voice>();
  private readonly lastStart = new Map<string, number>();

  constructor(private readonly makeContext: ContextFactory = browserContextFactory) {}

  /** True once unlock() has created the graph. Before that, play() returns false and plays nothing. */
  get started(): boolean {
    return this.ctx !== null;
  }

  /** The current options as applied. */
  get currentOptions(): AudioOptions {
    return this.options;
  }

  /**
   * Creates the context and the graph on the first user gesture, then resumes it (B6). Calling it
   * again only resumes the context. Events before this call are dropped, not queued.
   */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = this.makeContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = LIMIT_DB;
    comp.knee.value = 0;
    comp.ratio.value = 20;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    comp.connect(ctx.destination);
    this.compressor = comp;

    const master = ctx.createGain();
    master.connect(comp);
    this.master = master;
    this.busNodes.set('master', master);

    for (const bus of BUSES) {
      if (bus === 'master') continue;
      const node = ctx.createGain();
      node.connect(master);
      this.busNodes.set(bus, node);
    }
    const sfx = this.busNodes.get('sfx');
    for (const sub of ['voices', 'ambience'] as const) {
      const node = ctx.createGain();
      if (sfx) node.connect(sfx);
      this.subNodes.set(sub, node);
    }
    this.applyOptions(this.options);
    void ctx.resume();
  }

  /**
   * Applies the options: bus volumes from the sliders (B9), the voices and ambience sub-buses, the
   * limiter and master trim for "reduce loud sounds", and the hidden-tab rule for this setting.
   */
  applyOptions(options: AudioOptions): void {
    this.options = { ...options, volumes: { ...options.volumes } };
    const v = options.volumes;
    this.model.setVolume('master', sliderToGain(v.master));
    this.model.setVolume('music', sliderToGain(v.music));
    this.model.setVolume('sfx', sliderToGain(v.effects));
    this.model.setVolume('ui', sliderToGain(v.ui));
    if (this.ctx && this.compressor) {
      this.compressor.threshold.value = options.reduceLoudSounds ? LIMIT_REDUCED_DB : LIMIT_DB;
    }
    this.subNodes.get('voices')?.gain.setTargetAtTime(sliderToGain(v.voices), this.now(), TIME_CONSTANT);
    this.subNodes.get('ambience')?.gain.setTargetAtTime(sliderToGain(v.ambience), this.now(), TIME_CONSTANT);
    this.model.setHidden(this.model.isHidden() && options.muteWhenHidden);
    this.applyGains();
  }

  /** Hidden tab (B6): the model mutes every bus and refuses new voices, when the option says so. */
  setHidden(hidden: boolean): void {
    this.model.setHidden(hidden && this.options.muteWhenHidden);
    this.applyGains();
  }

  /** Sets every bus node from the model, at the 30 ms time constant. */
  applyGains(): void {
    if (!this.ctx) return;
    const now = this.now();
    const muteAll = this.model.isHidden() || this.model.isMuted('master');
    const reduce = this.options.reduceLoudSounds ? dbToGain(MASTER_REDUCED_DB) : 1;
    this.master?.gain.setTargetAtTime(muteAll ? 0 : this.model.volume('master') * reduce, now, TIME_CONSTANT);
    for (const bus of BUSES) {
      if (bus === 'master') continue;
      const silent = this.model.isHidden() || this.model.isMuted(bus);
      this.busNodes.get(bus)?.gain.setTargetAtTime(silent ? 0 : this.model.volume(bus), now, TIME_CONSTANT);
    }
  }

  /**
   * Starts a sound now if the model and the sound's own rules allow it. `pan` is -1..1 and
   * `distance` a 0..1 gain (both from mix.ts for spatial sounds; 0 and 1 for flat ones). Returns
   * true when a voice started.
   */
  play(id: string, nowMs: number, pan = 0, distance = 1): boolean {
    const ctx = this.ctx;
    const def = SOUND_BY_ID.get(id);
    if (!ctx || !def) return false;
    const bus = busForCategory(def.category);
    if (this.model.isHidden() || this.model.effectiveGain(bus) === 0) return false;
    if (!canStart(def, this.lastStart.get(id), this.countPlaying(id), nowMs)) return false;
    const grant = this.model.play(def.category, def.priority, nowMs);
    if (!grant) return false;
    if (grant.stolen !== null) this.stopVoice(grant.stolen);

    const source = ctx.createBufferSource();
    source.buffer = this.bufferFor(def, ctx);
    source.loop = def.loop;
    const amp = ctx.createGain();
    amp.gain.value = Math.max(0, Math.min(1, distance));
    source.connect(amp);
    let out: NodeLike = amp;
    if (def.spatial) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      amp.connect(panner);
      out = panner;
    }
    const sub = optionOfCategory(def.category);
    const subNode = sub === 'voices' || sub === 'ambience' ? this.subNodes.get(sub) : undefined;
    out.connect(subNode ?? this.busNodes.get(bus) ?? this.master ?? ctx.destination);
    source.onended = () => this.finish(grant.id);

    this.voices.set(grant.id, { source, soundId: id });
    this.lastStart.set(id, nowMs);
    if (def.ducksMusicDb > 0 && def.priority <= 1) this.duckMusic(def.ducksMusicDb);
    source.start();
    return true;
  }

  /** Stops every playing copy of one sound (for example a bed that is no longer wanted). */
  stopSound(id: string): void {
    for (const [voice, info] of [...this.voices]) if (info.soundId === id) this.stopVoice(voice);
  }

  /** Stops every voice; the model is cleared by the release callbacks. */
  stopAll(): void {
    for (const voice of [...this.voices.keys()]) this.stopVoice(voice);
  }

  private stopVoice(voice: number): void {
    const info = this.voices.get(voice);
    if (!info) return;
    this.voices.delete(voice);
    this.model.release(voice);
    try {
      info.source.stop();
    } catch {
      // Already ended: nothing to stop.
    }
  }

  private finish(voice: number): void {
    this.voices.delete(voice);
    this.model.release(voice);
  }

  private countPlaying(id: string): number {
    let n = 0;
    for (const info of this.voices.values()) if (info.soundId === id) n++;
    return n;
  }

  /** Ramps the music bus down by `db` and back (B5 ducking). */
  private duckMusic(db: number): void {
    const ctx = this.ctx;
    const music = this.busNodes.get('music');
    if (!ctx || !music) return;
    const now = ctx.currentTime;
    const base = this.model.isMuted('music') ? 0 : this.model.volume('music');
    music.gain.setTargetAtTime(base * dbToGain(-db), now, DUCK_ATTACK);
    music.gain.setTargetAtTime(base, now + 0.6, DUCK_RELEASE);
  }

  private bufferFor(def: SoundDef, ctx: ContextLike): BufferLike {
    const cached = this.buffers.get(def.id);
    if (cached) return cached;
    const data = renderSound(def, ctx.sampleRate);
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.copyToChannel(data, 0);
    this.buffers.set(def.id, buffer);
    return buffer;
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }
}
