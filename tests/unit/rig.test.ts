// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAITS } from '../../src/art/gaits.ts';
import { parseRig, poseRig } from '../../src/art/rig.ts';

const FIXTURE = readFileSync(join(process.cwd(), 'tests/fixtures/rig-quad.svg'), 'utf8');

describe('parseRig', () => {
  it('finds the parts and their pivots', () => {
    const rig = parseRig(FIXTURE);
    expect(rig.parts.get('leg-fl')).toMatchObject({ px: 40, py: 80 });
    expect(rig.parts.has('head')).toBe(true);
  });

  it('throws on a viewBox other than 0 0 128 128', () => {
    expect(() => parseRig(FIXTURE.replace('viewBox="0 0 128 128"', 'viewBox="0 0 64 64"'))).toThrow(/viewBox/);
  });
});

describe('poseRig', () => {
  it('writes the pose rotation on leg-fl', () => {
    const rig = parseRig(FIXTURE);
    // quad leg-fl swings 25 degrees; at phase 0.25 its walk sine is 1, so the rotation is the full 25.
    poseRig(rig, GAITS.quad, 0.25, 'walk');
    expect(rig.parts.get('leg-fl')?.el.getAttribute('transform')).toContain('rotate(25 40 80)');
  });

  it('returns the serialised SVG with the pose applied', () => {
    const out = poseRig(parseRig(FIXTURE), GAITS.quad, 0.25, 'walk');
    expect(out).toContain('<svg');
    expect(out).toContain('rotate(25 40 80)');
  });
});
