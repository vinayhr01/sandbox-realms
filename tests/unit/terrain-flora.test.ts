import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim.ts';
import { G } from '../../src/content/grounds.ts';
import { BIOMES, biomeCoverId } from '../../src/content/biomes.ts';
import { FLORA, FLORA_BY_ID, floraCode, mineralSeeding } from '../../src/sim/flora.ts';
import { meteorImpact } from '../../src/sim/terrain/meteor.ts';

const VERDANT = BIOMES.findIndex((b) => b.id === 'verdant_reach');

/** Mutable view of a flora def, used to force a spread chance for one test. */
function setSpreadChance(id: string, chance: number): number {
  const def = FLORA[FLORA_BY_ID.get(id) ?? 0];
  if (!def) throw new Error(`no flora ${id}`);
  const before = def.spreadChance;
  (def as { spreadChance: number }).spreadChance = chance;
  return before;
}

/** A verdant-covered lowloam patch, so trees may stand on it. */
function verdantPatch(sim: Sim): void {
  const r = sim.realm;
  for (let y = 20; y < 60; y++) {
    for (let x = 20; x < 60; x++) {
      const i = y * r.side + x;
      r.setGround(i, G.lowloam);
      r.setCover(i, biomeCoverId(VERDANT, false));
    }
  }
}

describe('tree spread (04 section 10, 14)', () => {
  it('a tree seeds within 1 + spreadSteps tiles of its parent, on the spread timer', () => {
    const before = setSpreadChance('broadleaf_a', 1);
    try {
      const sim = new Sim(11, 1);
      const r = sim.realm;
      sim.rules.set('wild_seeding', false);
      verdantPatch(sim);
      const parent = 40 * r.side + 40;
      r.setFlora(parent, floraCode('broadleaf_a'), 0);
      for (let t = 0; t < 1100; t++) sim.step();
      const trees: number[] = [];
      for (let i = 0; i < r.tileCount; i++) if (r.flora[i] === floraCode('broadleaf_a') && i !== parent) trees.push(i);
      expect(trees.length).toBeGreaterThan(0);
      for (const t of trees) {
        const dx = Math.abs((t % r.side) - 40);
        const dy = Math.abs(Math.floor(t / r.side) - 40);
        expect(Math.max(dx, dy)).toBeLessThanOrEqual(2);
      }
    } finally {
      setSpreadChance('broadleaf_a', before);
    }
  });

  it('with tree_spread off nothing grows over ten timer periods', () => {
    const before = setSpreadChance('broadleaf_a', 1);
    try {
      const sim = new Sim(12, 1);
      const r = sim.realm;
      sim.rules.set('wild_seeding', false);
      sim.rules.set('tree_spread', false);
      verdantPatch(sim);
      r.setFlora(40 * r.side + 40, floraCode('broadleaf_a'), 0);
      for (let t = 0; t < 10 * 1000 + 10; t++) sim.step();
      let trees = 0;
      for (let i = 0; i < r.tileCount; i++) if (r.flora[i] === floraCode('broadleaf_a')) trees++;
      expect(trees).toBe(1);
    } finally {
      setSpreadChance('broadleaf_a', before);
    }
  });
});

describe('minerals (04 section 10, 18d section 6)', () => {
  it('mineral seeding puts nodes on hills and keeps at most two per Parcel', () => {
    const sim = new Sim(13, 1);
    const r = sim.realm;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) r.setElevation(y * r.side + x, 200);
    mineralSeeding(sim, 4000);
    let nodes = 0;
    for (let i = 0; i < r.tileCount; i++) {
      const def = FLORA[(r.flora[i] ?? 0) - 1];
      if (def?.kind !== 'mineral') continue;
      nodes++;
      expect([G.knoll, G.crag, G.highloam]).toContain(r.ground[i]);
    }
    expect(nodes).toBeGreaterThan(0);
    for (let py = 0; py < 64; py += 8) {
      for (let px = 0; px < 64; px += 8) {
        let n = 0;
        for (let y = py; y < py + 8; y++) for (let x = px; x < px + 8; x++) if (FLORA[(r.flora[y * r.side + x] ?? 0) - 1]?.kind === 'mineral') n++;
        expect(n).toBeLessThanOrEqual(2);
      }
    }
  });

  it('mineral_growth off stops natural seeding', () => {
    const sim = new Sim(14, 1);
    const r = sim.realm;
    sim.rules.set('mineral_growth', false);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) r.setElevation(y * r.side + x, 200);
    mineralSeeding(sim, 500);
    let nodes = 0;
    for (let i = 0; i < r.tileCount; i++) if (FLORA[(r.flora[i] ?? 0) - 1]?.kind === 'mineral') nodes++;
    expect(nodes).toBe(0);
  });
});

describe('meteors (04 section 8.1, 8.6)', () => {
  it('an impact leaves five mineral nodes: the impact tile and four in its Parcel', () => {
    const sim = new Sim(15, 1);
    const r = sim.realm;
    // High land so the crater (at most 50 elevation at the centre) leaves land behind.
    for (let y = 10; y < 60; y++) for (let x = 10; x < 60; x++) r.setElevation(y * r.side + x, 200);
    meteorImpact(sim, 30, 30, 'skyrock_small');
    let nodes = 0;
    for (let i = 0; i < r.tileCount; i++) if (FLORA[(r.flora[i] ?? 0) - 1]?.kind === 'mineral') nodes++;
    expect(nodes).toBe(5);
  });
});
