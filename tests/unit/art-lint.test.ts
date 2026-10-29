// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { GAITS, SPECIES_GAIT } from '../../src/art/gaits.ts';
import {
  artFor,
  artForBuilding,
  chipArtFor,
  chunkOf,
  loadArt,
  loadPowerArt,
  loadPowerArtFor,
  POWER_ART_GROUPS,
  powerArtFor,
  type ArtChunk,
} from '../../src/art/load.ts';
import { artProblems } from '../../src/art/rig.ts';
import { SPECIES } from '../../src/content/beasts.ts';
import { POWERS } from '../../src/content/powers.ts';
import { BUILDINGS } from '../../src/sim/settlements/catalogue.ts';
import { CHIP_IDS } from '../../src/ui/shell/powerCatalog.ts';

// artProblems parses with the DOM. Power art is loaded with import.meta.glob, which comes back empty under the jsdom
// environment, so this file runs in node and borrows jsdom's parser.
// jsdom ships without type declarations; createRequire keeps the import typed here.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new () => { window: { DOMParser: unknown; XMLSerializer: unknown } } };
const { window: dom } = new JSDOM();
Object.assign(globalThis, { DOMParser: dom.DOMParser, XMLSerializer: dom.XMLSerializer });

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

  it('gives every species and every building art', async () => {
    for (const s of SPECIES) {
      await loadArt(chunkOf(s.id));
      expect(artFor(s.id), `species ${s.id} (${chunkOf(s.id)})`).toEqual(expect.any(String));
    }
    await loadArt('buildings');
    for (const b of BUILDINGS) {
      expect(artForBuilding(b.id), `building ${b.id}`).toEqual(expect.any(String));
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

  it('passes every file in every power-art group', async () => {
    for (const group of POWER_ART_GROUPS) {
      const art = await loadPowerArt(group);
      expect(Object.keys(art).length, `power-art ${group} has files`).toBeGreaterThan(0);
      for (const [key, svg] of Object.entries(art)) {
        expect(artProblems(svg, []), `power-art ${group}/${key}`).toEqual([]);
      }
    }
  });

  it('gives every non-creature power and every chip power art', async () => {
    for (const p of POWERS) {
      if (p.tab === 'beings') continue;
      await loadPowerArtFor(p);
      expect(powerArtFor(p), `power ${p.id}`).toEqual(expect.any(String));
    }
    await loadPowerArt('chips');
    for (const chip of CHIP_IDS) {
      expect(chipArtFor(chip), `chip ${chip}`).toEqual(expect.any(String));
    }
  });

  it('prefixes every id in a power-art file with its key', async () => {
    for (const group of POWER_ART_GROUPS) {
      const art = await loadPowerArt(group);
      for (const [key, svg] of Object.entries(art)) {
        const prefix = group === 'chips' ? `chip_${key}-` : `${key}-`;
        const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? '');
        const bad = ids.filter((id) => !id.startsWith(prefix));
        expect(bad, `power-art ${group}/${key} ids must start with ${prefix}`).toEqual([]);
      }
    }
  });
});
