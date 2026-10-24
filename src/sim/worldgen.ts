import { BANDED, G, GROUND_BY_ELEVATION, ground, groundId } from '../content/grounds.ts';
import { BIOMES, biomeCoverId } from '../content/biomes.ts';
import { createRng, hash3, type Rng } from '../shared/rng.ts';
import { FLAG, Realm } from './realm.ts';
import { n4 } from './grid.ts';
import { Sim } from './sim.ts';
import { wildSeeding } from './flora.ts';
import { seedStartingBeasts } from './beings/system.ts';
import { noise01 } from './worldgen/noise.ts';
import { pickWeightedBiome, BIOME_WEIGHTS } from './worldgen/pick.ts';
import { carveLakes, carveRivers } from './worldgen/water.ts';
import { applyReplaceRules, type ReplaceRule } from './worldgen/replace.ts';
import { layoutCells, layoutChessboard, layoutWarren, placeVolcano, type Layout } from './worldgen/layouts.ts';

export { noise01 } from './worldgen/noise.ts';
export type { ReplaceRule, Layout };

/** Generation parameters (03 section 3), a subset used by the templates. */
export interface GenParams {
  noise1: number;
  noise2: number;
  noise3: number;
  roundEdges: boolean;
  squareEdges: boolean;
  centerLand: boolean;
  centerBasin: boolean;
  centerLake: boolean;
  shoreSnap: boolean;
  lowGround: boolean;
  highGround: boolean;
  removeMountains: boolean;
  mountainEdges: boolean;
  freezePeaks: boolean;
  randomBiomes: boolean;
  addFlora: boolean;
  shapes: number;
  forceHeight: number;
  /** Special layout (03 section 9.1). */
  layout: Layout;
  /** Patch-count scale of the Cells rooms (03 section 3, 2..15). */
  cellSize: number;
  /** River and lake counts (03 section 7, extensions 0..10). */
  rivers: number;
  lakes: number;
  replaceRules: ReplaceRule[];
  /** Starter volcano footprint at generation (03 section 8). */
  startVolcano: boolean;
}

export const DEFAULT_PARAMS: GenParams = {
  noise1: 5,
  noise2: 0,
  noise3: 0,
  roundEdges: false,
  squareEdges: false,
  centerLand: false,
  centerBasin: false,
  centerLake: false,
  shoreSnap: false,
  lowGround: false,
  highGround: false,
  removeMountains: false,
  mountainEdges: false,
  freezePeaks: false,
  randomBiomes: true,
  addFlora: true,
  shapes: 0,
  forceHeight: 0,
  layout: 'none',
  cellSize: 2,
  rivers: 0,
  lakes: 0,
  replaceRules: [],
  startVolcano: false,
};

/** Templates (03 section 9). Special layouts follow section 9.1; see DECISIONS.md for deviations. */
export const TEMPLATES: Readonly<Record<string, Partial<GenParams>>> = {
  continent: {
    noise2: 5,
    noise3: 5,
    roundEdges: true,
    centerLand: true,
    shoreSnap: true,
    shapes: 5,
    freezePeaks: true,
    rivers: 2,
    lakes: 1,
    replaceRules: [{ threshold: 168, from: 'highloam', to: 'lowloam' }],
  },
  walled_plain: {
    noise2: 5,
    noise3: 5,
    mountainEdges: true,
    centerLand: true,
    shoreSnap: true,
    shapes: 5,
    freezePeaks: true,
    rivers: 2,
    replaceRules: [{ threshold: 168, from: 'highloam', to: 'lowloam' }],
  },
  archipelago: { noise2: 5, noise3: 5, roundEdges: true, shoreSnap: true, shapes: 5, freezePeaks: true },
  isle_shape: { noise2: 5, noise3: 5, centerLand: true, removeMountains: true, shapes: 5 },
  open_plains: {
    centerLand: true,
    noise2: 5,
    noise3: 5,
    mountainEdges: true,
    removeMountains: true,
    randomBiomes: true,
    replaceRules: [
      { threshold: 0, from: 'shoal', to: 'lowloam' },
      { threshold: 0, from: 'midmere', to: 'lowloam' },
      { threshold: 0, from: 'deepmere', to: 'highloam' },
    ],
  },
  chessboard: { layout: 'chessboard', mountainEdges: true, removeMountains: true },
  cells: { layout: 'cells', cellSize: 2, mountainEdges: true, removeMountains: true },
  sleeping_crater: { forceHeight: 125, noise2: 5, roundEdges: true, centerLand: true, randomBiomes: false, startVolcano: true },
  holey_plain: {
    forceHeight: 120,
    noise2: 5,
    squareEdges: true,
    removeMountains: true,
    centerLand: true,
    replaceRules: [
      { threshold: 168, from: 'highloam', to: 'shoal' },
      { threshold: 168, from: 'strand', to: 'shoal' },
      { threshold: 148, from: 'highloam', to: 'strand' },
      { threshold: 128, from: 'lowloam', to: 'strand' },
      { threshold: 84, from: 'highloam', to: 'lowloam' },
    ],
  },
  ringland: { forceHeight: 125, noise2: 5, roundEdges: true, centerLand: true, centerLake: true },
  warren: { layout: 'warren', mountainEdges: true },
  blank: { noise1: 0, randomBiomes: false, addFlora: false },
};

/** Minimum land fraction per template (03 section 1; 3% Archipelago, 0 for Blank and Warren). */
const MIN_LAND: Readonly<Record<string, number>> = { blank: 0, warren: 0, archipelago: 0.03 };

export interface GenReport {
  attempts: number;
  landFraction: number;
  lowLand: boolean;
  biomeTiles: number;
  floraTiles: number;
}

/** Stable 32-bit hash of the request seed (strings hash with FNV-1a, numbers pass through). */
export function worldSeedOf(seed: number | string): number {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 0x811c9dc5;
  for (let k = 0; k < seed.length; k++) {
    h ^= seed.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface GenRequest {
  seed: number | string;
  sizeStep: number;
  template: string;
  overrides?: Partial<GenParams>;
  startingFlora?: boolean;
  startingBeasts?: boolean;
}

/**
 * Builds a new Sim from a generation request (03 section 1). Re-rolls with seed+1 (up to 8 times)
 * while the land fraction is below 6% (03 section 1 validation), and reports the final attempt.
 */
export function generateRealm(req: GenRequest): { sim: Sim; report: GenReport } {
  const base = worldSeedOf(req.seed);
  const params: GenParams = { ...DEFAULT_PARAMS, ...(TEMPLATES[req.template] ?? {}), ...(req.overrides ?? {}) };
  const minLand = MIN_LAND[req.template] ?? 0.06;
  let attempt = 0;
  let sim = buildOnce(base, req.sizeStep, params, req.startingFlora ?? true, req.startingBeasts ?? true);
  let land = landFraction(sim.realm);
  while (land < minLand && attempt < 8) {
    attempt++;
    sim = buildOnce(base + attempt, req.sizeStep, params, req.startingFlora ?? true, req.startingBeasts ?? true);
    land = landFraction(sim.realm);
  }
  return {
    sim,
    report: { attempts: attempt + 1, landFraction: land, lowLand: land < minLand, biomeTiles: countBiomeTiles(sim.realm), floraTiles: countFlora(sim.realm) },
  };
}

function buildOnce(seed: number, sizeStep: number, p: GenParams, flora: boolean, beasts: boolean): Sim {
  const sim = new Sim(seed, sizeStep);
  const realm = sim.realm;
  const rng = createRng(hash3(seed, 0x67656e, 1));
  const side = realm.side;
  const h = side / 2;
  const elev = new Float32Array(side * side);

  // Noise stages (03 section 4): stage 1 adds, 2 and 3 subtract finer detail.
  const stage = (alpha: number, scale: number, sign: 1 | -1): void => {
    if (scale <= 0) return;
    const offX = rng.int(1_000_000);
    const offY = rng.int(1_000_000);
    const seedS = rng.int(0x7fffffff);
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const n = noise01(((offX + i) / side) * scale, ((offY + j) / side) * scale, seedS);
        const delta = Math.floor(n * 255 * alpha);
        elev[j * side + i] = (elev[j * side + i] ?? 0) + sign * delta;
      }
    }
  };
  if (p.forceHeight > 0) {
    elev.fill(p.forceHeight);
  } else {
    stage(1, p.noise1, 1);
  }
  stage(0.2, 4 * p.noise2, -1);
  stage(0.1, 10 * p.noise3, -1);

  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const k = j * side + i;
      const dx = i + 0.5 - h;
      const dy = j + 0.5 - h;
      const d = Math.sqrt(dx * dx + dy * dy);
      let e = elev[k] ?? 0;
      if (p.centerLand) {
        const R1 = 0.9 * h;
        const R2 = 0.6 * h;
        if (d <= R1) e += Math.floor(45 * Math.min(2.5, (R1 - d) / (R1 - R2)));
      }
      if (p.centerBasin) {
        const R1 = 0.3 * h;
        e -= Math.floor(75 * clamp((R1 - d) / R1, -2.5, 1));
      }
      if (p.centerLake) {
        const R1 = 0.6 * h;
        const R2 = 0.2 * h;
        if (d < R1) e = Math.floor(e * Math.max(0, 1 - (R1 - d) / (R1 - R2)));
      }
      if (p.lowGround) {
        if (e > 150) e -= 50;
        if (e > 130) e -= 20;
      }
      if (p.highGround) {
        if (e < 20) e += 80;
        else if (e < 120) e += 40;
      }
      elev[k] = clamp(e, 0, 255);
    }
  }

  carveShapes(elev, side, p.shapes, rng);

  if (p.shoreSnap) {
    for (let k = 0; k < elev.length; k++) {
      const e = elev[k] ?? 0;
      for (const kind of BANDED) {
        if (kind.snapBand > 0 && kind.band !== null && e >= kind.band - kind.snapBand && e < kind.band) {
          elev[k] = kind.band;
          break;
        }
      }
    }
  }

  if (p.roundEdges) {
    const outer = 0.99 * h;
    const inner = 0.85 * h;
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const k = j * side + i;
        const d = Math.hypot(i + 0.5 - h, j + 0.5 - h);
        if (d > outer) elev[k] = 0;
        else if (d > inner) elev[k] = Math.floor(((elev[k] ?? 0) * (outer - d)) / (outer - inner));
      }
    }
  }
  if (p.squareEdges) {
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const k = j * side + i;
        const edge = Math.min(i, j, side - 1 - i, side - 1 - j);
        if (edge >= 32) continue;
        const rough = Math.floor(noise01(i * 0.2, j * 0.2, 0x5eed) * 6);
        const t = clamp((edge + rough) / 32, 0, 1);
        elev[k] = Math.floor(((elev[k] ?? 0) * t * t * (3 - 2 * t)));
      }
    }
  }

  // Typing (03 section 5.1): every tile gets its band kind; the realm edge is deep sea.
  for (let k = 0; k < realm.tileCount; k++) {
    realm.elevation[k] = clamp(Math.round(elev[k] ?? 0), 0, 255);
    realm.ground[k] = GROUND_BY_ELEVATION[realm.elevation[k] ?? 0] ?? 0;
  }
  for (let k = 0; k < realm.tileCount; k++) {
    const x = k % side;
    const y = Math.floor(k / side);
    if (x === 0 || y === 0 || x === side - 1 || y === side - 1) {
      realm.elevation[k] = 0;
      realm.ground[k] = G.deepmere;
    }
  }

  if (p.removeMountains) {
    for (let k = 0; k < realm.tileCount; k++) {
      let g = realm.ground[k] ?? 0;
      for (let step = 0; step < 2; step++) {
        const kind = ground(g);
        if (kind.layer === 'blocked' && kind.down) g = groundId(kind.down);
      }
      if (g !== (realm.ground[k] ?? 0)) realm.ground[k] = g;
    }
  }

  // Special layouts (03 section 9.1) run after removeMountains so their walls survive it
  // (deviation from the section 2 order, see DECISIONS.md), then rivers, lakes and replace rules
  // (section 2 steps 16-17), then the starter volcano.
  const seedBase = hash3(seed, 0x67656e, 2);
  if (p.layout === 'chessboard') layoutChessboard(realm, createRng(hash3(seedBase, 1, 1)), p.randomBiomes);
  else if (p.layout === 'cells') layoutCells(realm, createRng(hash3(seedBase, 2, 1)), p.cellSize, p.randomBiomes);
  else if (p.layout === 'warren') layoutWarren(realm, createRng(hash3(seedBase, 3, 1)));
  carveRivers(realm, p.rivers, seedBase);
  carveLakes(realm, p.lakes, seedBase);
  applyReplaceRules(realm, p.replaceRules, seedBase);
  if (p.startVolcano) placeVolcano(realm);

  if (p.mountainEdges) {
    const wall = 1;
    for (let k = 0; k < realm.tileCount; k++) {
      const x = k % side;
      const y = Math.floor(k / side);
      if (x === wall || y === wall || x === side - 1 - wall || y === side - 1 - wall) {
        realm.ground[k] = G.crag;
        realm.elevation[k] = 213;
      }
    }
  }
  if (p.freezePeaks) {
    for (let k = 0; k < realm.tileCount; k++) {
      if (realm.ground[k] === G.crag && (realm.elevation[k] ?? 0) > 222) realm.flags[k] = (realm.flags[k] ?? 0) | FLAG.frozen;
    }
  }

  // Edge ring (03 section 5): forced deep sea, flagged as the realm edge (Realm constructor did the flags).
  realm.rebuildSets();

  if (p.randomBiomes) paintBiomes(sim, rng);
  if (p.addFlora && flora) {
    for (let pass = 0; pass < 10; pass++) wildSeeding(sim, Math.floor(realm.tileCount / 16));
  }

  buildRegions(realm);
  if (beasts) {
    const landTiles = Math.round(landFraction(realm) * realm.tileCount);
    const groups = Math.min(40, Math.max(1, Math.round(landTiles / 1500)));
    seedStartingBeasts(sim, groups);
  }
  realm.markAllDirty();
  return sim;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Blob carving (03 section 5 shapesCarve, blob masks are radial instead of shipped bitmaps). */
function carveShapes(elev: Float32Array, side: number, count: number, rng: Rng): void {
  for (let s = 0; s < count; s++) {
    const base = side / 8;
    const rx = base * (0.3 + rng.next() * 1.7);
    const ry = base * (0.3 + rng.next() * 1.7);
    const cx = side / 2 + (rng.next() - 0.5) * side * 0.5;
    const cy = side / 2 + (rng.next() - 0.5) * side * 0.5;
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(side - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(side - 1, Math.ceil(cy + ry));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const r = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (r >= 1) continue;
        const alpha = 1 - r * r;
        const k = y * side + x;
        elev[k] = clamp((elev[k] ?? 0) - Math.floor(alpha * 255 * 0.7), 0, 255);
      }
    }
  }
}

/** Biome painting (03 section 6): flood fills of soil with weighted biome choice. */
function paintBiomes(sim: Sim, rng: Rng): void {
  const realm = sim.realm;
  const soil: number[] = [];
  for (let k = 0; k < realm.tileCount; k++) {
    const g = realm.ground[k] ?? 0;
    if (g === G.lowloam || g === G.highloam) soil.push(k);
  }
  const pickBiome = (): number => pickWeightedBiome(rng, BIOME_WEIGHTS);
  while (soil.length > 0) {
    const start = soil[soil.length - 1] ?? 0;
    if (realm.cover[start] !== 0) {
      soil.pop();
      continue;
    }
    const biome = pickBiome();
    const cap = BIOMES[biome]?.maxPatch ?? Number.POSITIVE_INFINITY;
    const patch = Math.min(cap, Math.max(12, Math.floor(soil.length / 4)));
    const frontier = [start];
    let painted = 0;
    while (frontier.length > 0 && painted < patch) {
      const pick = rng.int(frontier.length);
      const i = frontier[pick] ?? start;
      frontier[pick] = frontier[frontier.length - 1] ?? start;
      frontier.pop();
      if (realm.cover[i] !== 0) continue;
      const high = realm.ground[i] === G.highloam;
      realm.setCover(i, biomeCoverId(biome, high));
      painted++;
      for (let k = 0; k < 4; k++) {
        const j = n4(i, realm.side, k);
        if (j < 0 || realm.cover[j] !== 0) continue;
        const gj = realm.ground[j] ?? 0;
        if (gj === G.lowloam || gj === G.highloam) frontier.push(j);
      }
    }
    soil.length = 0;
    for (let k = 0; k < realm.tileCount; k++) {
      const g = realm.ground[k] ?? 0;
      if ((g === G.lowloam || g === G.highloam) && realm.cover[k] === 0) soil.push(k);
    }
  }
}

/** Connected components of walkable land (regions for the connectivity layer, 01 section 11). */
function buildRegions(realm: Realm): void {
  realm.region.fill(0);
  let next = 1;
  const stack: number[] = [];
  for (let k = 0; k < realm.tileCount; k++) {
    if (realm.region[k] !== 0 || ground(realm.ground[k] ?? 0).layer === 'water') continue;
    realm.region[k] = next;
    stack.push(k);
    while (stack.length > 0) {
      const i = stack.pop() ?? 0;
      for (let d = 0; d < 4; d++) {
        const j = n4(i, realm.side, d);
        if (j < 0 || realm.region[j] !== 0) continue;
        if (ground(realm.ground[j] ?? 0).layer === 'water') continue;
        realm.region[j] = next;
        stack.push(j);
      }
    }
    next++;
  }
}

function landFraction(realm: Realm): number {
  let land = 0;
  for (let k = 0; k < realm.tileCount; k++) {
    if (ground(realm.ground[k] ?? 0).layer !== 'water') land++;
  }
  return land / realm.tileCount;
}

function countBiomeTiles(realm: Realm): number {
  let n = 0;
  for (let k = 0; k < realm.tileCount; k++) if ((realm.cover[k] ?? 0) !== 0) n++;
  return n;
}

function countFlora(realm: Realm): number {
  let n = 0;
  for (let k = 0; k < realm.tileCount; k++) if ((realm.flora[k] ?? 0) !== 0) n++;
  return n;
}
