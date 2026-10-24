/** Integer hash of a lattice point (03 section 4: integer mixing only). */
export function hashCell(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Value noise in [0,1] (03 section 4 stand-in: value lattice, smootherstep blend). */
export function noise01(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smootherstep(x - x0);
  const ty = smootherstep(y - y0);
  const a = hashCell(x0, y0, seed) / 4294967296;
  const b = hashCell(x0 + 1, y0, seed) / 4294967296;
  const c = hashCell(x0, y0 + 1, seed) / 4294967296;
  const d = hashCell(x0 + 1, y0 + 1, seed) / 4294967296;
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
