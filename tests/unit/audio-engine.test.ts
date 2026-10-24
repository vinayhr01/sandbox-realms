import { describe, expect, it } from 'vitest';
import { AudioEngine, type BufferLike, type ContextLike, type GainLike, type NodeLike, type ParamLike, type SourceLike } from '../../src/audio/engine.ts';
import { DEFAULT_AUDIO_OPTIONS, sliderToGain } from '../../src/audio/options.ts';

/** A fake WebAudio context that records what the engine asks for. No sound is produced. */
class FakeParam implements ParamLike {
  value = 1;
  targets: number[] = [];
  setTargetAtTime(target: number): void {
    this.targets.push(target);
    this.value = target;
  }
}

class FakeNode implements NodeLike {
  readonly outputs: NodeLike[] = [];
  connect(dest: NodeLike): void {
    this.outputs.push(dest);
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
}

class FakeGain extends FakeNode implements GainLike {
  readonly gain = new FakeParam();
}

class FakeSource extends FakeNode implements SourceLike {
  buffer: BufferLike | null = null;
  loop = false;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeContext implements ContextLike {
  currentTime = 0;
  sampleRate = 8000;
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly buffers: { length: number }[] = [];
  resumed = 0;
  createGain(): GainLike {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: new FakeParam() });
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() });
  }
  createBuffer(_channels: number, length: number): BufferLike {
    this.buffers.push({ length });
    return { copyToChannel: () => undefined };
  }
  createBufferSource(): SourceLike {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  resume(): Promise<unknown> {
    this.resumed++;
    return Promise.resolve();
  }
}

function engineWithContext(): { engine: AudioEngine; ctx: FakeContext } {
  const ctx = new FakeContext();
  return { engine: new AudioEngine(() => ctx), ctx };
}

describe('audio engine adapter (16 section B5, B6)', () => {
  it('plays nothing before the first user gesture', () => {
    const { engine, ctx } = engineWithContext();
    expect(engine.started).toBe(false);
    expect(engine.play('ui_click', 0)).toBe(false);
    expect(ctx.sources.length).toBe(0);
  });

  it('creates the graph on unlock and resumes once per call', () => {
    const { engine, ctx } = engineWithContext();
    engine.unlock();
    expect(engine.started).toBe(true);
    expect(ctx.resumed).toBe(1);
    engine.unlock();
    expect(ctx.resumed).toBe(2);
  });

  it('starts a voice, routes it to its bus and ends it through onended', () => {
    const { engine, ctx } = engineWithContext();
    engine.unlock();
    expect(engine.play('ui_click', 0)).toBe(true);
    const src = ctx.sources[0];
    if (!src) throw new Error('no source');
    expect(src.started).toBe(true);
    expect(engine.model.voices.length).toBe(1);
    src.onended?.();
    expect(engine.model.voices.length).toBe(0);
  });

  it('refuses a sound inside its cooldown and a stinger beyond its instance cap', () => {
    const { engine } = engineWithContext();
    engine.unlock();
    expect(engine.play('ui_click', 0)).toBe(true);
    expect(engine.play('ui_click', 10)).toBe(false);
    expect(engine.play('ui_click', 30)).toBe(true);
    expect(engine.play('stg_peace', 1000)).toBe(true);
    expect(engine.play('stg_war_declared', 1100)).toBe(true);
    expect(engine.play('stg_pact_formed', 1200)).toBe(false);
  });

  it('steals the weakest voice when a more important one needs the category cap', () => {
    const { engine, ctx } = engineWithContext();
    engine.unlock();
    // Four priority-2 explosions fill the calamity category (cap 4), spaced past their 150 ms cooldown.
    for (let k = 0; k < 4; k++) expect(engine.play('exp_small', k * 300)).toBe(true);
    // A priority-1 calamity is more important than every playing explosion, so it takes one of them.
    expect(engine.play('cal_storm_peak', 2000)).toBe(true);
    expect(ctx.sources[0]?.stopped).toBe(true);
    expect(engine.model.voices.length).toBe(4);
  });

  it('refuses everything while the tab is hidden, and plays again when shown', () => {
    const { engine } = engineWithContext();
    engine.unlock();
    engine.setHidden(true);
    expect(engine.play('ui_click', 0)).toBe(false);
    engine.setHidden(false);
    expect(engine.play('ui_click', 0)).toBe(true);
  });

  it('keeps playing in a hidden tab when the mute-when-hidden option is off', () => {
    const { engine } = engineWithContext();
    engine.unlock();
    engine.applyOptions({ ...DEFAULT_AUDIO_OPTIONS, volumes: { ...DEFAULT_AUDIO_OPTIONS.volumes }, muteWhenHidden: false });
    engine.setHidden(true);
    expect(engine.play('ui_click', 0)).toBe(true);
  });

  it('a muted bus refuses its sounds without using a voice', () => {
    const { engine } = engineWithContext();
    engine.unlock();
    engine.model.setMuted('music', true);
    expect(engine.play('stg_peace', 0)).toBe(false);
    expect(engine.model.voices.length).toBe(0);
  });

  it('applies the option sliders to the bus and sub-bus gains', () => {
    const { engine, ctx } = engineWithContext();
    engine.unlock();
    engine.applyOptions({ ...DEFAULT_AUDIO_OPTIONS, volumes: { master: 100, music: 50, effects: 0, voices: 100, ambience: 25, ui: 100 } });
    expect(engine.model.volume('music')).toBeCloseTo(sliderToGain(50), 6);
    expect(engine.model.volume('sfx')).toBe(0);
    const targets = ctx.gains.map((g) => g.gain.value);
    expect(targets).toContain(sliderToGain(100));
    expect(targets).toContain(sliderToGain(25));
  });

  it('ducks the music bus for a priority 0-1 sound that asks for it', () => {
    const { engine, ctx } = engineWithContext();
    engine.unlock();
    // Graph order from unlock(): master, then the music, sfx and ui bus nodes.
    const music = ctx.gains[1];
    if (!music) throw new Error('no music bus');
    const before = music.gain.targets.length;
    expect(engine.play('stg_age_change', 0)).toBe(true);
    expect(music.gain.targets.length).toBeGreaterThan(before);
  });

  it('stops every copy of a bed by id', () => {
    const { engine, ctx } = engineWithContext();
    engine.unlock();
    expect(engine.play('amb_surf', 0)).toBe(true);
    expect(engine.play('amb_surf', 1)).toBe(false);
    engine.stopSound('amb_surf');
    expect(ctx.sources[0]?.stopped).toBe(true);
    expect(engine.model.voices.length).toBe(0);
    expect(engine.play('amb_surf', 2)).toBe(true);
  });

  it('renders each buffer once per sound id', () => {
    const { engine, ctx } = engineWithContext();
    engine.unlock();
    engine.play('ui_click', 0);
    engine.play('ui_click', 100);
    expect(ctx.buffers.length).toBe(1);
  });
});
