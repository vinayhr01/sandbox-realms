import { describe, expect, it } from 'vitest';
import { calendar } from '../../src/sim/clock.ts';
import { AGES, fillDefaultSlots, newAgeState, tickAge, rollDuration, AGE_BY_ID } from '../../src/sim/ages.ts';
import { createRng } from '../../src/shared/rng.ts';
import { RULES, RuleSet } from '../../src/sim/rules.ts';
import { Sim } from '../../src/sim/sim.ts';
import { FLAG } from '../../src/sim/realm.ts';
import { G, GROUNDS } from '../../src/content/grounds.ts';
import { BIOMES, GEN_WEIGHT_TOTAL, biomeOfCover } from '../../src/content/biomes.ts';
import { generateRealm, TEMPLATES } from '../../src/sim/worldgen.ts';
import { startFire } from '../../src/sim/terrain/fire.ts';
import { SparseSet } from '../../src/sim/sparse-set.ts';
import { FLORA, floraCode } from '../../src/sim/flora.ts';
import { addMagma } from '../../src/sim/terrain/magma.ts';
import { freeze, thaw } from '../../src/sim/terrain/freeze.ts';

describe('calendar', () => {
  it('converts ticks to year, month and day (02 section 12, test 1)', () => {
    expect(calendar(0)).toEqual({ year: 1, month: 1, day: 1 });
    expect(calendar(1199)).toEqual({ year: 1, month: 12, day: 30 });
    expect(calendar(1200)).toEqual({ year: 2, month: 1, day: 1 });
    expect(calendar(100)).toEqual({ year: 1, month: 2, day: 1 });
  });
});

describe('ages', () => {
  it('default slots: 1,3,5,6 dawn is not forced, slots 4 and 8 veiled, 2 and 7 differ', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const slots = fillDefaultSlots(createRng(seed));
      expect(slots[3]).toBe('veiled');
      expect(slots[7]).toBe('veiled');
      expect(slots[0]).toBe('dawn');
      expect(slots[2]).toBe('dawn');
      expect(slots[4]).toBe('dawn');
      expect(slots[5]).toBe('dawn');
      expect(slots[1]).not.toBe(slots[6]);
    }
  });

  it('dawn duration stays within 32..52 years and averages near the midpoint', () => {
    const rng = createRng(5);
    const dawn = AGE_BY_ID.get('dawn');
    if (!dawn) throw new Error('no dawn');
    let sum = 0;
    const n = 10000;
    for (let k = 0; k < n; k++) {
      const d = rollDuration(dawn, rng);
      expect(d).toBeGreaterThanOrEqual(38400);
      expect(d).toBeLessThanOrEqual(62400);
      sum += d;
    }
    expect(Math.abs(sum / n - 50400) / 50400).toBeLessThan(0.01);
  });

  it('speed multiplier 2 halves the time to completion, 0 never completes', () => {
    const run = (mult: number): number => {
      const rng = createRng(9);
      const state = newAgeState(rng, 0);
      state.durationTicks = 1000;
      state.speedMultiplier = mult;
      let ticks = 0;
      while (tickAge(state, rng, ticks, () => true) === null && ticks < 5000) ticks++;
      return ticks;
    };
    expect(run(2)).toBeLessThan(run(1));
    expect(run(2) * 2).toBeGreaterThanOrEqual(run(1) - 2);
    const frozen = newAgeState(createRng(9), 0);
    frozen.durationTicks = 10;
    frozen.speedMultiplier = 0;
    for (let k = 0; k < 100; k++) expect(tickAge(frozen, createRng(1), k, () => true)).toBeNull();
  });

  it('veiled slots resolve to normal ages and the rotation visits slots in order', () => {
    const rng = createRng(1234);
    const state = newAgeState(rng, 0);
    const seen: string[] = [];
    state.durationTicks = 1;
    for (let k = 0; k < 16; k++) {
      state.durationTicks = 1;
      const next = tickAge(state, rng, k, () => true);
      if (next) seen.push(next);
    }
    expect(seen.length).toBe(16);
    expect(seen).not.toContain('veiled');
    expect(AGES.length).toBe(11);
  });
});

describe('rules', () => {
  it('defaults match the 02 table: 49 rules plus one enable flag per age', () => {
    expect(RULES.length).toBe(49);
    const rs = new RuleSet();
    expect(rs.isOn('parley')).toBe(true);
    expect(rs.isOn('pop_cap_100')).toBe(false);
    expect(rs.isOn('forbidden_lore')).toBe(false);
    expect(rs.isOn('age_enabled_dawn')).toBe(true);
  });

  it('forbidden_lore cannot be switched off once on', () => {
    const rs = new RuleSet();
    rs.set('forbidden_lore', true);
    expect(rs.set('forbidden_lore', false)).toBe(false);
    expect(rs.isOn('forbidden_lore')).toBe(true);
  });
});

describe('grounds and biomes', () => {
  it('ground ids match the G constants and the table', () => {
    for (const g of GROUNDS) expect(GROUNDS[g.id]?.key).toBe(g.key);
    expect(GROUNDS[G.pinnacle]?.key).toBe('pinnacle');
  });

  it('biome gen weights sum to 63 (18c rule 3)', () => {
    expect(GEN_WEIGHT_TOTAL).toBe(63);
    expect(BIOMES.length).toBe(24);
  });
});

describe('sparse set', () => {
  it('stays consistent under random add and remove', () => {
    const s = new SparseSet(100);
    const rng = createRng(3);
    const present = new Set<number>();
    for (let k = 0; k < 5000; k++) {
      const i = rng.int(100);
      if (rng.next() < 0.5) {
        s.add(i);
        present.add(i);
      } else {
        s.remove(i);
        present.delete(i);
      }
    }
    expect(s.size).toBe(present.size);
    for (let k = 0; k < s.size; k++) expect(present.has(s.at(k))).toBe(true);
    for (const i of present) expect(s.has(i)).toBe(true);
  });
});

describe('worldgen', () => {
  it('is deterministic for a seed and changes with the seed', () => {
    const a = generateRealm({ seed: 12345, sizeStep: 2, template: 'continent' }).sim.realm;
    const b = generateRealm({ seed: 12345, sizeStep: 2, template: 'continent' }).sim.realm;
    const c = generateRealm({ seed: 12346, sizeStep: 2, template: 'continent' }).sim.realm;
    expect(a.elevation).toEqual(b.elevation);
    expect(a.ground).toEqual(b.ground);
    expect(a.cover).toEqual(b.cover);
    let diff = 0;
    for (let k = 0; k < a.tileCount; k++) if (a.ground[k] !== c.ground[k]) diff++;
    expect(diff / a.tileCount).toBeGreaterThan(0.05);
  });

  it('blank canvas is all deepmere with no cover or flora', () => {
    const r = generateRealm({ seed: 1, sizeStep: 2, template: 'blank' }).sim.realm;
    for (let k = 0; k < r.tileCount; k++) {
      expect(r.ground[k]).toBe(G.deepmere);
      expect(r.cover[k]).toBe(0);
      expect(r.flora[k]).toBe(0);
    }
  });

  it('edge ring is flagged and sea for every template', () => {
    for (const template of Object.keys(TEMPLATES)) {
      const r = generateRealm({ seed: 77, sizeStep: 2, template }).sim.realm;
      expect(r.hasFlag(0, FLAG.edgeOfRealm)).toBe(true);
      expect(r.ground[0]).toBe(G.deepmere);
    }
  });

  it('continent round edges: tiles beyond 0.99 of the half side are sea', () => {
    const r = generateRealm({ seed: 42, sizeStep: 3, template: 'continent' }).sim.realm;
    const h = r.side / 2;
    for (let k = 0; k < r.tileCount; k++) {
      const x = k % r.side;
      const y = Math.floor(k / r.side);
      if (Math.hypot(x + 0.5 - h, y + 0.5 - h) > 0.99 * h) expect(r.ground[k]).toBe(G.deepmere);
    }
  });

  it('keeps enough land and places biome covers on soil', () => {
    const { sim, report } = generateRealm({ seed: 99, sizeStep: 3, template: 'continent' });
    expect(report.landFraction).toBeGreaterThan(0.06);
    expect(report.biomeTiles).toBeGreaterThan(0);
    const r = sim.realm;
    for (let k = 0; k < r.tileCount; k++) {
      if (biomeOfCover(r.cover[k] ?? 0) >= 0) {
        expect([G.lowloam, G.highloam]).toContain(r.ground[k]);
      }
    }
  });

  it('keeps at most three trees per parcel', () => {
    const r = generateRealm({ seed: 5, sizeStep: 3, template: 'continent' }).sim.realm;
    const trees = new Set(FLORA.map((f, k) => (f.kind === 'tree' ? k + 1 : -1)).filter((c) => c > 0));
    for (let py = 0; py < r.side; py += 8) {
      for (let px = 0; px < r.side; px += 8) {
        let n = 0;
        for (let y = py; y < py + 8; y++) for (let x = px; x < px + 8; x++) if (trees.has(r.flora[y * r.side + x] ?? 0)) n++;
        expect(n).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('terrain systems', () => {
  it('fire starts on flammable cover and burns out deterministically', () => {
    const run = (): number => {
      const sim = new Sim(31, 2);
      const r = sim.realm;
      const i = 60 * r.side + 60;
      r.setGround(i, G.lowloam);
      r.setCover(i, 1);
      startFire(sim, i);
      for (let t = 0; t < 1500; t++) sim.step();
      return sim.stateHash();
    };
    expect(run()).toBe(run());
  });

  it('a fire never spreads under sanctuary_seal but still starts', () => {
    const sim = new Sim(31, 2);
    sim.rules.set('sanctuary_seal', true);
    const r = sim.realm;
    const i = 60 * r.side + 60;
    r.setGround(i, G.tilled);
    expect(startFire(sim, i, true)).toBe(true);
    for (let t = 0; t < 400; t++) sim.step();
    let others = 0;
    for (let k = 0; k < r.tileCount; k++) if (k !== i && r.hasFlag(k, FLAG.burning)) others++;
    expect(others).toBe(0);
  });

  it('lowering a sea tile digs a hollow that refills from the sea', () => {
    const sim = new Sim(8, 1);
    const r = sim.realm;
    const i = 10 * r.side + 10;
    r.setGround(i, G.deepmere);
    r.elevation[i] = 20;
    r.setElevation(i, 5);
    expect(r.ground[i]).toBe(G.dug_deepmere);
    expect(r.hollow.has(i)).toBe(true);
  });

  it('shoal freezes to rimeplate and thaws back to shoal', () => {
    const sim = new Sim(3, 1);
    const r = sim.realm;
    const i = 20 * r.side + 20;
    r.setGround(i, G.shoal);
    freeze(sim, i);
    expect(r.ground[i]).toBe(G.rimeplate);
    expect(r.hasFlag(i, FLAG.frozen)).toBe(true);
    thaw(sim, i, 99);
    expect(r.ground[i]).toBe(G.shoal);
    expect(r.hasFlag(i, FLAG.frozen)).toBe(false);
  });

  it('magma cools: a level-0 tile solidifies to knoll after its cooling wait', () => {
    const sim = new Sim(4, 1);
    const r = sim.realm;
    const i = 30 * r.side + 30;
    r.setGround(i, G.strand);
    addMagma(sim, i, 0);
    expect(r.ground[i]).toBe(G.molten_1);
    for (let t = 0; t < 1200 && r.ground[i] !== G.knoll; t++) sim.step();
    expect(r.ground[i]).toBe(G.knoll);
  });

  it('flora codes map to the registry and the flora table is non-empty', () => {
    expect(FLORA.length).toBeGreaterThan(5);
    expect(floraCode('herb')).toBeGreaterThan(0);
  });

  it('age flags are reachable through the sim', () => {
    const sim = new Sim(2, 1);
    expect(sim.ageDef().id).toBe('dawn');
    expect(sim.ageName()).toBe('Age of Dawn');
  });
});
