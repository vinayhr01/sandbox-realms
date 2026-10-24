import { describe, expect, it } from 'vitest';
import { G, GROUND_BY_ELEVATION, ground } from '../../src/content/grounds.ts';
import { FLAG, type Realm } from '../../src/sim/realm.ts';
import { generateRealm, type GenParams } from '../../src/sim/worldgen.ts';

function gen(template: string, overrides: Partial<GenParams>, seed = 42): Realm {
  return generateRealm({ seed, sizeStep: 3, template, overrides }).sim.realm;
}

function changedTiles(a: Realm, b: Realm): number[] {
  const out: number[] = [];
  for (let k = 0; k < a.tileCount; k++) if (a.ground[k] !== b.ground[k] || a.elevation[k] !== b.elevation[k]) out.push(k);
  return out;
}

/** Rivers and lakes (03 section 7): the carved tiles are the only change, and they take the right kinds. */
describe('rivers and lakes', () => {
  it('rivers change only tiles that become shoal, and some change', () => {
    const base = gen('continent', { rivers: 0, lakes: 0, replaceRules: [] }, 42);
    const rivers = gen('continent', { rivers: 3, lakes: 0, replaceRules: [] }, 42);
    const changed = changedTiles(base, rivers);
    expect(changed.length).toBeGreaterThan(20);
    for (const k of changed) expect(rivers.ground[k]).toBe(G.shoal);
  });

  it('lakes change only tiles that become shoal or strand shore', () => {
    const base = gen('continent', { rivers: 0, lakes: 0, replaceRules: [] }, 11);
    const lakes = gen('continent', { rivers: 0, lakes: 2, replaceRules: [] }, 11);
    const changed = changedTiles(base, lakes);
    expect(changed.length).toBeGreaterThan(0);
    for (const k of changed) expect([G.shoal, G.strand]).toContain(lakes.ground[k]);
  });

  it('with rivers, lakes and replace rules off, every tile sits in the band of its elevation', () => {
    const r = gen('continent', { rivers: 0, lakes: 0, replaceRules: [] }, 99);
    let mismatch = 0;
    for (let k = 0; k < r.tileCount; k++) {
      if (r.hasFlag(k, FLAG.edgeOfRealm)) continue;
      if (r.ground[k] !== GROUND_BY_ELEVATION[r.elevation[k] ?? 0]) mismatch++;
    }
    expect(mismatch).toBe(0);
  });

  it('river and lake generation is deterministic', () => {
    const a = gen('continent', {}, 5);
    const b = gen('continent', {}, 5);
    expect(a.ground).toEqual(b.ground);
    expect(a.elevation).toEqual(b.elevation);
  });
});

/** Replace rules (03 section 5.1). */
describe('replace rules', () => {
  it('Open Plains: no water tile remains except the edge ring', () => {
    const r = gen('open_plains', {}, 11);
    for (let k = 0; k < r.tileCount; k++) {
      if (r.hasFlag(k, FLAG.edgeOfRealm)) continue;
      expect(ground(r.ground[k] ?? 0).layer).not.toBe('water');
    }
  });

  it('a rule only rewrites tiles of its source kind and never the edge ring', () => {
    const base = gen('continent', { rivers: 0, lakes: 0, replaceRules: [] }, 3);
    const replaced = gen('continent', { rivers: 0, lakes: 0, replaceRules: [{ threshold: 0, from: 'highloam', to: 'strand' }] }, 3);
    for (let k = 0; k < base.tileCount; k++) {
      if (base.ground[k] === replaced.ground[k]) continue;
      expect(base.ground[k]).toBe(G.highloam);
      expect(replaced.ground[k]).toBe(G.strand);
      expect(replaced.hasFlag(k, FLAG.edgeOfRealm)).toBe(false);
    }
  });
});
