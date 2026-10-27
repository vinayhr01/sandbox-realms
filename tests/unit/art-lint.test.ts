// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAITS, SPECIES_GAIT } from '../../src/art/gaits.ts';
import { loadArt, type ArtChunk } from '../../src/art/load.ts';
import { artProblems } from '../../src/art/rig.ts';

const CHUNKS: readonly ArtChunk[] = ['folk', 'beast', 'bird', 'sea', 'insect', 'undead', 'monster', 'divine', 'buildings'];
const FIXTURE = readFileSync(join(process.cwd(), 'tests/fixtures/rig-quad.svg'), 'utf8');

/** Every part a species' gaits animate; buildings are static and need none. */
function requiredParts(chunk: ArtChunk, id: string): string[] {
  if (chunk === 'buildings') return [];
  const g = SPECIES_GAIT[id];
  if (!g) return [];
  const gaits = [g.land, g.water, g.air].filter((x): x is NonNullable<typeof x> => x !== null);
  return [...new Set(gaits.flatMap((x) => GAITS[x].parts))];
}

describe('art lint', () => {
  it('passes every art file in every chunk', async () => {
    for (const chunk of CHUNKS) {
      const art = await loadArt(chunk);
      for (const [id, svg] of Object.entries(art)) {
        expect(artProblems(svg, requiredParts(chunk, id)), `${chunk}/${id}`).toEqual([]);
      }
    }
  });

  it('accepts the fixture rig for its gait parts', () => {
    expect(artProblems(FIXTURE, ['body', 'head', 'tail', 'leg-fl', 'leg-fr', 'leg-bl', 'leg-br'])).toEqual([]);
  });

  it('flags a wrong viewBox, an in-SVG shadow, a missing part and an oversize file', () => {
    expect(artProblems(FIXTURE.replace('viewBox="0 0 128 128"', 'viewBox="0 0 64 64"'), [])[0]).toMatch(/viewBox/);
    expect(artProblems(FIXTURE.replace('</svg>', '<filter id="f"/></svg>'), [])).toContainEqual(expect.stringMatching(/filter/));
    expect(artProblems(FIXTURE, ['wing-l'])).toContainEqual(expect.stringMatching(/wing-l/));
    expect(artProblems(FIXTURE + ' '.repeat(12 * 1024), [])).toContainEqual(expect.stringMatching(/12 KB/));
  });
});
