/**
 * Content hash for the main <-> worker handshake (17 section 2.2, 10 "Content"). FNV-1a over the JSON
 * of the species, power and building registries, as UTF-8 bytes, shown as 8 hex digits. Both sides
 * import this module from the same build, so the values match unless a stale worker chunk is running.
 * Functions in the registries are dropped by JSON, which keeps the hash deterministic.
 */
import { fnv1a } from '../shared/rng.ts';
import { SPECIES } from './beasts.ts';
import { POWERS } from './powers.ts';
import { BUILDINGS } from '../sim/settlements/catalogue.ts';

let cached: string | null = null;

export function contentHash(): string {
  if (cached !== null) return cached;
  const bytes = new TextEncoder().encode(JSON.stringify([SPECIES, POWERS, BUILDINGS]));
  cached = fnv1a(bytes).toString(16).padStart(8, '0');
  return cached;
}
