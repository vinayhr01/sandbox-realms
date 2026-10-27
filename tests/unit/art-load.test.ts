import { describe, expect, it } from 'vitest';
import { SPECIES } from '../../src/content/beasts.ts';
import { artFor, chunkOf, loadArt, type ArtChunk } from '../../src/art/load.ts';

const CHUNKS: readonly ArtChunk[] = ['folk', 'beast', 'bird', 'sea', 'insect', 'undead', 'monster', 'divine', 'buildings'];

describe('chunkOf', () => {
  it('maps every species to one known chunk', () => {
    for (const s of SPECIES) {
      expect(CHUNKS, s.id).toContain(chunkOf(s.id));
    }
  });

  it('sends Folk rows to folk, beast-group bird gaits to bird, and wild beasts to beast', () => {
    expect(chunkOf('hearthborn')).toBe('folk');
    expect(chunkOf('cluckling')).toBe('bird');
    expect(chunkOf('talonkite')).toBe('bird');
    expect(chunkOf('thistlehart')).toBe('beast');
  });

  it('keeps flyers in their own group: stormwyrm stays monster, nectarbuzz stays insect', () => {
    expect(chunkOf('stormwyrm')).toBe('monster');
    expect(chunkOf('nectarbuzz')).toBe('insect');
  });
});

describe('art loading', () => {
  it('returns null from artFor before its chunk has loaded', () => {
    expect(artFor('thistlehart')).toBeNull();
    expect(artFor('no-such-species')).toBeNull();
  });

  it('loads the beast chunk to an ART record', async () => {
    const art = await loadArt('beast');
    expect(typeof art).toBe('object');
    expect(art).not.toBeNull();
  });
});
