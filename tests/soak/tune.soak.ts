import { expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { seedStartingBeasts } from '../../src/sim/beings/system.ts';
import { TUNING, type Tuning } from '../../src/sim/beings/tuning.ts';
import { SPECIES } from '../../src/content/beasts.ts';

/**
 * Balance sweep. TUNE_JSON overrides TUNING; every seed runs 10 sim-years and one JSON line per
 * config is appended to SOAK_LOG. Also the M3 exit check: every species survives and the total
 * stays within bounds on every seed (asserted when STRICT=1).
 */
const seeds = [2024, 7, 99];

function run(seed: number): { species: number[]; total: number[]; years: number } {
  const { sim } = generateRealm({ seed, sizeStep: 4, template: 'continent', startingBeasts: false });
  for (let round = 0; round < 400 && sim.beings.store.size < 1000; round++) seedStartingBeasts(sim, 40);
  const totals: number[] = [];
  let species: number[] = [];
  for (let year = 1; year <= 10; year++) {
    for (let t = 0; t < 1200; t++) sim.step();
    totals.push(sim.beings.store.size);
    species = SPECIES.map((_, k) => {
      let n = 0;
      for (let j = 0; j < sim.beings.store.size; j++) if (sim.beings.store.species[sim.beings.store.at(j)] === k) n++;
      return n;
    });
  }
  return { species, total: totals, years: 10 };
}

it('sweep', () => {
  const overrides = JSON.parse(process.env['TUNE_JSON'] ?? '{}') as Partial<Tuning>;
  Object.assign(TUNING, overrides);
  const results = seeds.map(run);
  const survivors = results.map((r) => r.species.filter((n) => n > 0).length);
  const totalsY10 = results.map((r) => r.total[9] ?? 0);
  const line = { overrides, survivors, species: SPECIES.length, totalY10: totalsY10, perSeedSpecies: results.map((r) => r.species) };
  appendFileSync(process.env['SOAK_LOG'] ?? 'sweep.log', JSON.stringify(line) + '\n');
  if (process.env['STRICT'] === '1') {
    for (const r of results) {
      expect(r.species.every((n) => n > 0)).toBe(true);
      expect(r.total[9]).toBeGreaterThan(300);
      expect(r.total[9]).toBeLessThan(3000);
    }
  }
});
