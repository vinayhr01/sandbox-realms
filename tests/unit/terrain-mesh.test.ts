import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { groundId } from '../../src/content/grounds.ts';
import { BIOMES, biomeCoverId } from '../../src/content/biomes.ts';
import { HeightField } from '../../src/render3d/heights.ts';
import {
  CHUNK,
  SKIRT_DROP,
  buildChunk,
  chunkLod,
  coverTint,
  groundLinear,
  tileColour,
  tileJitter,
  waterSurface,
} from '../../src/render3d/terrain-mesh.ts';
import { Terrain3D } from '../../src/render3d/terrain3d.ts';

/** Fills every tile of the field with a ground and an elevation, or per-tile functions. */
function fill(f: HeightField, ground: number | ((x: number, y: number) => number), elev: number | ((x: number, y: number) => number)): void {
  const s = f.side;
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const o = (y * s + x) * 4;
      data[o] = typeof ground === 'number' ? ground : ground(x, y);
      data[o + 2] = typeof elev === 'number' ? elev : elev(x, y);
    }
  }
  f.applyRows({ y0: 0, y1: s - 1, data });
}

function field(side: number, elev: number): HeightField {
  const f = new HeightField(side);
  fill(f, groundId('lowloam'), elev);
  return f;
}

function harness(side: number, elev = 100) {
  const f = field(side, elev);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const ctx = { scene, camera, field: f, renderer: {} as THREE.WebGLRenderer, toScreen: () => null, buildings: () => [], boats: () => [] };
  const layer = new Terrain3D();
  layer.init(ctx);
  return { f, scene, layer };
}

function terrainMeshes(scene: THREE.Scene): THREE.Mesh[] {
  return scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.userData['kind'] === 'terrain');
}

function geometryByChunk(scene: THREE.Scene): Map<string, string> {
  return new Map(terrainMeshes(scene).map((m) => [`${m.userData['cx']},${m.userData['cy']}`, m.geometry.uuid]));
}

describe('buildChunk', () => {
  it('puts every vertex of a flat elev-100 field at y = 4.0', () => {
    const { positions } = buildChunk(field(64, 100), 0, 0, 1);
    // The grid comes first; the skirt vertices after it hang SKIRT_DROP lower.
    const grid = (CHUNK + 1) * (CHUNK + 1);
    for (let i = 1; i < grid * 3; i += 3) expect(positions[i]).toBeCloseTo(4.0, 6);
  });

  it.each([1, 2, 4] as const)('gives (CHUNK/%i+1)^2 grid vertices plus 4n skirt vertices for a full chunk', (step) => {
    const { positions, indices } = buildChunk(field(64, 100), 0, 0, step);
    const n = CHUNK / step + 1;
    expect(positions.length / 3).toBe(n * n + 4 * n);
    // Grid quads, plus two triangles per skirt segment on each of the four edges.
    expect(indices.length).toBe((n - 1) * (n - 1) * 6 + 4 * (n - 1) * 6);
  });

  it('gives (2*CHUNK+1)^2 grid vertices when fine (two per tile edge), plus skirts', () => {
    const { positions, indices } = buildChunk(field(64, 100), 0, 0, 1, { fine: true });
    const n = 2 * CHUNK + 1;
    expect(positions.length / 3).toBe(n * n + 4 * n);
    expect(indices.length).toBe((n - 1) * (n - 1) * 6 + 4 * (n - 1) * 6);
  });

  it('places fine vertices half a tile apart, on the height field', () => {
    const { positions } = buildChunk(field(64, 100), 0, 0, 1, { fine: true });
    // Vertex 1 of the first grid row sits half a tile east of the origin corner, at the flat height.
    expect(positions[3]).toBeCloseTo(0.5, 6);
    expect(positions[4]).toBeCloseTo(4.0, 6);
  });

  it('places vertices on the tile corners of its chunk', () => {
    const { positions } = buildChunk(field(64, 100), 1, 0, 1);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]!);
      maxX = Math.max(maxX, positions[i]!);
    }
    expect(minX).toBe(CHUNK);
    expect(maxX).toBe(2 * CHUNK);
  });

  it('gives smooth unit-length normals, straight up on a flat field', () => {
    const { normals, positions } = buildChunk(field(64, 100), 0, 0, 1);
    expect(normals.length).toBe(positions.length);
    for (let i = 0; i < normals.length; i += 3) {
      expect(Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!)).toBeCloseTo(1, 5);
    }
    expect(normals[1]).toBeCloseTo(1, 5);
  });

  it('gives neighbouring vertices on a linear slope equal normals', () => {
    const f = new HeightField(64);
    fill(f, groundId('lowloam'), (x) => 100 + x);
    const { normals } = buildChunk(f, 0, 0, 1);
    for (let c = 0; c < 3; c++) expect(Math.abs(normals[5 * 3 + c]! - normals[6 * 3 + c]!)).toBeLessThan(0.02);
  });

  it('drops each skirt vertex SKIRT_DROP below the edge vertex it copies', () => {
    const { positions } = buildChunk(field(64, 100), 0, 0, 1);
    const grid = (CHUNK + 1) * (CHUNK + 1);
    // The first skirt vertex copies grid vertex 0.
    expect(positions[grid * 3 + 1]).toBeCloseTo(positions[1]! - SKIRT_DROP, 6);
  });
});

describe('cover tint and colour', () => {
  const idx = (id: string) => BIOMES.findIndex((b) => b.id === id);

  it('leaves bare ground and non-biome covers untinted', () => {
    expect(coverTint(0)).toEqual([1, 1, 1]);
    expect(coverTint(250)).toEqual([1, 1, 1]);
  });

  it('darkens a forest biome cover and tints a grass one', () => {
    const forest = coverTint(biomeCoverId(idx('steamthicket'), false));
    expect(forest[0]).toBeLessThan(1);
    expect(forest[2]).toBeLessThan(forest[1]!);
    expect(coverTint(biomeCoverId(idx('verdant_reach'), false))).not.toEqual([1, 1, 1]);
  });

  it('keeps the jitter within plus or minus 4 percent, deterministic and varied', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const j = tileJitter(x, y);
        expect(j).toBe(tileJitter(x, y));
        lo = Math.min(lo, j);
        hi = Math.max(hi, j);
      }
    }
    expect(lo).toBeGreaterThanOrEqual(-0.04);
    expect(hi).toBeLessThanOrEqual(0.04);
    expect(hi - lo).toBeGreaterThan(0.04);
  });

  it('colours a tile as ground times cover tint times jitter', () => {
    const f = new HeightField(8);
    fill(f, groundId('lowloam'), 100);
    const cover = biomeCoverId(idx('steamthicket'), false);
    f.cover[0] = cover;
    const [r, g, b] = tileColour(f, 0, 0);
    const base = groundLinear(groundId('lowloam'));
    const t = coverTint(cover);
    const k = 1 + tileJitter(0, 0);
    expect(r).toBeCloseTo(base[0] * t[0] * k, 6);
    expect(g).toBeCloseTo(base[1] * t[1] * k, 6);
    expect(b).toBeCloseTo(base[2] * t[2] * k, 6);
  });

  it('gives a corner that touches one tile that tile colour', () => {
    const f = new HeightField(8);
    fill(f, groundId('lowloam'), 100);
    const { colors } = buildChunk(f, 0, 0, 1);
    const [r] = tileColour(f, 0, 0);
    expect(colors[0]).toBeCloseTo(r, 6);
  });
});

describe('chunkLod', () => {
  it('is 1 near, 2 mid range and 4 far', () => {
    expect(chunkLod(10)).toBe(1);
    expect(chunkLod(100)).toBe(2);
    expect(chunkLod(500)).toBe(4);
  });
});

describe('waterSurface', () => {
  it('is null on grass', () => {
    expect(waterSurface(field(8, 100), 2, 2)).toBeNull();
  });

  it('is the tile height plus 0.02 on a water tile', () => {
    // The realm has no river kind. Shoal is the water kind used here, at elev 78.
    const f = new HeightField(8);
    fill(f, groundId('shoal'), 78);
    expect(waterSurface(f, 2, 2)).toBeCloseTo(78 * 0.04 + 0.02, 6);
  });
});

describe('Terrain3D', () => {
  it('rebuilds every chunk on setSide, with no meshes from the old side', () => {
    const { f, scene, layer } = harness(64);
    layer.onSide(64);
    const old = new Set(terrainMeshes(scene).map((m) => m.uuid));
    expect(old.size).toBe(4);

    f.reset(40);
    fill(f, groundId('lowloam'), 100);
    layer.onSide(40);
    const meshes = terrainMeshes(scene);
    expect(meshes).toHaveLength(4);
    for (const m of meshes) {
      expect(old.has(m.uuid)).toBe(false);
      m.geometry.computeBoundingBox();
      expect(m.geometry.boundingBox!.max.x).toBeLessThanOrEqual(40);
      expect(m.geometry.boundingBox!.max.z).toBeLessThanOrEqual(40);
    }
  });

  it('onRows({5}) rebuilds only chunk row 0', () => {
    const { f, scene, layer } = harness(64);
    layer.onSide(64);
    const before = geometryByChunk(scene);

    fill(f, groundId('lowloam'), (_x, y) => (y === 5 ? 120 : 100));
    layer.onRows(new Set([5]));
    const after = geometryByChunk(scene);

    expect(after.get('0,0')).not.toBe(before.get('0,0'));
    expect(after.get('1,0')).not.toBe(before.get('1,0'));
    expect(after.get('0,1')).toBe(before.get('0,1'));
    expect(after.get('1,1')).toBe(before.get('1,1'));
  });

  it('also rebuilds the chunk row above when a tile on the boundary row changes', () => {
    const { f, scene, layer } = harness(64);
    layer.onSide(64);
    const before = geometryByChunk(scene);

    fill(f, groundId('lowloam'), (_x, y) => (y === 31 ? 120 : 100));
    layer.onRows(new Set([31]));
    const after = geometryByChunk(scene);

    expect(after.get('0,0')).not.toBe(before.get('0,0'));
    expect(after.get('0,1')).not.toBe(before.get('0,1'));
  });
});
