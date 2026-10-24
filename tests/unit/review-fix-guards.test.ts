import { describe, expect, it } from 'vitest';
import { Cmd, type Command } from '../../src/shared/protocol.ts';
import { fnv1a } from '../../src/shared/rng.ts';
import { Sim } from '../../src/sim/sim.ts';
import { applyStroke, lineTiles } from '../../src/sim/brush.ts';
import { RuleSet } from '../../src/sim/rules.ts';
import { SparseSet } from '../../src/sim/sparse-set.ts';
import { BeingStore } from '../../src/sim/beings/store.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';

describe('sparse set membership (review fix 9)', () => {
  it('out-of-range indexes are not members and do not throw', () => {
    const set = new SparseSet(8);
    set.add(3);
    expect(set.has(3)).toBe(true);
    expect(set.has(8)).toBe(false);
    expect(set.has(1000)).toBe(false);
    expect(set.has(-1)).toBe(false);
  });
});

describe('rule ids (review fix 8)', () => {
  it('refuses unknown ids and keeps the state', () => {
    const rules = new RuleSet();
    const before = rules.snapshot();
    expect(rules.set('no_such_rule', true)).toBe(false);
    expect(rules.snapshot()).toEqual(before);
    expect(rules.isOn('no_such_rule')).toBe(false);
  });

  it('accepts a known rule and an age enable flag', () => {
    const rules = new RuleSet();
    expect(rules.set('hunger', false)).toBe(true);
    expect(rules.isOn('hunger')).toBe(false);
    expect(rules.set('age_enabled_dawn', false)).toBe(true);
    expect(rules.set('age_enabled_no_such_age', false)).toBe(false);
  });

  it('a queued SetRule with an unknown id is reported as a refusal', () => {
    const sim = generateRealm({ seed: 7, sizeStep: 2, template: 'continent' }).sim;
    sim.enqueue({ kind: Cmd.SetRule, seq: 0, rule: 'no_such_rule', on: true } as Command);
    sim.step();
    expect(sim.takeRefusals()).toHaveLength(1);
    expect(sim.takeRefusals()).toHaveLength(0);
  });
});

describe('brush endpoints (review fix 7)', () => {
  it('a non-finite endpoint visits nothing', () => {
    const visited: [number, number][] = [];
    lineTiles(Number.NaN, 0, 3, 3, (x, y) => visited.push([x, y]));
    lineTiles(0, 0, Number.POSITIVE_INFINITY, 3, (x, y) => visited.push([x, y]));
    expect(visited).toHaveLength(0);
  });

  it('fractional endpoints round to whole tiles and the line still ends', () => {
    const visited: [number, number][] = [];
    lineTiles(0, 0, 2.4, 0.2, (x, y) => visited.push([x, y]));
    expect(visited[visited.length - 1]).toEqual([2, 0]);
  });

  it('a stroke with non-finite coordinates changes nothing', () => {
    const sim = generateRealm({ seed: 9, sizeStep: 2, template: 'continent' }).sim;
    const before = sim.realm.elevation.slice();
    expect(applyStroke(sim.realm, 'raise', 'circle', 2, Number.NaN, 5, 5, 5, true)).toBe(0);
    expect(sim.realm.elevation).toEqual(before);
  });

  it('a stroke far outside the realm is clamped and still finishes', () => {
    const sim = generateRealm({ seed: 9, sizeStep: 2, template: 'continent' }).sim;
    const t0 = Date.now();
    applyStroke(sim.realm, 'raise', 'square', 0, -1e9, -1e9, 1e9, 1e9, true);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('beings layout restore (review fix 6)', () => {
  it('rejects a free stack that repeats a slot, names a live slot or is out of range', () => {
    const store = new BeingStore(4);
    expect(() => store.restoreLayout([0, 1], [1, 2])).toThrow();
    expect(() => store.restoreLayout([0], [0, 1, 2])).toThrow();
    expect(() => store.restoreLayout([0], [9])).toThrow();
    expect(() => store.restoreLayout([0, 0], [2, 3])).toThrow();
  });

  it('accepts a consistent layout', () => {
    const store = new BeingStore(4);
    expect(() => store.restoreLayout([2, 0], [1, 3])).not.toThrow();
    expect(store.layout()).toEqual({ list: [2, 0], free: [1, 3] });
  });
});

describe('FNV shared implementation (review fix 5)', () => {
  it('matches the published FNV-1a test values', () => {
    expect(fnv1a(new Uint8Array(0))).toBe(0x811c9dc5);
    expect(fnv1a(new Uint8Array([0x61]))).toBe(0xe40c292c);
    expect(fnv1a(new Uint8Array([0x61, 0x62, 0x63]))).toBe(0x1a47e90b);
  });

  it('a fresh sim hashes to the same value twice', () => {
    expect(new Sim(11, 2).stateHash()).toBe(new Sim(11, 2).stateHash());
  });
});
