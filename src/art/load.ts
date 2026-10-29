/**
 * Lazy art loading (map-graphics, Task 6). Each art chunk is one dynamic `import()` of `src/art/<chunk>/index.ts`,
 * which holds the SVG strings of that chunk's species or buildings. Vite emits every chunk as `art-<chunk>-*.js`
 * (see `vite.config.ts`, `rolldownOptions.output.manualChunks`), so the service worker caches it on first fetch.
 */
import type { MapKindGroup } from '../shared/protocol.ts';
import { SPECIES_BY_ID } from '../content/beasts.ts';
import { speciesGroup } from '../content/species-group.ts';
import { SPECIES_GAIT } from './gaits.ts';
import { REUSE } from './powers/reuse.ts';
import type { PowerDef } from '../content/powers.ts';
import { chipOf, type ChipId } from '../ui/shell/powerCatalog.ts';

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

/** The art chunk of a species: Folk rows go to folk, beast-group species with a flyer or bird gait go to bird, and
 *  the rest follow their map sprite group (so mothlet stays insect and stormwyrm stays monster). An unknown id falls
 *  back to the group of index -1, which is beast. */
export function chunkOf(speciesId: string): ArtChunk {
  const index = SPECIES_BY_ID.get(speciesId) ?? -1;
  const group = speciesGroup(index);
  if (group === 'folk') return 'folk';
  const gait = SPECIES_GAIT[speciesId];
  if (group === 'beast' && gait && (gait.air === 'flyer' || gait.land === 'bird')) return 'bird';
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

/** The SVG source of a hamlet building kind, or null while the buildings chunk has not loaded (or has no art). */
export function artForBuilding(id: string): string | null {
  return loaded.get('buildings')?.[id] ?? null;
}

/*
 * Power art (illustrated power icons). Each group under src/art/powers/<group>/ is one lazy chunk (art-p<group>), keyed
 * by power id, or by chip id in the `chips` group. Creature powers keep their species art above; every other power and
 * chip reads from here, with the line glyph as the fallback until its group has loaded.
 */

export type PowerArtGroup = 'chips' | 'land' | 'nature' | 'weather' | 'disasters' | 'blessings' | 'peoples' | 'inspect' | 'world';

export const POWER_ART_GROUPS: readonly PowerArtGroup[] = ['chips', 'land', 'nature', 'weather', 'disasters', 'blessings', 'peoples', 'inspect', 'world'];

const POWER_LOADERS: Record<PowerArtGroup, () => Promise<ArtModule>> = {
  chips: () => import('./powers/chips/index.ts'),
  land: () => import('./powers/land/index.ts'),
  nature: () => import('./powers/nature/index.ts'),
  weather: () => import('./powers/weather/index.ts'),
  disasters: () => import('./powers/disasters/index.ts'),
  blessings: () => import('./powers/blessings/index.ts'),
  peoples: () => import('./powers/peoples/index.ts'),
  inspect: () => import('./powers/inspect/index.ts'),
  world: () => import('./powers/world/index.ts'),
};

/** The art group of a power: its sheet chip, or `world` for the Atlas and Realm powers. Creature powers have no group of their own (they show species art), so they map to `world` too. */
export function powerArtGroup(power: PowerDef): PowerArtGroup {
  const chip = chipOf(power);
  return chip === null || chip === 'creatures' ? 'world' : chip;
}

const powerPending = new Map<PowerArtGroup, Promise<Record<string, string>>>();
const powerLoaded = new Map<PowerArtGroup, Record<string, string>>();

/** Loads a power art group once and resolves to its ART record. A failed import is retried by the next call. */
export function loadPowerArt(group: PowerArtGroup): Promise<Record<string, string>> {
  let hit = powerPending.get(group);
  if (!hit) {
    hit = POWER_LOADERS[group]().then(
      (mod) => {
        powerLoaded.set(group, mod.ART);
        return mod.ART;
      },
      (err: unknown) => {
        powerPending.delete(group);
        throw err;
      },
    );
    powerPending.set(group, hit);
  }
  return hit;
}

/** Loads what a power's icon needs: its group, and the buildings chunk when the icon is reused from there. */
export function loadPowerArtFor(power: PowerDef): Promise<unknown> {
  const reuse: { chunk: ArtChunk; id: string } | undefined = REUSE[power.id];
  return Promise.all([loadPowerArt(powerArtGroup(power)), reuse ? loadArt(reuse.chunk) : null]);
}

/** The SVG source of a non-creature power, or null while its group has not loaded (or it has no art). A reused icon comes from its building or flora chunk. */
export function powerArtFor(power: PowerDef): string | null {
  const own = powerLoaded.get(powerArtGroup(power))?.[power.id];
  if (own !== undefined) return own;
  const reuse: { chunk: ArtChunk; id: string } | undefined = REUSE[power.id];
  return reuse ? (loaded.get(reuse.chunk)?.[reuse.id] ?? null) : null;
}

/** The SVG source of a sheet category chip, or null while the chips group has not loaded. */
export function chipArtFor(chip: ChipId): string | null {
  return powerLoaded.get('chips')?.[chip] ?? null;
}
