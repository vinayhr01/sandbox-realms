import { describe, expect, it } from 'vitest';
import { SPECIES } from '../../src/content/beasts.ts';
import { GAITS, SPECIES_GAIT, type GaitId } from '../../src/art/gaits.ts';

const MODES = ['idle', 'walk', 'run'] as const;
const ALL_GAITS: readonly GaitId[] = [
  'quad', 'biped', 'bird', 'flyer', 'fish', 'insect', 'snake', 'hover', 'crab', 'tentacle',
  'pulse', 'squish', 'undulate', 'waddle', 'static',
];

describe('species gait table', () => {
  it('has exactly one gait entry per species id', () => {
    const ids = SPECIES.map((s) => s.id).sort();
    expect(Object.keys(SPECIES_GAIT).sort()).toEqual(ids);
  });

  it('references only gaits that exist, with a positive stride', () => {
    for (const [id, g] of Object.entries(SPECIES_GAIT)) {
      expect(GAITS[g.land], `${id} land`).toBeDefined();
      if (g.water !== null) expect(GAITS[g.water], `${id} water`).toBeDefined();
      if (g.air !== null) expect(GAITS[g.air], `${id} air`).toBeDefined();
      expect(g.strideTiles, `${id} stride`).toBeGreaterThan(0);
    }
  });

  it('defines every gait family', () => {
    expect(Object.keys(GAITS).sort()).toEqual([...ALL_GAITS].sort());
  });
});

describe('gait poses', () => {
  it('loop seamlessly: phase 0 and phase 1 give the same pose for every part and mode', () => {
    for (const gait of ALL_GAITS) {
      const def = GAITS[gait];
      for (const mode of MODES) {
        for (const part of def.parts) {
          const a = def.pose(part, 0, mode);
          const b = def.pose(part, 1, mode);
          expect(Math.abs(a.rot - b.rot), `${gait}/${part}/${mode} rot`).toBeLessThan(1e-6);
          expect(Math.abs(a.dx - b.dx), `${gait}/${part}/${mode} dx`).toBeLessThan(1e-6);
          expect(Math.abs(a.dy - b.dy), `${gait}/${part}/${mode} dy`).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('quad legs swing diagonally: front-left with back-right, front-right against front-left', () => {
    const quad = GAITS.quad;
    const at = (part: string) => quad.pose(part, 0.1, 'walk').rot;
    expect(at('leg-fl')).toBeCloseTo(at('leg-br'), 9);
    expect(at('leg-fr')).toBeCloseTo(at('leg-bl'), 9);
    expect(at('leg-fl')).toBeCloseTo(-at('leg-fr'), 9);
    expect(Math.abs(at('leg-fl'))).toBeGreaterThan(0);
  });

  it('run has larger leg swing than walk', () => {
    const quad = GAITS.quad;
    const walk = Math.abs(quad.pose('leg-fl', 0.25, 'walk').rot);
    const run = Math.abs(quad.pose('leg-fl', 0.25, 'run').rot);
    expect(run).toBeGreaterThan(walk);
  });

  it('idle breathes gently: the legs stay still while the body moves', () => {
    const quad = GAITS.quad;
    expect(quad.pose('leg-fl', 0.25, 'idle').rot).toBe(0);
    expect(quad.pose('body', 0.25, 'idle').dy).not.toBe(0);
  });

  it('gives a zero pose for a part the gait does not have', () => {
    expect(GAITS.quad.pose('fin', 0.3, 'walk')).toEqual({ rot: 0, dx: 0, dy: 0 });
  });
});
