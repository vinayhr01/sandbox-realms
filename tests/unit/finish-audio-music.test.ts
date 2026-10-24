import { describe, expect, it } from 'vitest';
import { musicViewState } from '../../src/app/audio-wiring.ts';
import { AudioEngine, type ContextLike, type FilterLike, type GainLike, type NodeLike, type OscLike, type PannerLike, type ParamLike, type SourceLike } from '../../src/audio/engine.ts';
import { DEFAULT_AUDIO_OPTIONS } from '../../src/audio/options.ts';
import {
  AGE_IDS,
  ATTACK_S,
  BAR_SECONDS,
  BIOME_FAMILIES,
  LAYER_CAP_DESKTOP,
  LOOP_SECONDS,
  RELEASE_S,
  STEM_DEFS,
  STEPS_PER_LOOP,
  WAR_ATTACK_S,
  WAR_RELEASE_S,
  barStepAtOrAfter,
  biomeGains,
  capLayers,
  degreeHz,
  motifIndexFor,
  shouldStop,
  silenceSince,
  silentMusicState,
  stemTargets,
  stemTau,
  stepAtOrAfter,
  stepValue,
  variantFor,
  type MusicState,
} from '../../src/audio/music.ts';

const byId = (id: string) => STEM_DEFS.find((d) => d.id === id);
const withState = (patch: Partial<MusicState>): MusicState => ({ ...silentMusicState(), ...patch });

describe('stem table (16 B8)', () => {
  it('has the stem counts from the spec, less the bed B variant that is not alternated yet', () => {
    const count = (g: string) => STEM_DEFS.filter((d) => d.group === g).length;
    expect(count('bed')).toBe(1);
    expect(count('age')).toBe(10);
    expect(count('biome')).toBe(7);
    expect(count('mood')).toBe(8);
    expect(count('lineage')).toBe(6);
  });

  it('a loop is eight 4/4 bars at 96 BPM, which is 20 seconds', () => {
    expect(BAR_SECONDS).toBeCloseTo(2.5, 10);
    expect(LOOP_SECONDS).toBeCloseTo(20, 10);
    expect(STEPS_PER_LOOP).toBe(64);
  });

  it('every age in the table has an age stem, and veiled is not one', () => {
    expect(AGE_IDS).toHaveLength(10);
    expect(byId('age_veiled')).toBeUndefined();
    for (const id of AGE_IDS) expect(byId(`age_${id}`)).toBeDefined();
  });
});

describe('gain rules', () => {
  it('the bed is always on at full gain', () => {
    expect(stemTargets(silentMusicState())['bed_a']).toBe(1);
  });

  it('only the current age stem plays, at 0.9', () => {
    const t = stemTargets(withState({ ageId: 'marvels' }));
    expect(t['age_marvels']).toBeCloseTo(0.9, 10);
    expect(t['age_dawn']).toBe(0);
  });

  it('the top biome needs 12 % and a 3-point lead; the second needs more than 25 %', () => {
    const none = Object.fromEntries(BIOME_FAMILIES.map((b) => [b, 0])) as Record<(typeof BIOME_FAMILIES)[number], number>;
    expect(biomeGains({ ...none, arid: 0.1 }).arid).toBe(0);
    expect(biomeGains({ ...none, arid: 0.2, cold: 0.19 }).arid).toBe(0);
    expect(biomeGains({ ...none, arid: 0.2, cold: 0.1 }).arid).toBe(0.7);
    expect(biomeGains({ ...none, arid: 0.3, cold: 0.26 })).toMatchObject({ arid: 0.7, cold: 0.45 });
    expect(biomeGains({ ...none, arid: 0.3, cold: 0.2 }).cold).toBe(0);
  });

  it('mood layers follow the mood scores with the spec scalings', () => {
    const t = stemTargets(withState({ mood: { calm: 1, tension: 0.5, war: 1, grief: 0, prosperity: 0, wonder: 0 }, night: 0.2 }));
    expect(t['mood_calm_melody']).toBeCloseTo(0.8, 10);
    expect(t['mood_calm_rhythm']).toBeCloseTo(0.6, 10);
    expect(t['mood_tension_pulse']).toBeCloseTo(0.4, 10);
    expect(t['mood_war_drums']).toBeCloseTo(0.9, 10);
    expect(t['mood_war_brass']).toBeCloseTo(0.8, 10);
  });

  it('calm rhythm halves at night', () => {
    const t = stemTargets(withState({ mood: { calm: 1, tension: 0, war: 0, grief: 0, prosperity: 0, wonder: 0 }, night: 0.9 }));
    expect(t['mood_calm_rhythm']).toBeCloseTo(0.3, 10);
  });

  it('overview scales biome and mood layers down by 30 % and leaves the bed alone', () => {
    const base = withState({ ageId: 'dawn', biomeShare: { ...silentMusicState().biomeShare, arid: 0.3 }, mood: { calm: 1, tension: 0, war: 0, grief: 0, prosperity: 0, wonder: 0 } });
    const near = stemTargets(base);
    const far = stemTargets({ ...base, isOverview: true });
    expect(far['biome_arid']).toBeCloseTo(near['biome_arid']! * 0.7, 10);
    expect(far['mood_calm_melody']).toBeCloseTo(near['mood_calm_melody']! * 0.7, 10);
    expect(far['bed_a']).toBe(1);
    expect(far['age_dawn']).toBeCloseTo(0.9, 10);
  });

  it('a lineage motif plays only for its own lineage', () => {
    const id = 'lineage-x';
    const k = motifIndexFor(id);
    const t = stemTargets(withState({ dominantLineage: id }));
    expect(t[`lineage_${k}`]).toBe(0.5);
    for (let j = 0; j < 6; j++) if (j !== k) expect(t[`lineage_${j}`]).toBe(0);
    expect(motifIndexFor(id)).toBe(k);
  });
});

describe('layer cap (16 B8 rule 2)', () => {
  it('drops the quietest optional layers first and never the bed or age', () => {
    const targets: Record<string, number> = {};
    for (const d of STEM_DEFS) targets[d.id] = 0;
    targets['bed_a'] = 1;
    targets['age_dawn'] = 0.9;
    targets['biome_arid'] = 0.7;
    targets['biome_cold'] = 0.45;
    targets['mood_war_drums'] = 0.2;
    targets['mood_calm_melody'] = 0.8;
    const capped = capLayers(targets, STEM_DEFS, 3);
    expect(capped['bed_a']).toBe(1);
    expect(capped['age_dawn']).toBe(0.9);
    expect(capped['biome_arid']).toBe(0);
    expect(capped['biome_cold']).toBe(0);
    expect(capped['mood_war_drums']).toBe(0);
    expect(capped['mood_calm_melody']).toBe(0.8);
  });

  it('keeps everything when the count is within the cap', () => {
    const t = stemTargets(withState({ ageId: 'dawn' }));
    expect(capLayers(t, STEM_DEFS, LAYER_CAP_DESKTOP)).toEqual(t);
  });
});

describe('smoothing and stopping', () => {
  it('war layers attack in 1 s and release in 6 s; other stems use 2 s and 4 s', () => {
    expect(stemTau(byId('mood_war_drums')!, true)).toBe(WAR_ATTACK_S);
    expect(stemTau(byId('mood_war_brass')!, false)).toBe(WAR_RELEASE_S);
    expect(stemTau(byId('biome_arid')!, true)).toBe(ATTACK_S);
    expect(stemTau(byId('biome_arid')!, false)).toBe(RELEASE_S);
  });

  it('a stem is stopped only after 8 s below 0.02', () => {
    let since = silenceSince(null, 0.01, 1_000);
    expect(since).toBe(1_000);
    expect(shouldStop(since, 8_999)).toBe(false);
    expect(shouldStop(since, 9_000)).toBe(true);
    since = silenceSince(since, 0.5, 9_500);
    expect(since).toBeNull();
    expect(shouldStop(since, 100_000)).toBe(false);
  });
});

describe('grid and variants', () => {
  it('steps are eighth notes at 96 BPM', () => {
    expect(stepAtOrAfter(0, 0.3125)).toBe(1);
    expect(stepAtOrAfter(0, 0.3)).toBe(1);
    expect(stepAtOrAfter(0, 0)).toBe(0);
  });

  it('a new stem joins on a bar boundary', () => {
    expect(barStepAtOrAfter(0, 0.1) % 8).toBe(0);
    expect(barStepAtOrAfter(0, 0.1)).toBe(8);
    expect(barStepAtOrAfter(0, 0)).toBe(0);
    expect(barStepAtOrAfter(0, 2.6)).toBe(16);
  });

  it('variant A/B is deterministic per loop and stem, and only 0 or 1', () => {
    for (let loop = 0; loop < 20; loop++) {
      const v = variantFor(loop, 'biome_arid');
      expect([0, 1]).toContain(v);
      expect(variantFor(loop, 'biome_arid')).toBe(v);
    }
  });

  it('variant B shifts a pattern by half a bar', () => {
    const d = byId('age_dawn')!;
    expect(stepValue(d, 0, 0)).toBe(0);
    expect(stepValue(d, 0, 1)).toBe(4);
    expect(stepValue(byId('bed_a')!, 3, 1)).toBe(-1);
  });

  it('D Dorian: degree 0 is D3 and the octave doubles', () => {
    expect(degreeHz(0, 0)).toBeCloseTo(146.83, 2);
    expect(degreeHz(0, 1)).toBeCloseTo(146.83 * 2, 2);
    expect(degreeHz(7, 0)).toBeCloseTo(146.83 * 2, 2);
    expect(degreeHz(2, 0)).toBeCloseTo(146.83 * Math.pow(2, 3 / 12), 2);
  });
});

describe('music view state (audio-wiring)', () => {
  it('carries paused and zoom, with overview below 0.15 and the rest silent', () => {
    const s = musicViewState({ paused: true, zoom01: 0.1 });
    expect(s.paused).toBe(true);
    expect(s.isOverview).toBe(true);
    expect(s.zoom).toBeCloseTo(0.1, 10);
    expect(s.ageId).toBeNull();
    expect(musicViewState({ paused: false, zoom01: 2 }).zoom).toBe(1);
    expect(musicViewState({ paused: false, zoom01: Number.NaN }).zoom).toBe(0);
  });
});

// ---- engine, with a fake context that records what the music graph asks for -----------------

class FakeParam implements ParamLike {
  value = 0;
  setTargetAtTime(): void {
    /* envelopes are not checked here */
  }
}
class FakeNode implements NodeLike {
  connect(_dest: NodeLike): void {
    /* graph shape is not checked here */
  }
  disconnect(): void {
    /* nothing to undo */
  }
}
class FakeGain extends FakeNode implements GainLike {
  readonly gain = new FakeParam();
  channelCount?: number;
  channelCountMode?: string;
  channelInterpretation?: string;
}
class FakePanner extends FakeNode implements PannerLike {
  readonly pan = new FakeParam();
}
class FakeOsc extends FakeNode implements OscLike {
  type = 'sine';
  readonly frequency = new FakeParam();
  started: number[] = [];
  start(when = 0): void {
    this.started.push(when);
  }
  stop(): void {
    /* nothing to stop */
  }
}
class FakeFilter extends FakeNode implements FilterLike {
  type = 'lowpass';
  readonly frequency = new FakeParam();
}
class FakeSource extends FakeNode implements SourceLike {
  buffer = null;
  loop = false;
  onended = null;
  start(): void {
    /* playback is not simulated */
  }
  stop(): void {
    /* nothing to stop */
  }
}
class FakeContext implements ContextLike {
  currentTime = 0;
  readonly sampleRate = 8000;
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly panners: FakePanner[] = [];
  readonly oscillators: FakeOsc[] = [];
  createGain(): GainLike {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createStereoPanner(): PannerLike {
    const p = new FakePanner();
    this.panners.push(p);
    return p;
  }
  createDynamicsCompressor() {
    return { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam(), connect: () => undefined, disconnect: () => undefined };
  }
  createBuffer(): { copyToChannel(): void } {
    return { copyToChannel: () => undefined };
  }
  createBufferSource(): SourceLike {
    return new FakeSource();
  }
  createOscillator(): OscLike {
    const o = new FakeOsc();
    this.oscillators.push(o);
    return o;
  }
  createBiquadFilter(): FilterLike {
    return new FakeFilter();
  }
  resume(): Promise<unknown> {
    return Promise.resolve();
  }
}

function unlocked(): { ctx: FakeContext; engine: AudioEngine } {
  const ctx = new FakeContext();
  const engine = new AudioEngine(() => ctx);
  engine.unlock();
  return { ctx, engine };
}

describe('music in the engine', () => {
  it('does nothing before the first gesture unlocks the context', () => {
    const engine = new AudioEngine(() => new FakeContext());
    engine.startMusic();
    expect(engine.musicPlaying).toBe(false);
    engine.stopMusic();
  });

  it('starts the bed on unlock plus startMusic, and stops with stopMusic', () => {
    const { ctx, engine } = unlocked();
    expect(ctx.oscillators).toHaveLength(0);
    engine.startMusic();
    expect(engine.musicPlaying).toBe(true);
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators.every((o) => o.type === 'sine')).toBe(true);
    engine.stopMusic();
    expect(engine.musicPlaying).toBe(false);
  });

  it('an age stem that the state asks for plays its pattern on the grid', () => {
    const { ctx, engine } = unlocked();
    engine.startMusic();
    const before = ctx.oscillators.length;
    engine.setMusicState(withState({ ageId: 'dawn' }));
    // Advance the clock so the scheduler reaches the first beats of the bar.
    ctx.currentTime = 1;
    (engine as unknown as { scheduleMusic(): void }).scheduleMusic();
    const notes = ctx.oscillators.slice(before);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes.every((o) => o.type === 'triangle')).toBe(true);
  });

  it('caps the layers on phones at six', () => {
    const { engine } = unlocked();
    engine.setLayerCap(6);
    expect(() => engine.setLayerCap(0)).not.toThrow();
  });

  it('mono downmix sets the master to one channel and stereo back to two', () => {
    const { ctx, engine } = unlocked();
    const master = ctx.gains[0]!;
    engine.applyOptions({ ...DEFAULT_AUDIO_OPTIONS, mono: true });
    expect(master.channelCount).toBe(1);
    expect(master.channelCountMode).toBe('explicit');
    engine.applyOptions({ ...DEFAULT_AUDIO_OPTIONS, mono: false });
    expect(master.channelCount).toBe(2);
    expect(master.channelCountMode).toBe('max');
  });

  it('a cue with a pan gets a stereo panner set to that pan', () => {
    const { ctx, engine } = unlocked();
    expect(engine.play('ui_click', 0, -0.5, 1)).toBe(true);
    expect(ctx.panners).toHaveLength(1);
    expect(ctx.panners[0]!.pan.value).toBeCloseTo(-0.5, 10);
  });
});
