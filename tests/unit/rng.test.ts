import { describe, expect, it } from 'vitest';
import { createRng, hash3 } from '../../src/shared/rng.ts';

describe('seeded rng', () => {
  it('same seed gives the same sequence', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('different seeds diverge', () => {
    const a = createRng(1);
    const b = createRng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++;
    expect(same).toBeLessThan(3);
  });

  it('next is in [0,1) and int is in [0,n)', () => {
    const r = createRng(7);
    for (let i = 0; i < 5000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const k = r.int(10);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(10);
    }
  });

  it('stateless hash is stable and spreads values', () => {
    expect(hash3(9, 3, 4)).toBe(hash3(9, 3, 4));
    expect(hash3(9, 3, 4)).not.toBe(hash3(9, 4, 3));
  });
});
