import { describe, expect, it } from 'vitest';
import { BeingState } from '../../src/shared/being-feed.ts';
import { SPECIES_GAIT, type SpeciesGait } from '../../src/art/gaits.ts';
import {
  IDLE_CYCLES_PER_S,
  MAX_STRIDES_PER_S,
  PhaseByKey,
  RUN_SCREEN_TILES_PER_S,
  advancePhase,
  frameIndex,
  framesOf,
  gaitFor,
  stepPhase,
} from '../../src/render/anim.ts';

const species = (id: string): SpeciesGait => SPECIES_GAIT[id] as SpeciesGait;
const dragon = species('stormwyrm');
const crocodile = species('mudjaw');
const shark = species('razorfin');

describe('constants', () => {
  it('fixes the idle clock, run speed and stride cap', () => {
    expect(IDLE_CYCLES_PER_S).toBe(0.5);
    expect(RUN_SCREEN_TILES_PER_S).toBe(4);
    expect(MAX_STRIDES_PER_S).toBe(3);
  });
});

describe('advancePhase', () => {
  it('advances by moved tiles over stride length', () => {
    expect(advancePhase(0, 0.3, 0.6, 1000)).toBeCloseTo(0.5, 9);
  });

  it('caps the advance at MAX_STRIDES_PER_S strides per second', () => {
    expect(advancePhase(0, 100, 0.6, 16)).toBeCloseTo((3 * 16) / 1000, 9);
  });

  it('wraps the phase into the range 0 to 1', () => {
    expect(advancePhase(0.9, 0.3, 0.6, 1000)).toBeCloseTo(0.4, 9);
  });

  it('leaves the phase unchanged when nothing moved', () => {
    expect(advancePhase(0.2, 0, 0.6, 16)).toBeCloseTo(0.2, 9);
  });
});

describe('frameIndex', () => {
  it('maps the phase onto a frame and wraps', () => {
    expect(frameIndex(0, 4)).toBe(0);
    expect(frameIndex(0.26, 4)).toBe(1);
    expect(frameIndex(0.5, 4)).toBe(2);
    expect(frameIndex(0.99, 4)).toBe(3);
    expect(frameIndex(1, 4)).toBe(0);
    expect(frameIndex(1.3, 4)).toBe(1);
  });
});

describe('gaitFor', () => {
  it('walks on the land gait', () => {
    expect(gaitFor(crocodile, BeingState.Walk)).toEqual({ gait: 'quad', mode: 'walk' });
  });

  it('walks a dragon on its land gait and flies it when running', () => {
    expect(gaitFor(dragon, BeingState.Walk)).toEqual({ gait: 'quad', mode: 'walk' });
    expect(gaitFor(dragon, BeingState.Run)).toEqual({ gait: 'flyer', mode: 'run' });
  });

  it('keeps a land-flyer species (bee) flying when it walks', () => {
    expect(gaitFor(species('nectarbuzz'), BeingState.Walk)).toEqual({ gait: 'flyer', mode: 'walk' });
  });

  it('runs on the land gait with run mode for a land-only species', () => {
    expect(gaitFor(crocodile, BeingState.Run)).toEqual({ gait: 'quad', mode: 'run' });
  });

  it('swims on the water gait', () => {
    expect(gaitFor(crocodile, BeingState.Swim)).toEqual({ gait: 'undulate', mode: 'walk' });
  });

  it('swims on the land gait when the species has no water gait', () => {
    expect(gaitFor(shark, BeingState.Swim)).toEqual({ gait: 'fish', mode: 'walk' });
  });

  it('plays the idle breathing pose for Idle, Sleep and Hit', () => {
    expect(gaitFor(dragon, BeingState.Idle)).toEqual({ gait: 'quad', mode: 'idle' });
    expect(gaitFor(dragon, BeingState.Sleep)).toEqual({ gait: 'quad', mode: 'idle' });
    expect(gaitFor(dragon, BeingState.Hit)).toEqual({ gait: 'quad', mode: 'idle' });
  });
});

describe('stepPhase', () => {
  it('breathes standing beings at IDLE_CYCLES_PER_S whatever they moved', () => {
    expect(stepPhase(0, BeingState.Idle, 5, 0.5, 1000)).toBeCloseTo(IDLE_CYCLES_PER_S, 10);
    expect(stepPhase(0, BeingState.Sleep, 0, 0.5, 1000)).toBeCloseTo(IDLE_CYCLES_PER_S, 10);
  });

  it('strides walking beings by the tiles moved', () => {
    expect(stepPhase(0, BeingState.Walk, 0.3, 0.6, 1000)).toBeCloseTo(0.5, 10);
  });
});

describe('framesOf', () => {
  it('gives a static gait one frame and the others their table count', () => {
    expect(framesOf('static', 'idle')).toBe(1);
    expect(framesOf('quad', 'idle')).toBe(2);
    expect(framesOf('quad', 'run')).toBe(4);
  });
});

/** The forward distance from a to b on the phase circle. */
const wrap = (d: number): number => d - Math.floor(d);

describe('PhaseByKey', () => {
  it('keeps each key on its own phase, striding by the distance its own position moved', () => {
    const phases = new PhaseByKey();
    const a1 = phases.step(1, BeingState.Walk, 0, 0, 0.6, 1000);
    phases.step(2, BeingState.Walk, 10, 10, 0.6, 1000);
    const a2 = phases.step(1, BeingState.Walk, 0.3, 0, 0.6, 1000);
    expect(wrap(a2 - a1)).toBeCloseTo(0.5, 10);
    expect(phases.phaseOf(1)).toBeCloseTo(a2, 10);
    expect(phases.phaseOf(2)).not.toBeCloseTo(phases.phaseOf(1), 3);
  });

  it('breathes a standing key without any movement', () => {
    const phases = new PhaseByKey();
    const p1 = phases.step(7, BeingState.Idle, 0, 0, 0.6, 1000);
    const p2 = phases.step(7, BeingState.Idle, 0, 0, 0.6, 1000);
    expect(wrap(p2 - p1)).toBeCloseTo(IDLE_CYCLES_PER_S, 10);
  });

  it('drops keys not stepped this frame', () => {
    const phases = new PhaseByKey();
    phases.step(1, BeingState.Walk, 0, 0, 0.6, 1000);
    phases.step(2, BeingState.Walk, 0, 0, 0.6, 1000);
    phases.endFrame();
    phases.step(1, BeingState.Walk, 0, 0, 0.6, 1000);
    phases.endFrame();
    expect(phases.size()).toBe(1);
  });
});
