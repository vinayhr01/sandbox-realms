import { describe, expect, it } from 'vitest';
import { SPECIES, speciesIndex } from '../../src/content/beasts.ts';
import { PLAIN_NAMES, plainName } from '../../src/content/plain-names.ts';
import { POWERS } from '../../src/content/powers.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { buildSnapshot } from '../../src/sim/snapshot.ts';

/** Coined roots that must not reach a player-visible species or power name (DECISIONS.md "Plain names"). */
const COINED_ROOTS = [
  'thistlehart', 'burrfleece', 'plowhorn', 'mossback', 'cluckling', 'nectarbuzz', 'mudsnuffler', 'gloamfang',
  'deepmere', 'midmere', 'lowloam', 'highloam', 'rimeplate', 'cinderscar', 'wayworn', 'verdant', 'gloomgrowth',
  'bloatmoss',
];

/**
 * Map entries whose plain value is shared with another entry in the same map. Empty means every value in each
 * map is unique. A new duplicate fails the test until it is added here on purpose.
 */
const ALLOWED_DUPLICATES: readonly string[] = [];

describe('PLAIN_NAMES tables', () => {
  it('every value is a non-empty string with no underscore', () => {
    for (const [kind, map] of Object.entries(PLAIN_NAMES)) {
      for (const [id, value] of Object.entries(map)) {
        const text = value as unknown;
        expect(typeof text, `${kind}.${id}`).toBe('string');
        expect((text as string).length, `${kind}.${id} is empty`).toBeGreaterThan(0);
        expect((text as string).includes('_'), `${kind}.${id} contains "_"`).toBe(false);
      }
    }
  });

  it('values are unique within each map (only the allow-listed duplicates)', () => {
    const found: string[] = [];
    for (const [kind, map] of Object.entries(PLAIN_NAMES)) {
      const seen = new Map<string, string>();
      for (const [id, value] of Object.entries(map)) {
        const text = value as string;
        const first = seen.get(text);
        if (first !== undefined) found.push(`${kind}: "${text}" (${first}, ${id})`);
        else seen.set(text, id);
      }
    }
    expect(found.sort()).toEqual([...ALLOWED_DUPLICATES].sort());
  });
});

describe('coined roots stay out of player-visible names', () => {
  it('no SPECIES name contains a coined root', () => {
    for (const def of SPECIES) {
      const lower = def.name.toLowerCase();
      for (const root of COINED_ROOTS) {
        expect(lower.includes(root), `species "${def.name}" contains "${root}"`).toBe(false);
      }
    }
  });

  it('no POWERS name contains a coined root', () => {
    for (const power of POWERS) {
      const lower = power.name.toLowerCase();
      for (const root of COINED_ROOTS) {
        expect(lower.includes(root), `power "${power.name}" contains "${root}"`).toBe(false);
      }
    }
  });
});

describe('plainName fallbacks', () => {
  it('humanizes a missing id when no fallback is given', () => {
    expect(plainName('spell', 'no_such_id')).toBe('No such id');
  });

  it('uses the given fallback when the id is missing', () => {
    expect(plainName('species', 'x_y', 'Given')).toBe('Given');
  });
});

describe('strain labels in snapshots', () => {
  it('label a strain by its current species name, not the stored coined name', () => {
    const sim = generateRealm({ seed: 20240601, sizeStep: 2, template: 'continent' }).sim;
    const idx = speciesIndex('thistlehart');
    const def = SPECIES[idx];
    expect(def).toBeDefined();
    const strain = sim.beings.strains.create(idx, 'Coined Species Name', 0, 0, []);
    const detail = buildSnapshot(sim).detail;
    const row = detail?.strains.find((r) => r.id === strain.id);
    expect(row).toBeDefined();
    expect(row?.name).toBe(`${def?.name ?? ''} ${strain.id}`);
    expect(row?.name.includes('Coined Species Name')).toBe(false);
    // The stored name is left as saved.
    expect(sim.beings.strains.get(strain.id)?.name).toBe(`Coined Species Name ${strain.id}`);
  });
});
