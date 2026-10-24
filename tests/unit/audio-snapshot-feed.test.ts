import { describe, expect, it } from 'vitest';
import { BIOMES, biomeOfCover } from '../../src/content/biomes.ts';
import { AGE_BY_ID } from '../../src/sim/ages.ts';
import { buildSnapshot } from '../../src/sim/snapshot.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';

describe('snapshot feed fields (16 B8: Age and biome shares)', () => {
  it('carries the Age in effect and the tiles per biome, read from the realm', () => {
    const sim = generateRealm({ seed: 4242, sizeStep: 2, template: 'continent' }).sim;
    const snap = buildSnapshot(sim);
    expect(snap.age).toBe(sim.currentAge);
    expect(AGE_BY_ID.has(snap.age ?? '')).toBe(true);

    const biomeIds = new Set(BIOMES.map((b) => b.id));
    let expected = 0;
    for (let i = 0; i < sim.realm.cover.length; i++) if (biomeOfCover(sim.realm.cover[i] ?? 0) >= 0) expected++;
    const counted = Object.values(snap.biomes ?? {}).reduce((a, b) => a + b, 0);
    expect(counted).toBe(expected);
    for (const id of Object.keys(snap.biomes ?? {})) expect(biomeIds.has(id)).toBe(true);
  });
});
