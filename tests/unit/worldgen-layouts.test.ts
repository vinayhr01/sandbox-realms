import { describe, expect, it } from 'vitest';
import { G, ground } from '../../src/content/grounds.ts';
import { biomeOfCover } from '../../src/content/biomes.ts';
import { FLAG, type Realm } from '../../src/sim/realm.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';

const PATCH = 16;
const PARCEL = 8;

function realmOf(template: string, seed: number, sizeStep = 3): Realm {
  return generateRealm({ seed, sizeStep, template }).sim.realm;
}

/** Chessboard (03 section 9.1, acceptance test 7). */
describe('chessboard layout', () => {
  it('neighbouring Patches differ in biome family and each Patch has one cover', () => {
    const r = realmOf('chessboard', 99);
    // Covers of the checker tiles only (mountain walls and the edge ring are not checker tiles).
    const patchCover = (px: number, py: number): Set<number> => {
      const s = new Set<number>();
      for (let y = py * PATCH; y < (py + 1) * PATCH; y++) {
        for (let x = px * PATCH; x < (px + 1) * PATCH; x++) {
          const k = y * r.side + x;
          if (r.ground[k] === G.highloam || r.ground[k] === G.lowloam) s.add(r.cover[k] ?? 0);
        }
      }
      return s;
    };
    const a = [...patchCover(0, 0)];
    const b = [...patchCover(1, 0)];
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(biomeOfCover(a[0] ?? 0)).not.toBe(biomeOfCover(b[0] ?? 0));
    const per = r.side / PATCH;
    for (let py = 1; py < per - 1; py++) {
      for (let px = 1; px < per - 1; px++) expect(patchCover(px, py).size).toBe(1);
    }
  });

  it('the checker alternates highloam and lowloam by Patch parity', () => {
    const r = realmOf('chessboard', 99);
    expect(r.ground[(PATCH / 2) * r.side + PATCH / 2]).toBe(G.highloam);
    expect(r.ground[(PATCH / 2) * r.side + PATCH + PATCH / 2]).toBe(G.lowloam);
  });
});

/** Cells (03 section 9.1, acceptance test 8, in a looser form). */
describe('cells layout', () => {
  it('has room walls of crag and knoll doorways that open into a wall', () => {
    const r = realmOf('cells', 21);
    let knolls = 0;
    let crags = 0;
    for (let k = 0; k < r.tileCount; k++) {
      if (r.ground[k] === G.crag) crags++;
      if (r.ground[k] !== G.knoll || r.hasFlag(k, FLAG.edgeOfRealm)) continue;
      knolls++;
      const x = k % r.side;
      const y = Math.floor(k / r.side);
      let nearWall = false;
      for (let dy = -2; dy <= 2 && !nearWall; dy++) {
        for (let dx = -2; dx <= 2 && !nearWall; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= r.side || yy >= r.side) continue;
          if (r.ground[yy * r.side + xx] === G.crag) nearWall = true;
        }
      }
      expect(nearWall).toBe(true);
    }
    expect(knolls).toBeGreaterThan(0);
    expect(crags).toBeGreaterThan(0);
  });
});

/** Warren (03 section 9.1, acceptance test 9). */
describe('warren layout', () => {
  it('is mostly rock or highloam and all five anchors share one walkable component', () => {
    const r = realmOf('warren', 8);
    const side = r.side;
    const n = side / PARCEL;
    let rockOrHigh = 0;
    for (let k = 0; k < r.tileCount; k++) {
      const g = r.ground[k] ?? 0;
      if (g === G.highloam || ground(g).layer === 'blocked') rockOrHigh++;
    }
    expect(rockOrHigh / r.tileCount).toBeGreaterThanOrEqual(0.9);

    const off = Math.floor(n / 10) + 1;
    const anchors = [
      [off, off],
      [n - 1 - off, off],
      [n - 1 - off, n - 1 - off],
      [off, n - 1 - off],
      [Math.floor(n / 2), Math.floor(n / 2)],
    ].map(([px, py]) => (py! * PARCEL + PARCEL / 2) * side + (px! * PARCEL + PARCEL / 2));

    const seen = new Uint8Array(r.tileCount);
    const stack = [anchors[0] ?? 0];
    seen[anchors[0] ?? 0] = 1;
    while (stack.length > 0) {
      const i = stack.pop() ?? 0;
      const x = i % side;
      const y = Math.floor(i / side);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= side || yy >= side) continue;
        const j = yy * side + xx;
        if (seen[j] || ground(r.ground[j] ?? 0).layer === 'blocked' || ground(r.ground[j] ?? 0).layer === 'water') continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    for (const a of anchors) expect(seen[a]).toBe(1);
  });
});

/** Sleeping Crater (03 section 8, startVolcano): a 6x6 molten footprint at generation. */
describe('sleeping crater volcano', () => {
  it('places one 6x6 molten_4 footprint', () => {
    const r = realmOf('sleeping_crater', 5, 2);
    const molten: number[] = [];
    for (let k = 0; k < r.tileCount; k++) if (r.ground[k] === G.molten_4) molten.push(k);
    expect(molten.length).toBe(36);
    const xs = molten.map((k) => k % r.side);
    const ys = molten.map((k) => Math.floor(k / r.side));
    expect(Math.max(...xs) - Math.min(...xs)).toBe(5);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(5);
  });
});
