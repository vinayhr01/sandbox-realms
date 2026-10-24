import { describe, expect, it } from 'vitest';
import { AGE_REST_MS, BREATH_EVERY_MS, NO_RESTS, REST_GROUPS, RestPlanner, applyRests, type Rests } from '../../src/audio/breathing.ts';
import { STEM_DEFS } from '../../src/audio/music.ts';

/** Runs the planner once a second from 0 to `endMs` and returns the rests seen at each step. */
function run(planner: RestPlanner, endMs: number, frequency: 'constant' | 'often' | 'occasional'): Rests[] {
  const out: Rests[] = [];
  for (let t = 0; t <= endMs; t += 1000) out.push(planner.update(t, frequency));
  return out;
}

describe('breathing rests (16 B8 rules 7 and 8)', () => {
  it('rests one non-Bed group after four minutes of continuous music, for one to two minutes', () => {
    const planner = new RestPlanner(() => 0);
    planner.reset();
    const seen = run(planner, BREATH_EVERY_MS + 61_000, 'constant');
    const at = BREATH_EVERY_MS / 1000;
    expect(seen[at - 1]?.group).toBeNull();
    expect(seen[at]?.group).toBe('mood');
    // With rand() = 0 the rest is the minimum, one minute: it ends at five minutes.
    expect(seen[at + 59]?.group).toBe('mood');
    expect(seen[at + 60]?.group).toBeNull();
  });

  it('rotates through the groups, one per breath', () => {
    const planner = new RestPlanner(() => 0);
    planner.reset();
    const groups: string[] = [];
    let t = 0;
    for (let k = 0; k < REST_GROUPS.length; k++) {
      let r = planner.update(t, 'constant');
      while (r.group === null) {
        t += 1000;
        r = planner.update(t, 'constant');
      }
      groups.push(r.group);
      while (r.group !== null) {
        t += 1000;
        r = planner.update(t, 'constant');
      }
    }
    expect(groups).toEqual([...REST_GROUPS]);
  });

  it('never rests the whole mix during breathing', () => {
    const planner = new RestPlanner(() => 0);
    planner.reset();
    const seen = run(planner, BREATH_EVERY_MS + 5000, 'constant');
    expect(seen.every((r) => !r.full)).toBe(true);
  });

  it('the Age layer rests for one loop when the 25 % roll hits every ten minutes of music', () => {
    const planner = new RestPlanner(() => 0);
    planner.reset();
    const seen = run(planner, 600_000 + 30_000, 'constant');
    expect(seen[600]?.age).toBe(true);
    expect(seen[600 + AGE_REST_MS / 1000 - 1]?.age).toBe(true);
    expect(seen[600 + AGE_REST_MS / 1000]?.age).toBe(false);
  });

  it('does not rest the Age layer when the roll misses', () => {
    const planner = new RestPlanner(() => 0.99);
    planner.reset();
    const seen = run(planner, 600_000 + 1000, 'constant');
    expect(seen.some((r) => r.age)).toBe(false);
  });
});

describe('frequency rests (16 B8 rule 10)', () => {
  it('constant music never takes a full rest', () => {
    const planner = new RestPlanner(() => 0);
    planner.reset();
    expect(run(planner, 15 * 60_000, 'constant').some((r) => r.full)).toBe(false);
  });

  it('occasional music rests fully after a three minute passage, for 90 seconds', () => {
    const planner = new RestPlanner(() => 0);
    planner.reset();
    const seen = run(planner, 300_000, 'occasional');
    expect(seen[179]?.full).toBe(false);
    expect(seen[180]?.full).toBe(true);
    expect(seen[269]?.full).toBe(true);
    expect(seen[270]?.full).toBe(false);
  });
});

describe('applying rests to the stem targets', () => {
  const all = Object.fromEntries(STEM_DEFS.map((d) => [d.id, 0.5]));

  it('a group rest zeroes that group and leaves the Bed', () => {
    const out = applyRests(all, { full: false, group: 'mood', age: false }, STEM_DEFS);
    expect(out['mood_calm_melody']).toBe(0);
    expect(out['bed_a']).toBe(0.5);
    expect(out['age_dawn']).toBe(0.5);
  });

  it('an Age rest zeroes the Age stems only', () => {
    const out = applyRests(all, { full: false, group: null, age: true }, STEM_DEFS);
    expect(out['age_dawn']).toBe(0);
    expect(out['bed_a']).toBe(0.5);
  });

  it('a full rest zeroes everything, the Bed included, and does not change its input', () => {
    const out = applyRests(all, { full: true, group: null, age: false }, STEM_DEFS);
    expect(Object.values(out).every((v) => v === 0)).toBe(true);
    expect(all['bed_a']).toBe(0.5);
  });

  it('no rests leaves the targets alone', () => {
    expect(applyRests(all, NO_RESTS, STEM_DEFS)).toEqual(all);
  });
});
