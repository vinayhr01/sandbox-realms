import { describe, expect, it } from 'vitest';
import { AudioEngine, type ContextLike, type GainLike, type NodeLike, type ParamLike } from '../../src/audio/engine.ts';
import { DEFAULT_AUDIO_OPTIONS, type AudioOptions } from '../../src/audio/options.ts';

/** Records the channel layout the engine sets on each gain node; no sound is produced. */
class Param implements ParamLike {
  value = 1;
  setTargetAtTime(target: number): void {
    this.value = target;
  }
}

class Node implements NodeLike {
  connect(): void {}
  disconnect(): void {}
}

class Gain extends Node implements GainLike {
  readonly gain = new Param();
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
}

class Ctx {
  currentTime = 0;
  sampleRate = 8000;
  readonly destination = new Node();
  readonly gains: Gain[] = [];
  createGain(): GainLike {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  createStereoPanner() {
    return Object.assign(new Node(), { pan: new Param() });
  }
  createDynamicsCompressor() {
    return Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
  }
  createBuffer() {
    return { copyToChannel(): void {} };
  }
  createBufferSource() {
    return Object.assign(new Node(), { buffer: null, loop: false, onended: null, start(): void {}, stop(): void {} });
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

function started(options: Partial<AudioOptions> = {}): { engine: AudioEngine; ctx: Ctx; master: Gain } {
  const ctx = new Ctx();
  const engine = new AudioEngine(() => ctx as unknown as ContextLike);
  engine.applyOptions({ ...DEFAULT_AUDIO_OPTIONS, ...options });
  engine.unlock();
  // The master is the first gain the engine creates after the context.
  const master = ctx.gains[0];
  if (!master) throw new Error('no master gain');
  return { engine, ctx, master };
}

describe('mono downmix (16 B9)', () => {
  it('leaves the master stereo when the option is off', () => {
    const { master } = started({ mono: false });
    expect(master.channelCount).toBe(2);
    expect(master.channelCountMode).toBe('max');
  });

  it('sums the master to one speaker-interpreted channel when on, so L and R are identical', () => {
    const { master } = started({ mono: true });
    expect(master.channelCount).toBe(1);
    expect(master.channelCountMode).toBe('explicit');
    expect(master.channelInterpretation).toBe('speakers');
  });

  it('switches mono on and off live through applyOptions', () => {
    const { engine, master } = started({ mono: false });
    engine.applyOptions({ ...DEFAULT_AUDIO_OPTIONS, mono: true });
    expect(master.channelCount).toBe(1);
    engine.applyOptions({ ...DEFAULT_AUDIO_OPTIONS, mono: false });
    expect(master.channelCount).toBe(2);
    expect(master.channelCountMode).toBe('max');
  });
});
