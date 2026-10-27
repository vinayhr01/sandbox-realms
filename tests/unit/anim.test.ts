import { describe, expect, it } from 'vitest';
import { BeingState } from '../../src/shared/being-feed.ts';
import { SPECIES_GAIT, type SpeciesGait } from '../../src/art/gaits.ts';
import {
  IDLE_CYCLES_PER_S,
  MAX_STRIDES_PER_S,
  RUN_SCREEN_TILES_PER_S,
  advancePhase,
  frameIndex,
  gaitFor,
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

  it('flyers use their air gait whenever moving, walking or running', () => {
    expect(gaitFor(dragon, BeingState.Walk)).toEqual({ gait: 'flyer', mode: 'walk' });
    expect(gaitFor(dragon, BeingState.Run)).toEqual({ gait: 'flyer', mode: 'run' });
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
