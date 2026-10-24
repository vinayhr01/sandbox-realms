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
import { SOUND_BY_ID, ageBedLevelDb, canStart, type SoundDef } from './sounds.ts';
import { renderSound } from './synth.ts';
import {
  LAYER_CAP_DESKTOP,
  OPEN_CUTOFF_HZ,
  STEPS_PER_LOOP,
  STEM_DEFS,
  barStepAtOrAfter,
  capLayers,
  musicCutoffHz,
  noteSeconds,
  shouldStop,
  silenceSince,
  silentMusicState,
  stemTargets,
  stemTau,
  stepAtOrAfter,
  stepTime,
  stepValue,
  variantFor,
  degreeHz,
  type MusicState,
  type StemDef,
} from './music.ts';
import { NO_RESTS, RestPlanner, applyRests, sameRests, type Rests } from './breathing.ts';

/** Gain changes use a 30 ms time constant to avoid zipper noise (B5). */
const TIME_CONSTANT = 0.03;
/** Limiter settings from B5; "reduce loud sounds" lowers the threshold and the master. */
const LIMIT_DB = -3;
const LIMIT_REDUCED_DB = -10;
const MASTER_REDUCED_DB = -4;
/** Music ducking: the dip and the recovery time constants in seconds (B5). */
const DUCK_ATTACK = 0.01;
const DUCK_RELEASE = 0.2;
/** Age change crossfade of the bed level (B "Audio loudness by Age": 4 s), and the bed A/B crossfade. */
const AGE_TRIM_TAU_S = 1.3;
const BED_XFADE_TAU_S = 1.0;

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
  /** Channel layout, set on the master for the mono option (16 B9). */
  channelCount?: number;
  channelCountMode?: string;
  channelInterpretation?: string;
}
export interface OscLike extends NodeLike {
  type: string;
  readonly frequency: ParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface FilterLike extends NodeLike {
  type: string;
  readonly frequency: ParamLike;
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
  start(when?: number): void;
  stop(when?: number): void;
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
  /** Only the music needs these. The engine checks for them and keeps the music off without them. */
  createOscillator?(): OscLike;
  createBiquadFilter?(): FilterLike;
}

export type ContextFactory = () => ContextLike;

/** Scheduler tick and look-ahead for music (16 B5: timer 100 ms, schedules up to 400 ms ahead). */
const SCHEDULE_TICK_MS = 100;
const SCHEDULE_AHEAD_S = 0.4;

/** One stem that is playing: its gain node, its drone oscillators, and where its pattern has reached. */
interface StemVoice {
  def: StemDef;
  gain: GainLike;
  drones: OscLike[];
  /**
   * Drones with a B voicing: one gain per voicing, crossfaded at loop boundaries (B8 Bed A/B). A
   * voicing's oscillators are built the first time it is heard, so a bed that never switches stays
   * at one voicing's oscillators.
   */
  alt: { gains: [GainLike, GainLike]; built: [boolean, boolean] } | null;
  startStep: number;
  nextStep: number;
  level: number;
  silentSince: number | null;
}

/** Mono downmix (16 B9): the master sums to one channel; the stereo panners still act before it. */
function setDownmix(node: GainLike, mono: boolean): void {
  node.channelCount = mono ? 1 : 2;
  node.channelCountMode = mono ? 'explicit' : 'max';
  node.channelInterpretation = 'speakers';
}

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
  private musicState: MusicState = silentMusicState();
  private musicOrigin = 0;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private readonly stems = new Map<string, StemVoice>();
  private noise: BufferLike | null = null;
  private layerCap = LAYER_CAP_DESKTOP;
  /** Music bus chain: music bus -> ageTrim (Age loudness) -> musicFilter (overview and pause) -> master. */
  private ageTrim: GainLike | null = null;
  private musicFilter: FilterLike | null = null;
  private ageId: string | null | undefined = undefined;
  private readonly rests = new RestPlanner();
  private restState: Rests = NO_RESTS;
  private bedLoop = -1;

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

    // Music goes through the Age trim and the overview and pause low-pass (B5, B8 rule 5).
    const musicFilter = ctx.createBiquadFilter ? ctx.createBiquadFilter() : null;
    if (musicFilter) {
      musicFilter.type = 'lowpass';
      musicFilter.frequency.value = OPEN_CUTOFF_HZ;
      musicFilter.connect(master);
      this.musicFilter = musicFilter;
    }
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
    // The music bus goes through the Age trim, then the filter, then master (created last so the
    // earlier node order is unchanged).
    const ageTrim = ctx.createGain();
    ageTrim.connect(musicFilter ?? master);
    this.ageTrim = ageTrim;
    const musicBus = this.busNodes.get('music');
    if (musicBus) {
      musicBus.disconnect();
      musicBus.connect(ageTrim);
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
    if (this.master) setDownmix(this.master, options.mono);
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
    // A panned cue gets a panner even when its sound is not spatial, so world-positioned UI cues pan too.
    if (def.spatial || pan !== 0) {
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

  /** True while the music scheduler runs. */
  get musicPlaying(): boolean {
    return this.musicTimer !== null;
  }

  /** Layers allowed at once: 6 on phones, 9 on desktop (16 B8 rule 2). */
  setLayerCap(max: number): void {
    this.layerCap = Math.max(2, Math.floor(max));
  }

  /**
   * Starts the adaptive music on the audio clock (16 B8). Needs an unlocked context that can make
   * oscillators; otherwise it does nothing. Stems join on bar boundaries as the state asks for them.
   */
  startMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.musicTimer !== null || !ctx.createOscillator) return;
    this.musicOrigin = ctx.currentTime;
    if (!this.noise) {
      // One second of white noise, shared by every percussion hit. Cosmetic only: it never touches the sim.
      const length = Math.floor(ctx.sampleRate);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = new Float32Array(length);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      buffer.copyToChannel(data, 0);
      this.noise = buffer;
    }
    this.rests.reset();
    this.restState = NO_RESTS;
    this.bedLoop = -1;
    this.musicTimer = setInterval(() => this.scheduleMusic(), SCHEDULE_TICK_MS);
    this.updateStems();
    this.scheduleMusic();
  }

  /** Stops the music and every stem. The graph stays for the next start. */
  stopMusic(): void {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
    for (const id of [...this.stems.keys()]) this.stopStem(id);
  }

  /** The state the stems follow. The game loop publishes it about once a second (16 B8). */
  setMusicState(state: MusicState): void {
    this.musicState = state;
    this.updateStems();
    this.updateMusicBus(state);
  }

  /**
   * The music bus low-pass (open, overview, or paused; B5 and B8 rule 5) and the Age loudness trim,
   * which crossfades when the Age changes (16 "Audio loudness by Age").
   */
  private updateMusicBus(state: MusicState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.musicFilter?.frequency.setTargetAtTime(musicCutoffHz(state), now, TIME_CONSTANT * 10);
    if (state.ageId !== this.ageId) {
      this.ageId = state.ageId;
      this.ageTrim?.gain.setTargetAtTime(dbToGain(ageBedLevelDb(state.ageId ?? '')), now, AGE_TRIM_TAU_S);
    }
  }

  /** Moves each stem toward its capped target, less any rests. Smoothing uses the attack and release constants. */
  private updateStems(): void {
    const ctx = this.ctx;
    if (!ctx || this.musicTimer === null) return;
    const capped = capLayers(stemTargets(this.musicState), STEM_DEFS, this.layerCap);
    const targets = applyRests(capped, this.restState, STEM_DEFS);
    const now = ctx.currentTime;
    const nowMs = performance.now();
    for (const def of STEM_DEFS) {
      const target = targets[def.id] ?? 0;
      const voice = this.stems.get(def.id) ?? (target > 0 ? this.startStem(def, now) : null);
      if (!voice) continue;
      voice.gain.gain.setTargetAtTime(target, now, stemTau(def, target > voice.level));
      voice.level = target;
      voice.silentSince = silenceSince(voice.silentSince, target, nowMs);
      if (shouldStop(voice.silentSince, nowMs)) this.stopStem(def.id);
    }
  }

  /**
   * Creates a stem's gain node and, for drones, its oscillators, starting on the next bar. A drone
   * with a B voicing gets one gain per voicing; applyBedVariants picks which one is heard.
   */
  private startStem(def: StemDef, now: number): StemVoice | null {
    const ctx = this.ctx;
    const bus = this.busNodes.get('music');
    if (!ctx || !bus || !ctx.createOscillator) return null;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(bus);
    const startStep = barStepAtOrAfter(this.musicOrigin, now);
    const at = stepTime(this.musicOrigin, startStep);
    const drones: OscLike[] = [];
    let alt: StemVoice['alt'] = null;
    if (def.kind === 'drone') {
      if (def.alt) {
        const variant = variantFor(Math.floor(stepAtOrAfter(this.musicOrigin, now) / STEPS_PER_LOOP), def.id);
        const a = ctx.createGain();
        const b = ctx.createGain();
        a.gain.value = variant === 0 ? 1 : 0;
        b.gain.value = variant === 1 ? 1 : 0;
        a.connect(gain);
        b.connect(gain);
        alt = { gains: [a, b], built: [false, false] };
        this.buildVoicing(ctx, variant === 0 ? a : b, variant === 0 ? def : def.alt, at, drones);
        alt.built[variant] = true;
      } else {
        this.buildVoicing(ctx, gain, def, at, drones);
      }
    }
    const voice: StemVoice = { def, gain, drones, alt, startStep, nextStep: startStep, level: 0, silentSince: null };
    this.stems.set(def.id, voice);
    return voice;
  }

  /** Starts one drone voicing (oscillators on a chord) into `dest`; the oscillators are added to `into`. */
  private buildVoicing(
    ctx: ContextLike,
    dest: GainLike,
    voicing: { wave: string; octave: number; chord: readonly number[] },
    at: number,
    into: OscLike[],
  ): void {
    if (!ctx.createOscillator) return;
    for (const degree of voicing.chord) {
      const osc = ctx.createOscillator();
      osc.type = voicing.wave;
      osc.frequency.value = degreeHz(degree, voicing.octave);
      osc.connect(dest);
      osc.start(at);
      into.push(osc);
    }
  }

  /**
   * Crossfades every A/B drone to the voicing its loop asks for (B8: Bed A/B alternate at loop
   * boundaries). A voicing heard for the first time gets its oscillators now.
   */
  private applyBedVariants(loop: number, now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const voice of this.stems.values()) {
      if (!voice.alt) continue;
      const variant = variantFor(loop, voice.def.id);
      const idx: 0 | 1 = variant;
      if (!voice.alt.built[idx]) {
        const voicing = idx === 0 ? voice.def : voice.def.alt;
        if (voicing) this.buildVoicing(ctx, voice.alt.gains[idx], voicing, now, voice.drones);
        voice.alt.built[idx] = true;
      }
      voice.alt.gains[0].gain.setTargetAtTime(variant === 0 ? 1 : 0, now, BED_XFADE_TAU_S);
      voice.alt.gains[1].gain.setTargetAtTime(variant === 1 ? 1 : 0, now, BED_XFADE_TAU_S);
    }
  }

  private stopStem(id: string): void {
    const voice = this.stems.get(id);
    if (!voice) return;
    this.stems.delete(id);
    for (const osc of voice.drones) {
      try {
        osc.stop();
      } catch {
        // Already stopped: nothing to do.
      }
    }
    voice.gain.disconnect();
  }

  /** Schedules every pattern step that falls inside the look-ahead window. Runs on the timer. */
  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const horizon = ctx.currentTime + SCHEDULE_AHEAD_S;
    const nowStep = stepAtOrAfter(this.musicOrigin, ctx.currentTime);
    // Breathing and frequency rests change which layers play; they are re-applied when they change.
    const rests = this.rests.update(performance.now(), this.options.musicFrequency);
    if (!sameRests(rests, this.restState)) {
      this.restState = rests;
      this.updateStems();
    }
    const loop = Math.floor(nowStep / STEPS_PER_LOOP);
    if (loop !== this.bedLoop) {
      this.bedLoop = loop;
      this.applyBedVariants(loop, ctx.currentTime);
    }
    for (const voice of this.stems.values()) {
      if (voice.def.kind === 'drone') continue;
      // A paused or hidden tab can leave steps behind the clock: skip them rather than play a burst.
      if (voice.nextStep < nowStep) voice.nextStep = nowStep;
      while (stepTime(this.musicOrigin, voice.nextStep) < horizon) {
        this.playStep(voice, voice.nextStep);
        voice.nextStep++;
      }
    }
  }

  /** Plays the note or hit a pattern stem has at one grid step. */
  private playStep(voice: StemVoice, step: number): void {
    const ctx = this.ctx;
    if (!ctx || !ctx.createOscillator) return;
    const variant = variantFor(Math.floor(step / STEPS_PER_LOOP), voice.def.id);
    const value = stepValue(voice.def, step, variant);
    if (value < 0) return;
    const def = voice.def;
    const at = stepTime(this.musicOrigin, step);
    const len = noteSeconds(def.kind);
    if (def.kind === 'noise') {
      if (!this.noise) return;
      this.percussion(ctx, voice.gain, at, len, def.octave < 0 ? 220 : 2400);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = def.wave;
    osc.frequency.value = degreeHz(value, def.octave);
    const env = ctx.createGain();
    env.gain.value = 0;
    env.gain.setTargetAtTime(def.kind === 'pulse' ? 0.16 : 0.22, at, 0.01);
    env.gain.setTargetAtTime(0, at + len * 0.6, len / 4);
    osc.connect(env);
    env.connect(voice.gain);
    osc.start(at);
    osc.stop(at + len + 0.3);
  }

  /** A noise hit through a low-pass filter (drums) or a higher one (shakers). */
  private percussion(ctx: ContextLike, dest: GainLike, at: number, len: number, cutoff: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = false;
    const env = ctx.createGain();
    env.gain.value = 0;
    env.gain.setTargetAtTime(0.5, at, 0.003);
    env.gain.setTargetAtTime(0, at + 0.03, len / 5);
    let out: NodeLike = env;
    if (ctx.createBiquadFilter) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      env.connect(filter);
      out = filter;
    }
    src.connect(env);
    out.connect(dest);
    src.start(at);
    src.stop(at + len + 0.2);
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
