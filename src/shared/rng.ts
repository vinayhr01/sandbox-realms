/**
 * Seeded PRNG (sfc32) and a stateless 32-bit hash. Simulation code must use these
 * and never the platform random or wall-clock functions (02-TECH-STACK determinism rule, 17 section 7).
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** The four sfc32 state words, for saving a stream exactly. */
  state(): [number, number, number, number];
  /** Restores the state returned by state(). */
  restore(words: readonly number[]): void;
}

/** Derives four 32-bit state words from one seed with splitmix32. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const mix = splitmix32(seed);
  let a = mix();
  let b = mix();
  let c = mix();
  let d = mix();
  const nextU32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
  for (let i = 0; i < 12; i++) nextU32();
  return {
    next: () => nextU32() / 4294967296,
    int: (n: number) => Math.floor((nextU32() / 4294967296) * n),
    state: () => [a, b, c, d],
    restore: (words: readonly number[]) => {
      a = (words[0] ?? 0) >>> 0;
      b = (words[1] ?? 0) >>> 0;
      c = (words[2] ?? 0) >>> 0;
      d = (words[3] ?? 0) >>> 0;
    },
  };
}

/** Stateless hash of up to three integers plus a seed; used for per-tile variation. */
export function hash3(seed: number, x: number, y: number): number {
  let h = Math.imul(seed ^ 0x27d4eb2d, 0x165667b1);
  h = Math.imul(h ^ x, 0x85ebca77);
  h = Math.imul(h ^ y, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** FNV-1a offset basis and prime (32-bit). */
export const FNV_OFFSET = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;

/**
 * FNV-1a over a sequence of values (bytes, or char codes for names), starting from `start`.
 * The one FNV implementation: checksums, replay checkpoints and named stream seeds all use it.
 * Returns an unsigned 32-bit value.
 */
export function fnv1a(data: ArrayLike<number>, start: number = FNV_OFFSET): number {
  let h = start;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i] ?? 0;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}
