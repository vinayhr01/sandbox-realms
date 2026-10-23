import { describe, expect, it } from 'vitest';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { ground } from '../../src/content/grounds.ts';
import { hamletsOf, HAMLETS_WANTED } from '../../src/sim/settlements/adapter.ts';

const YEAR = 1200;
const SECOND = 20;

/** Runs `years` sim years, sampling each hamlet's population once per sim-second. */
function runYears(seed: number, years: number) {
  const { sim } = generateRealm({ seed, sizeStep: 2, template: 'continent' });
  const samples = new Map<number, number[]>();
  for (let t = 1; t <= years * YEAR; t++) {
    sim.step();
    if (t % SECOND !== 0) continue;
    hamletsOf(sim).forEach((h, k) => {
      const list = samples.get(k) ?? [];
      list.push(h.folk);
      samples.set(k, list);
    });
  }
  return { sim, samples };
}

describe('settlements wiring', () => {
  it('after three sim years a hamlet on land has buildings and a changing population', () => {
    const { sim, samples } = runYears(31, 3);
    const hamlets = hamletsOf(sim);
    expect(hamlets.length).toBeGreaterThanOrEqual(1);
    expect(hamlets.length).toBeLessThanOrEqual(HAMLETS_WANTED);

    const built = hamlets
      .map((h, k) => ({ h, k }))
      .filter(({ h }) => h.buildings.length > 0);
    expect(built.length).toBeGreaterThanOrEqual(1);

    for (const { h } of built) {
      for (const b of h.buildings) {
        const kind = ground(sim.realm.ground[b.y * sim.realm.side + b.x] ?? 0);
        expect(kind.layer).toBe('land');
      }
    }

    const changed = built.some(({ k }) => new Set(samples.get(k)).size > 1);
    expect(changed).toBe(true);
  });

  it('the hamlet hook is deterministic: same seed gives the same hamlets and state hash', () => {
    const a = runYears(31, 1);
    const b = runYears(31, 1);
    const pa = hamletsOf(a.sim).map((h) => [...h.parcels, h.folk, h.buildings.length]);
    const pb = hamletsOf(b.sim).map((h) => [...h.parcels, h.folk, h.buildings.length]);
    expect(pa).toEqual(pb);
    expect(a.sim.stateHash()).toBe(b.sim.stateHash());
  });
});
