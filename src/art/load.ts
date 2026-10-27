/**
 * Lazy art loading (map-graphics, Task 6). Each art chunk is one dynamic `import()` of `src/art/<chunk>/index.ts`,
 * which holds the SVG strings of that chunk's species or buildings. Vite emits every chunk as `art-<chunk>-*.js`
 * (see `vite.config.ts`, `rolldownOptions.output.manualChunks`), so the service worker caches it on first fetch.
 */
import type { MapKindGroup } from '../shared/protocol.ts';
import { SPECIES_BY_ID } from '../content/beasts.ts';
import { speciesGroup } from '../content/species-group.ts';
import { SPECIES_GAIT } from './gaits.ts';

export type ArtChunk = 'folk' | 'beast' | 'bird' | 'sea' | 'insect' | 'undead' | 'monster' | 'divine' | 'buildings';

const CHUNK_OF_GROUP: Record<MapKindGroup, ArtChunk> = {
  folk: 'folk',
  beast: 'beast',
  sea: 'sea',
  insect: 'insect',
  undead: 'undead',
  monster: 'monster',
  divine: 'divine',
};

type ArtModule = { ART: Record<string, string> };

const LOADERS: Record<ArtChunk, () => Promise<ArtModule>> = {
  folk: () => import('./folk/index.ts'),
  beast: () => import('./beast/index.ts'),
  bird: () => import('./bird/index.ts'),
  sea: () => import('./sea/index.ts'),
  insect: () => import('./insect/index.ts'),
  undead: () => import('./undead/index.ts'),
  monster: () => import('./monster/index.ts'),
  divine: () => import('./divine/index.ts'),
  buildings: () => import('./buildings/index.ts'),
};

/** The art chunk of a species: Folk rows go to folk, species with a flyer or bird gait go to bird, and the rest
 *  follow their map sprite group. An unknown id falls back to the group of index -1, which is beast. */
export function chunkOf(speciesId: string): ArtChunk {
  const group = speciesGroup(SPECIES_BY_ID.get(speciesId) ?? -1);
  if (group === 'folk') return 'folk';
  const gait = SPECIES_GAIT[speciesId];
  if (gait && (gait.air === 'flyer' || gait.land === 'bird')) return 'bird';
  return CHUNK_OF_GROUP[group];
}

const pending = new Map<ArtChunk, Promise<Record<string, string>>>();
const loaded = new Map<ArtChunk, Record<string, string>>();

/** Loads a chunk once and resolves to its ART record. A failed import is retried by the next call. */
export function loadArt(chunk: ArtChunk): Promise<Record<string, string>> {
  let hit = pending.get(chunk);
  if (!hit) {
    hit = LOADERS[chunk]().then(
      (mod) => {
        loaded.set(chunk, mod.ART);
        return mod.ART;
      },
      (err: unknown) => {
        pending.delete(chunk);
        throw err;
      },
    );
    pending.set(chunk, hit);
  }
  return hit;
}

/** The SVG source of a species or building id, or null while its chunk has not loaded (or has no art). */
export function artFor(id: string): string | null {
  return loaded.get(chunkOf(id))?.[id] ?? null;
}
